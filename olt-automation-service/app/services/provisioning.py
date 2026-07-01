"""
Lógica de aprovisionamiento SSH por marca.

Flujo:
  1. Renderizar plantilla Jinja2 → lista de comandos CLI
  2. Abrir sesión Netmiko (síncrona — llamar desde asyncio.to_thread)
  3. Enviar comandos con buffers calibrados por tipo de operación
  4. Parsear salida con TextFSM
  5. Validar umbrales y retornar dict estructurado al ERP

Nota: las funciones públicas son SÍNCRONAS por diseño — Netmiko usa
sockets bloqueantes. Invocarlas desde asyncio.to_thread() en main.py.
"""
import logging
import re
import time as _time_read
from io import StringIO
from pathlib import Path
from typing import Any

import textfsm
from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from netmiko import ConnectHandler
from netmiko.exceptions import (
    NetmikoAuthenticationException,
    NetmikoTimeoutException,
    ReadTimeout,
)

from app.config import settings
from app.schemas.olt import OltBrand, OltConnectionSchema, OnuProvisionSchema
from app.services.snmp_mapping import SNMP_OID_MAP, SNMP_POWER_SCALE
from app.services.snmp_service import SnmpError, get_snmp_value, set_snmp_octet_string

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent.parent / 'templates'

# huawei_smartax → HuaweiSmartAX: clase SSH nativa para MA5600/MA5800.
# Maneja session_preparation() (screen-length 0) y prompt detection
# correctamente para SSH. huawei_telnet era la clase Telnet genérica
# (no OLT-específica) que requería múltiples workarounds manuales.
_NETMIKO_DEVICE_TYPE: dict[OltBrand, str] = {
    OltBrand.HUAWEI: 'huawei_smartax',
    OltBrand.ZTE:    'zte_zxros',
    OltBrand.VSOL:   'linux',
    OltBrand.CDATA:  'linux',
}

_CLI_ERROR_PATTERNS: dict[OltBrand, list[str]] = {
    OltBrand.HUAWEI: [
        'Error: ',
        '% Error',
        'Unrecognized command',
        'Wrong parameter',
        'Incomplete command',
        'Ambiguous command',
    ],
    OltBrand.ZTE: [
        '% Unknown command',
        '% Error',
        '% Invalid input',
        'invalid input',
        'Error:',
        'Failed to',
        'Duplicate entry',
        '% Ambiguous command',
    ],
    OltBrand.VSOL: ['command not found', 'Invalid'],
    OltBrand.CDATA: ['command not found', 'Invalid'],
}

# Umbrales de potencia óptica Rx (dBm)
# -28 dBm: alerta temprana de degradación de señal
# -30 dBm: límite crítico — por debajo se considera ONU offline o fibra cortada
_RXPOWER_WARN_DBM    = -28.0
_RXPOWER_CRITICAL_DBM = -30.0


# ── Excepciones ───────────────────────────────────────────────

class ProvisioningError(Exception):
    """Error controlado durante el aprovisionamiento — se retorna al ERP."""

class ConnectionError(ProvisioningError):
    """Fallo SSH (timeout, autenticación, red)."""

class CommandError(ProvisioningError):
    """La CLI de la OLT rechazó o reportó error en un comando."""


# ── Helpers privados ──────────────────────────────────────────

def _huawei_enter_enable(session: Any, conn: OltConnectionSchema) -> None:
    """
    Huawei MA5800/MA5600 vía SSH (huawei_smartax): si la cuenta SSH no tiene
    privilege 15, el prompt inicial es 'hostname>' (user mode). Esta función
    detecta el prompt, escala a privileged mode '#' y deshabilita la paginación.
    Con huawei_smartax la clase base intenta esto en session_preparation(); este
    helper es una defensa adicional para firmware que no lo maneje correctamente.
    """
    if conn.brand != OltBrand.HUAWEI:
        return
    try:
        prompt = session.find_prompt()
        if prompt.strip().endswith('>'):
            session.send_command('enable', expect_string=r'[>#]', read_timeout=10)
            logger.debug('huawei_enter_enable: modo privilegiado activo en %s', conn.ip)
        # Deshabilitar paginación — MA5800 muestra '{ <cr>||<K> }:' en outputs
        # largos; ese prompt contiene '>' y rompe expect_string=r'[>#]'.
        # send_command_timing no usa expect_string, así que no hay falso match.
        try:
            session.send_command_timing(
                'screen-length 0 temporary',
                delay_factor=1,
                read_timeout=10,
            )
            logger.debug('huawei_enter_enable: paginación desactivada en %s', conn.ip)
        except Exception:  # noqa: BLE001
            pass
    except Exception as exc:  # noqa: BLE001
        logger.warning('huawei_enter_enable: no se pudo escalar modo en %s: %s', conn.ip, exc)


# Patrón que coincide con el prompt real del OLT (hostname> o hostname#)
# al final del último renglón. re.search con ^ ancla al inicio de la línea
# candidata (tras rsplit), evitando falsos matches con '{ <cr>||<K> }:'.
_HUAWEI_PROMPT_RE = re.compile(r'^\S+[>#]\s*$')


def _send_huawei_confirmed(
    session: Any,
    command: str,
    read_timeout: float,
) -> str:
    """
    Envía un comando Huawei y maneja el prompt de confirmación
    '{ <cr>||<K> }:' que el MA5800 muestra antes de ejecutar
    comandos como 'display ont autofind all'.

    Flujo:
      1. Escribe el comando al canal.
      2. Lee hasta encontrar '{ <cr>' (confirmación) o el prompt final.
      3. Si hay confirmación → envía Enter → lee hasta el prompt final.
      4. Limpia el echo del comando y el prompt del output retornado.
    """
    session.write_channel(command + '\r\n')

    data = ''
    confirmed = False
    deadline = _time_read.monotonic() + read_timeout

    while _time_read.monotonic() < deadline:
        chunk = session.read_channel()
        data += chunk

        # Verificar el último renglón para detectar confirmación o prompt real.
        last_line = data.rsplit('\n', 1)[-1].replace('\r', '').strip()

        if not confirmed and '{ <cr>' in last_line:
            # Responder a la confirmación con Enter y continuar leyendo.
            session.write_channel('\r\n')
            confirmed = True
            continue

        if _HUAWEI_PROMPT_RE.match(last_line):
            break  # Prompt real encontrado — output completo.

        _time_read.sleep(0.05)
    else:
        raise ReadTimeout(
            f"Timeout esperando respuesta al comando Huawei: {command!r}"
        )

    # Limpiar echo del comando y prompt de las líneas devueltas.
    cleaned: list[str] = []
    for line in data.replace('\r', '').split('\n'):
        stripped = line.strip()
        if command in stripped:
            continue
        if '{ <cr>' in stripped:
            continue
        if _HUAWEI_PROMPT_RE.match(stripped):
            continue
        cleaned.append(line)
    return '\n'.join(cleaned)


def _render_commands(brand: OltBrand, template_name: str, context: dict[str, Any]) -> str:
    brand_dir = TEMPLATES_DIR / brand.value
    env = Environment(
        loader=FileSystemLoader(str(brand_dir)),
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=False,
    )
    try:
        tmpl = env.get_template(template_name)
    except TemplateNotFound as exc:
        raise ProvisioningError(
            f'Plantilla "{template_name}" no encontrada para marca {brand.value}'
        ) from exc
    return tmpl.render(**context)


def _parse_output(brand: OltBrand, fsm_name: str, raw_output: str) -> list[dict[str, Any]]:
    """
    Parsea `raw_output` con la plantilla TextFSM indicada.
    Retorna lista de dicts con los valores capturados.
    Si la plantilla no existe, retorna el texto raw sin parsear.
    """
    fsm_path = TEMPLATES_DIR / brand.value / fsm_name
    if not fsm_path.exists():
        logger.warning('TextFSM "%s" no encontrada — retornando raw', fsm_path)
        return [{'raw': raw_output}]

    with open(fsm_path, encoding='utf-8-sig') as fh:   # utf-8-sig strips BOM automáticamente
        fsm = textfsm.TextFSM(fh)

    rows = fsm.ParseText(raw_output)
    if not rows:
        return []
    return [dict(zip(fsm.header, row)) for row in rows]


def _build_netmiko_params(conn: OltConnectionSchema) -> dict[str, Any]:
    return {
        'device_type':          _NETMIKO_DEVICE_TYPE[conn.brand],
        'host':                 conn.ip,
        'port':                 conn.port,
        'username':             conn.username,
        'password':             conn.password,
        'conn_timeout':         settings.ssh_connect_timeout,
        'auth_timeout':         settings.ssh_auth_timeout,
        'banner_timeout':       settings.ssh_banner_timeout,
        'read_timeout_override': settings.ssh_command_timeout,
        # Algunos firmware Huawei MA5800 no hacen eco de comandos de
        # inicialización (screen-length 0 temporary). Con False, Netmiko
        # no verifica el eco → evita "Pattern not detected" en handshake.
        'global_cmd_verify':    False,
        'session_log':          None,
    }


def _check_cli_error(brand: OltBrand, context: str, output: str) -> None:
    """
    Lanza CommandError si el output contiene patrones de error de la CLI.
    `context` es solo una etiqueta para el mensaje de log (ej: 'provision').
    """
    for pattern in _CLI_ERROR_PATTERNS.get(brand, []):
        if pattern.lower() in output.lower():
            snippet = output[:300].replace('\n', ' ')
            raise CommandError(
                f'CLI reportó error en [{context}]: {snippet}'
            )


def _send_config_set(conn: OltConnectionSchema, commands: list[str]) -> str:
    """
    Abre sesión SSH y envía `commands` con send_config_set().

    Usamos enter_config_mode=False porque el primer comando de la lista
    es 'config' (ya incluido en la plantilla), evitando que Netmiko
    envíe 'system-view' y duplique la entrada al modo de configuración.

    exit_config_mode=False porque el flujo cierra con 'quit' y 'save',
    no con el 'return' implícito de Netmiko.

    Reintenta hasta settings.ssh_max_retries veces ante timeout/error de red
    con backoff exponencial (2s, 4s). Los errores de autenticación no se reintentan.
    """
    import time as _time_cfg
    params = _build_netmiko_params(conn)
    last_exc: Exception | None = None

    for attempt in range(1, settings.ssh_max_retries + 1):
        try:
            with ConnectHandler(**params) as session:
                _huawei_enter_enable(session, conn)
                output: str = session.send_config_set(
                    commands,
                    enter_config_mode=False,
                    exit_config_mode=False,
                    cmd_verify=False,
                    read_timeout=settings.ssh_command_timeout,
                    strip_prompt=False,
                )
            return output
        except NetmikoAuthenticationException as exc:
            # Auth failure: no reintentar — las credenciales no van a cambiar
            raise ConnectionError(
                f'Autenticación SSH fallida en {conn.ip}:{conn.port}'
            ) from exc
        except (NetmikoTimeoutException, OSError) as exc:
            last_exc = exc
            if attempt < settings.ssh_max_retries:
                wait = attempt * 2
                logger.warning(
                    'SSH config_set intento %d/%d fallido en %s — reintentando en %ds: %s',
                    attempt, settings.ssh_max_retries, conn.ip, wait, exc,
                )
                _time_cfg.sleep(wait)

    raise ConnectionError(
        f'Timeout/error de red en {conn.ip}:{conn.port} '
        f'tras {settings.ssh_max_retries} intentos: {last_exc}'
    )


def _send_single_command(conn: OltConnectionSchema, command: str) -> str:
    """
    Abre sesión SSH, envía un único comando de show/display y retorna
    la salida limpia.  Usa send_command() con expect_string calibrado
    para prompts de Huawei OLT (>, #, paréntesis de sub-modo).

    Reintenta hasta settings.ssh_max_retries veces ante timeout de conexión
    o error de red. ReadTimeout (respuesta lenta del comando) y errores de
    autenticación no se reintentan.
    """
    import time as _time_single
    params = _build_netmiko_params(conn)
    last_exc: Exception | None = None

    for attempt in range(1, settings.ssh_max_retries + 1):
        try:
            with ConnectHandler(**params) as session:
                _huawei_enter_enable(session, conn)
                output: str = session.send_command(
                    command,
                    # r'\S+[>#]\s*$' no hace match con '{ <cr>||<K> }:'
                    # (el prompt de paginación Huawei que contiene '>').
                    expect_string=r'\S+[>#]\s*$',
                    read_timeout=settings.ssh_command_timeout,
                    strip_prompt=True,
                    strip_command=True,
                )
            return output
        except NetmikoAuthenticationException as exc:
            raise ConnectionError(
                f'Autenticación SSH fallida en {conn.ip}:{conn.port}'
            ) from exc
        except ReadTimeout as exc:
            # Timeout de respuesta de la OLT — no es un problema de conexión,
            # reintentar no ayuda; el comando quedó colgado en el equipo.
            raise CommandError(
                f'Timeout esperando respuesta al comando: {command!r}'
            ) from exc
        except (NetmikoTimeoutException, OSError) as exc:
            last_exc = exc
            if attempt < settings.ssh_max_retries:
                wait = attempt * 2
                logger.warning(
                    'SSH single_command intento %d/%d fallido en %s — reintentando en %ds: %s',
                    attempt, settings.ssh_max_retries, conn.ip, wait, exc,
                )
                _time_single.sleep(wait)

    raise ConnectionError(
        f'Timeout/error de red en {conn.ip}:{conn.port} '
        f'tras {settings.ssh_max_retries} intentos: {last_exc}'
    )


def _open_multi_commands(
    conn:     OltConnectionSchema,
    commands: list[str],
) -> list[str]:
    """
    Abre UNA sesión Netmiko, ejecuta múltiples comandos de show en secuencia
    y retorna la lista de salidas en el mismo orden.

    Más eficiente que N sesiones independientes para el cron de monitoreo:
    un solo handshake SSH → N comandos → un solo cierre de sesión.
    Llamar desde asyncio.to_thread() en main.py.
    """
    params = _build_netmiko_params(conn)
    try:
        with ConnectHandler(**params) as session:
            _huawei_enter_enable(session, conn)
            return [
                session.send_command(
                    cmd,
                    expect_string=r'\S+[>#]\s*$',
                    read_timeout=settings.ssh_command_timeout,
                    strip_prompt=True,
                    strip_command=True,
                )
                for cmd in commands
            ]
    except NetmikoAuthenticationException as exc:
        raise ConnectionError(
            f'Autenticación SSH fallida en {conn.ip}:{conn.port}'
        ) from exc
    except NetmikoTimeoutException as exc:
        raise ConnectionError(
            f'Timeout SSH a {conn.ip}:{conn.port} — OLT no alcanzable'
        ) from exc
    except ReadTimeout as exc:
        raise CommandError('Timeout en respuesta a comandos bulk') from exc
    except OSError as exc:
        raise ConnectionError(
            f'Error de red a {conn.ip}:{conn.port}: {exc}'
        ) from exc


# ── Huawei ────────────────────────────────────────────────────

def provision_huawei_onu(
    conn: OltConnectionSchema,
    onu: OnuProvisionSchema,
) -> dict[str, Any]:
    """
    Aprovisiona una ONU en OLT Huawei MA5800/MA5600.

    Renderiza provision.j2, inyecta los comandos vía send_config_set() y
    verifica que la CLI no haya devuelto ningún error.
    Llamar dentro del lock de connection_pool para exclusión por OLT.
    """
    if onu.service_port_id is None:
        raise ProvisioningError(
            'service_port_id es requerido para aprovisionar en OLTs Huawei'
        )
    if onu.traffic_index is None:
        raise ProvisioningError(
            'traffic_index es requerido para aprovisionar en OLTs Huawei'
        )

    use_profile_mode = (
        onu.lineprofile_id is not None and onu.srvprofile_id is not None
    )

    context: dict[str, Any] = {
        'slot':            onu.slot,
        'port':            onu.port,
        'onu_id':          onu.onu_id,
        'sn':              onu.sn,
        'vlan':            onu.vlan,
        'service_port_id': onu.service_port_id,
        'traffic_index':   onu.traffic_index,
    }
    if use_profile_mode:
        context['lineprofile_id'] = onu.lineprofile_id
        context['srvprofile_id']  = onu.srvprofile_id
        if onu.description:
            context['description'] = onu.description
    if onu.onu_mode:
        context['onu_mode'] = onu.onu_mode

    rendered = _render_commands(conn.brand, 'provision.j2', context)

    # Filtrar líneas vacías y comentarios Jinja2 ya expandidos
    commands: list[str] = [
        line.strip()
        for line in rendered.strip().splitlines()
        if line.strip() and not line.strip().startswith('{#')
    ]

    # Huawei solicita confirmación interactiva al ejecutar 'save':
    # "Are you sure to save the configuration? (y/n)[n]:"
    # Insertar 'y' inmediatamente después para confirmar sin bloquear el buffer.
    try:
        save_idx = commands.index('save')
        commands.insert(save_idx + 1, 'y')
    except ValueError:
        pass  # 'save' no estaba en la lista

    logger.info(
        'Aprovisionando ONU %s en %s slot=%d port=%d onu_id=%d vlan=%d service_port=%d',
        onu.sn, conn.ip, onu.slot, onu.port, onu.onu_id, onu.vlan, onu.service_port_id,
    )

    raw_output = _send_config_set(conn, commands)
    _check_cli_error(conn.brand, 'provision_huawei_onu', raw_output)

    logger.info('ONU %s aprovisionada correctamente en %s', onu.sn, conn.ip)
    return {
        'success':        True,
        'output':         raw_output,
        'onu_sn':         onu.sn,
        'slot':           onu.slot,
        'port':           onu.port,
        'onu_id':         onu.onu_id,
        'vlan':           onu.vlan,
        'service_port_id': onu.service_port_id,
    }


def get_huawei_metrics(
    conn: OltConnectionSchema,
    onu: OnuProvisionSchema,
) -> dict[str, Any]:
    """
    Consulta la potencia óptica (RxPower, TxPower, Temperatura) de una ONU.

    Siempre retorna un dict — NUNCA propaga excepciones de red al caller.
    Si hay fallo de conexión o datos no parseables, retorna success=False
    con un campo 'alarm' describiendo el problema para que el ERP lo muestre.

    Umbrales:
      RxPower < -28 dBm → alarm warning
      RxPower < -30 dBm → alarm critical (ONU offline / fibra cortada)
    """
    command = f'display ont optical-info 0/{onu.slot} {onu.port} {onu.onu_id}'

    # ── Enviar comando ────────────────────────────────────────
    try:
        raw_output = _send_single_command(conn, command)
    except (ConnectionError, CommandError) as exc:
        logger.warning('get_huawei_metrics: fallo de conexión a %s — %s', conn.ip, exc)
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'alarm': {
                'level':   'error',
                'message': f'No se pudo conectar a la OLT {conn.ip}: {exc}',
            },
        }

    # ── Parsear con TextFSM ───────────────────────────────────
    parsed = _parse_output(conn.brand, 'display_ont_optical_info.textfsm', raw_output)

    if not parsed or 'raw' in parsed[0]:
        logger.warning(
            'get_huawei_metrics: TextFSM no encontró datos en la salida de %s', conn.ip
        )
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'raw':           raw_output,
            'alarm': {
                'level':   'warning',
                'message': 'Datos ópticos no disponibles — ONU posiblemente no registrada',
            },
        }

    metrics = parsed[0]

    # ── Convertir valores capturados ──────────────────────────
    try:
        rx   = float(metrics.get('RxPower') or '0')
        tx   = float(metrics.get('TxPower') or '0')
        temp = int(float(metrics.get('Temp')  or '0'))
    except (ValueError, TypeError) as exc:
        logger.error('get_huawei_metrics: error convirtiendo valores — %s | raw=%s', exc, metrics)
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'alarm': {
                'level':   'warning',
                'message': f'No se pudieron interpretar los valores ópticos: {exc}',
            },
        }

    # ── Evaluar umbrales ──────────────────────────────────────
    alarm: dict[str, str] | None = None

    if rx < _RXPOWER_CRITICAL_DBM:
        alarm = {
            'level':   'critical',
            'message': (
                f'RxPower {rx:.2f} dBm por debajo del umbral crítico '
                f'({_RXPOWER_CRITICAL_DBM} dBm) — ONU offline o fibra cortada'
            ),
        }
        logger.warning(
            'ONU %s en %s: RxPower crítico %.2f dBm', onu.sn, conn.ip, rx
        )
    elif rx < _RXPOWER_WARN_DBM:
        alarm = {
            'level':   'warning',
            'message': (
                f'RxPower {rx:.2f} dBm degradado '
                f'(alerta en {_RXPOWER_WARN_DBM} dBm)'
            ),
        }

    return {
        'success':       True,
        'rx_power_dbm':  rx,
        'tx_power_dbm':  tx,
        'temperature_c': temp,
        'alarm':         alarm,
    }


# ── ZTE ──────────────────────────────────────────────────────

def provision_zte_onu(
    conn: OltConnectionSchema,
    onu: OnuProvisionSchema,
) -> dict[str, Any]:
    """
    Aprovisiona una ONU en OLT ZTE ZXA10 C300/C320.

    Renderiza provision.j2, añade 'end' + 'write' para salir del modo
    config y persistir en flash, envía vía send_config_set() y verifica
    la salida frente a los patrones de error ZTE.
    Llamar dentro del lock de connection_pool para exclusión por OLT.
    """
    if onu.onu_type is None:
        raise ProvisioningError(
            'onu_type es requerido para aprovisionar en OLTs ZTE (ej: ZTE-F660, F601E)'
        )

    context: dict[str, Any] = {
        'rack':          onu.frame,    # ZTE usa 'rack' en lugar de 'frame'
        'slot':          onu.slot,
        'port':          onu.port,
        'onu_id':        onu.onu_id,
        'onu_type':      onu.onu_type,
        'sn':            onu.sn,
        'vlan':          onu.vlan,
        'tcont_profile': onu.profile_speed,
        'wan_profile':   onu.profile_speed,
    }
    if onu.onu_mode:
        context['onu_mode'] = onu.onu_mode

    rendered = _render_commands(conn.brand, 'provision.j2', context)

    commands: list[str] = [
        line.strip()
        for line in rendered.strip().splitlines()
        if line.strip() and not line.strip().startswith('{#')
    ]

    # Salir del modo config y persistir — ZTE requiere 'end' + 'write'
    # 'end' devuelve al exec privilegiado desde cualquier sub-modo
    commands.extend(['end', 'write'])

    logger.info(
        'Aprovisionando ONU %s en ZTE %s rack=%d slot=%d port=%d onu_id=%d vlan=%d tipo=%s',
        onu.sn, conn.ip, onu.frame, onu.slot, onu.port, onu.onu_id, onu.vlan, onu.onu_type,
    )

    raw_output = _send_config_set(conn, commands)
    _check_cli_error(conn.brand, 'provision_zte_onu', raw_output)

    logger.info('ONU %s aprovisionada correctamente en ZTE %s', onu.sn, conn.ip)
    return {
        'success':  True,
        'output':   raw_output,
        'onu_sn':   onu.sn,
        'rack':     onu.frame,
        'slot':     onu.slot,
        'port':     onu.port,
        'onu_id':   onu.onu_id,
        'vlan':     onu.vlan,
        'onu_type': onu.onu_type,
    }


def get_zte_metrics(
    conn: OltConnectionSchema,
    onu: OnuProvisionSchema,
) -> dict[str, Any]:
    """
    Consulta la potencia óptica (RxPower, TxPower) de una ONU ZTE.

    Envía 'show pon power attenuation gpon-onu_rack/slot/port:onu_id',
    parsea con show_pon_power.textfsm y evalúa los umbrales de Rx.
    No propaga excepciones de red — retorna success=False con alarm
    para que el ERP lo muestre como advertencia sin levantar un 5xx.

    Nota: ZTE no reporta temperatura en este comando; temperature_c siempre None.
    """
    command = (
        f'show pon power attenuation '
        f'gpon-onu_{onu.frame}/{onu.slot}/{onu.port}:{onu.onu_id}'
    )

    try:
        raw_output = _send_single_command(conn, command)
    except (ConnectionError, CommandError) as exc:
        logger.warning('get_zte_metrics: fallo de conexión a %s — %s', conn.ip, exc)
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'alarm': {
                'level':   'error',
                'message': f'No se pudo conectar a la OLT ZTE {conn.ip}: {exc}',
            },
        }

    parsed = _parse_output(conn.brand, 'show_pon_power.textfsm', raw_output)

    if not parsed or 'raw' in parsed[0]:
        logger.warning('get_zte_metrics: TextFSM sin datos en salida de %s', conn.ip)
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'raw':           raw_output,
            'alarm': {
                'level':   'warning',
                'message': 'Datos ópticos ZTE no disponibles — ONU posiblemente offline o no registrada',
            },
        }

    metrics = parsed[0]

    try:
        rx = float(metrics.get('RxPower') or '0')
        tx = float(metrics.get('TxPower') or '0')
    except (ValueError, TypeError) as exc:
        logger.error('get_zte_metrics: error convirtiendo valores — %s | raw=%s', exc, metrics)
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'alarm': {
                'level':   'warning',
                'message': f'No se pudieron interpretar los valores ópticos ZTE: {exc}',
            },
        }

    alarm: dict[str, str] | None = None

    if rx < _RXPOWER_CRITICAL_DBM:
        alarm = {
            'level':   'critical',
            'message': (
                f'RxPower {rx:.2f} dBm por debajo del umbral crítico '
                f'({_RXPOWER_CRITICAL_DBM} dBm) — ONU offline o fibra cortada'
            ),
        }
        logger.warning('ONU %s en ZTE %s: RxPower crítico %.2f dBm', onu.sn, conn.ip, rx)
    elif rx < _RXPOWER_WARN_DBM:
        alarm = {
            'level':   'warning',
            'message': (
                f'RxPower {rx:.2f} dBm degradado '
                f'(alerta en {_RXPOWER_WARN_DBM} dBm)'
            ),
        }

    return {
        'success':       True,
        'rx_power_dbm':  rx,
        'tx_power_dbm':  tx,
        'temperature_c': None,  # ZTE 'show pon power attenuation' no reporta temperatura
        'alarm':         alarm,
    }


# ── VSOL / CData (SNMP) ──────────────────────────────────────

def provision_snmp_onu(
    conn: OltConnectionSchema,
    onu:  OnuProvisionSchema,
) -> dict[str, Any]:
    """
    Aprovisiona una ONU en OLTs VSOL o CData mediante SNMP SET.

    Construye el OID instanciado <base>.<slot>.<port>.<onu_id> y escribe
    el serial number como OctetString en la MIB propietaria del fabricante.

    conn.username = comunidad SNMP de lectura
    conn.password = comunidad SNMP de escritura (para el SET)
    conn.port     = puerto SNMP (161 por defecto en el ERP)

    No usa Netmiko ni SSH — solo UDP SNMP sobre la VPN.
    """
    brand_oids = SNMP_OID_MAP.get(conn.brand)
    if not brand_oids:
        raise ProvisioningError(
            f'Marca "{conn.brand.value}" no tiene OIDs SNMP configurados en snmp_mapping.py'
        )

    oid = f"{brand_oids['provision_sn']}.{onu.slot}.{onu.port}.{onu.onu_id}"

    logger.info(
        'Aprovisionando ONU %s en %s (%s) via SNMP SET | '
        'slot=%d port=%d onu_id=%d OID=%s',
        onu.sn, conn.ip, conn.brand.value,
        onu.slot, onu.port, onu.onu_id, oid,
    )

    try:
        set_snmp_octet_string(
            ip=conn.ip,
            community=conn.password,   # comunidad de escritura
            oid=oid,
            value=onu.sn,
            port=conn.port,
        )
    except SnmpError as exc:
        raise ProvisioningError(
            f'SNMP SET falló para {conn.brand.value} {conn.ip}: {exc}'
        ) from exc

    logger.info('ONU %s aprovisionada via SNMP en %s (%s)', onu.sn, conn.ip, conn.brand.value)
    return {
        'success': True,
        'onu_sn':  onu.sn,
        'slot':    onu.slot,
        'port':    onu.port,
        'onu_id':  onu.onu_id,
        'vlan':    onu.vlan,
        'method':  'snmp',
    }


def get_snmp_metrics(
    conn: OltConnectionSchema,
    onu:  OnuProvisionSchema,
) -> dict[str, Any]:
    """
    Consulta métricas ópticas via SNMP GET para OLTs VSOL y CData.

    El entero devuelto por la MIB (ej: -2540) se divide entre
    SNMP_POWER_SCALE (100) para obtener el valor real en dBm (-25.40).

    conn.username = comunidad SNMP de lectura
    conn.port     = puerto SNMP (161 por defecto en el ERP)

    Nunca propaga excepciones — retorna success=False con alarm ante
    cualquier fallo de red o conversión, igual que los drivers SSH.
    """
    brand_oids = SNMP_OID_MAP.get(conn.brand)
    if not brand_oids:
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'alarm': {
                'level':   'error',
                'message': f'Marca "{conn.brand.value}" no tiene OIDs SNMP de métricas configurados',
            },
        }

    rx_oid = f"{brand_oids['rx_power']}.{onu.slot}.{onu.port}.{onu.onu_id}"
    tx_oid = f"{brand_oids['tx_power']}.{onu.slot}.{onu.port}.{onu.onu_id}"

    try:
        rx_raw = get_snmp_value(ip=conn.ip, community=conn.username, oid=rx_oid, port=conn.port)
        tx_raw = get_snmp_value(ip=conn.ip, community=conn.username, oid=tx_oid, port=conn.port)
    except SnmpError as exc:
        logger.warning(
            'get_snmp_metrics: fallo SNMP en %s (%s) — %s', conn.ip, conn.brand.value, exc
        )
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'alarm': {
                'level':   'error',
                'message': f'No se pudo consultar métricas SNMP en {conn.ip}: {exc}',
            },
        }

    try:
        rx = int(rx_raw) / SNMP_POWER_SCALE
        tx = int(tx_raw) / SNMP_POWER_SCALE
    except (ValueError, TypeError) as exc:
        logger.error(
            'get_snmp_metrics: conversión fallida — %s | rx_raw=%s tx_raw=%s',
            exc, rx_raw, tx_raw,
        )
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'alarm': {
                'level':   'warning',
                'message': f'No se pudieron interpretar los valores SNMP: {exc}',
            },
        }

    alarm: dict[str, str] | None = None

    if rx < _RXPOWER_CRITICAL_DBM:
        alarm = {
            'level':   'critical',
            'message': (
                f'RxPower {rx:.2f} dBm por debajo del umbral crítico '
                f'({_RXPOWER_CRITICAL_DBM} dBm) — ONU offline o fibra cortada'
            ),
        }
        logger.warning(
            'ONU %s en %s (%s): RxPower crítico %.2f dBm',
            onu.sn, conn.ip, conn.brand.value, rx,
        )
    elif rx < _RXPOWER_WARN_DBM:
        alarm = {
            'level':   'warning',
            'message': (
                f'RxPower {rx:.2f} dBm degradado '
                f'(alerta en {_RXPOWER_WARN_DBM} dBm)'
            ),
        }

    return {
        'success':       True,
        'rx_power_dbm':  rx,
        'tx_power_dbm':  tx,
        'temperature_c': None,  # VSOL/CData SNMP no expone temperatura en estos OIDs
        'alarm':         alarm,
    }


# ── Batch status (cron de monitoreo) ─────────────────────────

def get_bulk_metrics_huawei(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
) -> list[dict[str, Any]]:
    """
    Estado y métricas ópticas de todas las ONUs en un puerto Huawei.
    UNA sesión SSH, DOS comandos:
      display ont info 0/slot/port all      → run_state por ONU
      display ont optical-info 0/slot/port all → Rx/Tx/temperatura
    """
    cmds = [
        f'display ont info 0/{slot}/{port} all',
        f'display ont optical-info 0/{slot}/{port} all',
    ]
    status_raw, optical_raw = _open_multi_commands(conn, cmds)

    status_rows  = _parse_output(conn.brand, 'display_ont_info_all.textfsm',    status_raw)
    optical_rows = _parse_output(conn.brand, 'display_ont_optical_all.textfsm', optical_raw)

    # Indexar métricas ópticas por onu_id
    optical_map: dict[int, dict[str, Any]] = {}
    for row in optical_rows:
        if 'raw' in row:
            continue
        try:
            oid  = int(row.get('OnuId')    or 0)
            rx_s = str(row.get('RxPower')  or '').strip()
            tx_s = str(row.get('TxPower')  or '').strip()
            tc_s = str(row.get('TempC')    or '').strip()
            optical_map[oid] = {
                'rx_power_dbm':  float(rx_s) if rx_s not in ('', '-', '--') else None,
                'tx_power_dbm':  float(tx_s) if tx_s not in ('', '-', '--') else None,
                'temperature_c': float(tc_s) if tc_s not in ('', '-', '--') else None,
            }
        except (ValueError, TypeError):
            continue

    result: list[dict[str, Any]] = []
    for row in status_rows:
        if 'raw' in row:
            continue
        try:
            oid = int(row.get('OnuId')     or 0)
            sn  = str(row.get('Sn')        or '').strip() or None
            run = str(row.get('RunState')  or 'unknown').lower()
            opt = optical_map.get(oid, {})
            result.append({
                'slot':          slot,
                'port':          port,
                'onu_id':        oid,
                'sn':            sn,
                'run_state':     run,
                'rx_power_dbm':  opt.get('rx_power_dbm'),
                'tx_power_dbm':  opt.get('tx_power_dbm'),
                'temperature_c': opt.get('temperature_c'),
            })
        except (ValueError, TypeError):
            continue

    return result


def get_bulk_metrics_zte(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
) -> list[dict[str, Any]]:
    """
    Estado de todas las ONUs en un puerto ZTE.
    'show gpon onu state gpon-olt_0/slot/port' → run_state por ONU.
    Métricas ópticas no disponibles en este comando; quedan como None.
    """
    cmd = f'show gpon onu state gpon-olt_0/{slot}/{port}'

    try:
        raw_output = _send_single_command(conn, cmd)
    except (ConnectionError, CommandError) as exc:
        raise ProvisioningError(
            f'No se pudo obtener estado de ONUs ZTE en 0/{slot}/{port}: {exc}'
        ) from exc

    rows = _parse_output(conn.brand, 'show_gpon_onu_state.textfsm', raw_output)

    result: list[dict[str, Any]] = []
    for row in rows:
        if 'raw' in row:
            continue
        try:
            oid     = int(row.get('OnuId') or 0)
            run_raw = str(row.get('RunState') or 'unknown')
            run     = 'online' if run_raw.strip().lower() == 'working' else 'offline'
            result.append({
                'slot':          slot,
                'port':          port,
                'onu_id':        oid,
                'sn':            None,
                'run_state':     run,
                'rx_power_dbm':  None,
                'tx_power_dbm':  None,
                'temperature_c': None,
            })
        except (ValueError, TypeError):
            continue

    return result


def get_bulk_metrics_snmp(
    conn: OltConnectionSchema,
    onus: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Métricas ópticas y estado via SNMP para una lista de ONUs VSOL/CData.
    UDP individual por ONU — no requiere estado de sesión ni lock prolongado.
    """
    brand_oids = SNMP_OID_MAP.get(conn.brand)
    if not brand_oids:
        return []

    result: list[dict[str, Any]] = []
    for onu in onus:
        slot   = onu['slot']
        port   = onu['port']
        onu_id = onu['onu_id']
        rx = tx = None
        state = 'unknown'
        try:
            rx_raw = get_snmp_value(
                ip=conn.ip, community=conn.username,
                oid=f"{brand_oids['rx_power']}.{slot}.{port}.{onu_id}",
                port=conn.port,
            )
            tx_raw = get_snmp_value(
                ip=conn.ip, community=conn.username,
                oid=f"{brand_oids['tx_power']}.{slot}.{port}.{onu_id}",
                port=conn.port,
            )
            st_raw = get_snmp_value(
                ip=conn.ip, community=conn.username,
                oid=f"{brand_oids['onu_status']}.{slot}.{port}.{onu_id}",
                port=conn.port,
            )
            rx    = int(rx_raw) / SNMP_POWER_SCALE if rx_raw is not None else None
            tx    = int(tx_raw) / SNMP_POWER_SCALE if tx_raw is not None else None
            state = 'online' if int(st_raw or 0) == 1 else 'offline'
        except (SnmpError, Exception) as exc:
            logger.warning(
                'SNMP bulk %s ONU %d/%d/%d: %s',
                conn.brand.value, slot, port, onu_id, exc,
            )

        result.append({
            'slot': slot, 'port': port, 'onu_id': onu_id, 'sn': onu.get('sn'),
            'run_state':     state,
            'rx_power_dbm':  rx,
            'tx_power_dbm':  tx,
            'temperature_c': None,
        })

    return result


def get_batch_status(
    conn: OltConnectionSchema,
    onus: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Dispatcher de estado y métricas masivos.

    SSH (Huawei/ZTE): agrupa por (slot, port) → UNA sesión SSH por puerto.
    SNMP (VSOL/CData): itera por ONU → UDP individual, sin estado de sesión.

    Síncrono — llamar desde asyncio.to_thread() en main.py.
    """
    if conn.brand in (OltBrand.VSOL, OltBrand.CDATA):
        return get_bulk_metrics_snmp(conn, onus)

    # SSH: agrupar por (slot, port) para minimizar sesiones SSH
    port_groups: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for onu in onus:
        key = (onu['slot'], onu['port'])
        port_groups.setdefault(key, []).append(onu)

    result: list[dict[str, Any]] = []

    for (slot, port), group in port_groups.items():
        try:
            if conn.brand == OltBrand.HUAWEI:
                batch = get_bulk_metrics_huawei(conn, slot, port)
            elif conn.brand == OltBrand.ZTE:
                batch = get_bulk_metrics_zte(conn, slot, port)
            else:
                raise ProvisioningError(
                    f'Marca {conn.brand.value} no soporta batch-status'
                )
            # Filtrar por los onu_ids solicitados (el comando retorna todos del puerto)
            requested = {o['onu_id'] for o in group}
            result.extend(item for item in batch if item['onu_id'] in requested)
        except ProvisioningError as exc:
            logger.warning(
                'get_batch_status: fallo en puerto %d/%d de %s (%s): %s',
                slot, port, conn.ip, conn.brand.value, exc,
            )
            # Marcar todas las ONUs de este puerto como desconocidas
            for onu in group:
                result.append({
                    'slot': slot, 'port': port,
                    'onu_id': onu['onu_id'], 'sn': onu.get('sn'),
                    'run_state':     'unknown',
                    'rx_power_dbm':  None,
                    'tx_power_dbm':  None,
                    'temperature_c': None,
                })

    return result


# ── Firmware Upgrade (OMCI) ──────────────────────────────────

import os as _os


def _sftp_push_firmware(conn: OltConnectionSchema, local_path: str) -> str:
    """
    Sube el archivo de firmware al flash de la OLT vía SFTP (paramiko directo).
    Retorna el nombre base del archivo para usar en comandos CLI.

    Seguridad: session_log=None, sin logging de credenciales.
    Requiere SFTP activo en la OLT (estándar en Huawei MA5800/MA5600T y ZTE C300/C320).
    """
    import paramiko
    filename = _os.path.basename(local_path)
    transport = paramiko.Transport((conn.ip, conn.port))
    transport.set_keepalive(30)
    transport.banner_timeout = 45
    transport.auth_timeout   = 30
    try:
        transport.connect(username=conn.username, password=conn.password)
        sftp = paramiko.SFTPClient.from_transport(transport)
        try:
            sftp.put(local_path, f'/flash/{filename}')
        finally:
            sftp.close()
    except paramiko.AuthenticationException as exc:
        raise ConnectionError(f'SFTP: autenticación fallida en {conn.ip}') from exc
    except paramiko.SSHException as exc:
        raise ConnectionError(f'SFTP: error SSH en {conn.ip}: {exc}') from exc
    except OSError as exc:
        raise ConnectionError(f'SFTP: error de red en {conn.ip}: {exc}') from exc
    finally:
        transport.close()
    return filename


def upgrade_firmware_huawei(
    conn:       OltConnectionSchema,
    slot:       int,
    port:       int,
    onu_ids:    list[int],
    local_path: str,
) -> list[dict]:
    """
    Actualiza firmware de ONUs Huawei via OMCI.

    Secuencia:
      1. SFTP push del .bin al flash de la OLT (paramiko).
      2. Por cada ONU: 'ont update 0/{slot} {port} {onu_id} filename {fname}'
         — el canal OMCI lo gestiona la OLT; el CLI retorna cuando termina.
      3. Retorna lista de resultados {onu_id, status, message}.

    read_timeout=300 s: OMCI sobre GPON toma 2-5 min por ONU según distancia y
    velocidad de la interfaz PON del modelo.
    """
    filename = _sftp_push_firmware(conn, local_path)
    results: list[dict] = []

    params = _build_netmiko_params(conn)
    try:
        with ConnectHandler(**params) as session:
            for onu_id in onu_ids:
                try:
                    out = session.send_command(
                        f'ont update 0/{slot} {port} {onu_id} filename {filename}',
                        expect_string=r'(?i)(Succeeded|Failed|success|fail|upgrading|error)',
                        read_timeout=300,
                        strip_prompt=True,
                    )
                    lo = out.lower()
                    if any(t in lo for t in ('succeeded', 'success')):
                        results.append({'onu_id': onu_id, 'status': 'success',     'message': out.strip()[:200]})
                    elif any(t in lo for t in ('failed', 'fail', 'error')):
                        results.append({'onu_id': onu_id, 'status': 'failed',      'message': out.strip()[:200]})
                    else:
                        results.append({'onu_id': onu_id, 'status': 'transferring','message': out.strip()[:200]})
                except ReadTimeout:
                    results.append({'onu_id': onu_id, 'status': 'failed', 'message': f'Timeout (>300 s) en ONT {onu_id}'})
                except Exception as exc:
                    results.append({'onu_id': onu_id, 'status': 'failed', 'message': str(exc)[:200]})
    except NetmikoAuthenticationException as exc:
        raise ConnectionError(f'Auth SSH fallida en {conn.ip}') from exc
    except NetmikoTimeoutException as exc:
        raise ConnectionError(f'Timeout SSH a {conn.ip}') from exc
    except OSError as exc:
        raise ConnectionError(f'Error de red a {conn.ip}: {exc}') from exc

    return results


def upgrade_firmware_zte(
    conn:       OltConnectionSchema,
    slot:       int,
    port:       int,
    onu_ids:    list[int],
    local_path: str,
) -> list[dict]:
    """
    Actualiza firmware de ONUs ZTE via OMCI.
    Comando: 'upgrade onu gpon-olt_0/{slot}/{port} {onu_id} filename {fname}'
    """
    filename = _sftp_push_firmware(conn, local_path)
    results: list[dict] = []

    params = _build_netmiko_params(conn)
    try:
        with ConnectHandler(**params) as session:
            for onu_id in onu_ids:
                try:
                    out = session.send_command(
                        f'upgrade onu gpon-olt_0/{slot}/{port} {onu_id} filename {filename}',
                        expect_string=r'(?i)(success|fail|error|complete|finish)',
                        read_timeout=300,
                        strip_prompt=True,
                    )
                    lo = out.lower()
                    if any(t in lo for t in ('success', 'complete', 'finish')):
                        results.append({'onu_id': onu_id, 'status': 'success', 'message': out.strip()[:200]})
                    elif any(t in lo for t in ('fail', 'error')):
                        results.append({'onu_id': onu_id, 'status': 'failed',  'message': out.strip()[:200]})
                    else:
                        results.append({'onu_id': onu_id, 'status': 'transferring', 'message': out.strip()[:200]})
                except ReadTimeout:
                    results.append({'onu_id': onu_id, 'status': 'failed', 'message': f'Timeout (>300 s) en ONT {onu_id}'})
                except Exception as exc:
                    results.append({'onu_id': onu_id, 'status': 'failed', 'message': str(exc)[:200]})
    except NetmikoAuthenticationException as exc:
        raise ConnectionError(f'Auth SSH fallida en {conn.ip}') from exc
    except NetmikoTimeoutException as exc:
        raise ConnectionError(f'Timeout SSH a {conn.ip}') from exc
    except OSError as exc:
        raise ConnectionError(f'Error de red a {conn.ip}: {exc}') from exc

    return results


def upgrade_firmware_onu(
    conn:       OltConnectionSchema,
    slot:       int,
    port:       int,
    onu_ids:    list[int],
    local_path: str,
) -> list[dict]:
    """Dispatcher de firmware upgrade OMCI por marca."""
    if not _os.path.isfile(local_path):
        raise ProvisioningError(f'Archivo de firmware no encontrado: {local_path}')

    if conn.brand == OltBrand.HUAWEI:
        return upgrade_firmware_huawei(conn, slot, port, onu_ids, local_path)
    if conn.brand == OltBrand.ZTE:
        return upgrade_firmware_zte(conn, slot, port, onu_ids, local_path)

    raise ProvisioningError(
        f'Firmware OMCI no soportado para {conn.brand}. '
        'Solo Huawei y ZTE admiten actualización OMCI vía CLI.',
    )


# ── Descubrimiento de ONUs pendientes ────────────────────────

def _filter_onus(
    rows:  list[dict[str, Any]],
    slot:  int | None,
    port:  int | None,
) -> list[dict[str, Any]]:
    """Filtra y normaliza filas TextFSM. Descarta filas sin SN o con valores inválidos."""
    result: list[dict[str, Any]] = []
    for row in rows:
        if 'raw' in row:
            continue
        try:
            # MA5800 devuelve "HWTC-78CA0FAA" con dash — normalizar a "HWTC78CA0FAA"
            sn = str(row.get('OnuSn', '') or '').strip().replace('-', '')
            s  = int(row.get('Slot', -1))
            p  = int(row.get('Port', -1))
        except (ValueError, TypeError):
            continue
        if not sn or s < 0 or p < 0:
            continue
        if slot is not None and s != slot:
            continue
        if port is not None and p != port:
            continue
        ont_model = str(row.get('OntModel') or '').strip() or None
        result.append({'sn': sn, 'slot': s, 'port': p, 'ont_model': ont_model})
    return result


def _paramiko_huawei_run(
    conn:        OltConnectionSchema,
    commands:    list[str],
    timeout:     float = 60.0,
    return_list: bool  = False,
) -> 'str | list[str]':
    """
    Abre una sesión SSH con Paramiko (invoke_shell) y ejecuta una lista de comandos
    en la OLT Huawei, manejando el prompt de confirmación { <cr>||<K> }: y el
    escalado a enable.

    return_list=False (default): retorna la salida acumulada de todos los comandos
    como un único string (comportamiento original).
    return_list=True: retorna una lista con la salida individual de cada comando.

    Evita completamente la session_preparation de Netmiko (que envía
    screen-length 0 temporary y se traba en el prompt de confirmación del MA5800).
    """
    import paramiko

    PROMPT_RE = re.compile(r'^\S+[>#]\s*$')
    CONFIRM_RE = re.compile(r'\{\s*<cr>')

    def _read_until_prompt(chan: 'paramiko.Channel', deadline: float) -> str:
        buf = ''
        while _time_read.monotonic() < deadline:
            if chan.recv_ready():
                buf += chan.recv(4096).decode('utf-8', errors='replace')
                last = buf.rsplit('\n', 1)[-1].replace('\r', '').strip()
                if CONFIRM_RE.search(last):
                    chan.send('\r\n')
                    continue
                if PROMPT_RE.match(last):
                    break
            _time_read.sleep(0.05)
        return buf

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(
            hostname=conn.ip, port=conn.port,
            username=conn.username, password=conn.password,
            timeout=15, look_for_keys=False, allow_agent=False,
        )
        chan = ssh.invoke_shell(width=200, height=50)
        chan.settimeout(timeout)
        deadline = _time_read.monotonic() + timeout

        # Leer banner inicial hasta prompt
        _read_until_prompt(chan, deadline)

        # Escalar a enable si el prompt termina en >
        chan.send('enable\r\n')
        _time_read.sleep(0.1)
        buf_enable = _read_until_prompt(chan, deadline)
        if '>' in buf_enable and '#' not in buf_enable:
            # requirió password de enable
            chan.send((conn.password or '') + '\r\n')
            _read_until_prompt(chan, deadline)

        # screen-length 0 temporary — puede mostrar { <cr>||<K> }:
        chan.send('screen-length 0 temporary\r\n')
        _read_until_prompt(chan, deadline)

        # Ejecutar cada comando y acumular salida
        output_parts: list[str] = []
        for cmd in commands:
            chan.send(cmd + '\r\n')
            part = _read_until_prompt(chan, deadline)
            output_parts.append(part)

        chan.close()
        ssh.close()
        return output_parts if return_list else '\n'.join(output_parts)

    except paramiko.AuthenticationException as exc:
        raise ProvisioningError(f'Autenticación fallida en Huawei {conn.ip}') from exc
    except (paramiko.SSHException, OSError, TimeoutError) as exc:
        raise ProvisioningError(f'Error SSH en Huawei {conn.ip}: {exc}') from exc


def discover_huawei_onus(
    conn: OltConnectionSchema,
    slot: int | None = None,
    port: int | None = None,
) -> list[dict[str, Any]]:
    """
    Lista ONUs no autorizadas en OLT Huawei mediante 'display ont autofind all'.
    Usa Paramiko directo para evitar la session_preparation de Netmiko
    (que se traba en el prompt { <cr>||<K> }: del MA5800).
    """
    logger.info('discover_huawei_onus: consultando ONUs pendientes en %s', conn.ip)

    try:
        raw_output = _paramiko_huawei_run(
            conn, ['display ont autofind all'], timeout=settings.ssh_command_timeout,
        )
    except ProvisioningError:
        raise
    except Exception as exc:
        raise ProvisioningError(
            f'No se pudo consultar ONUs pendientes en Huawei {conn.ip}: {exc}'
        ) from exc

    parsed = _parse_output(conn.brand, 'display_ont_autofind.textfsm', raw_output)
    onus   = _filter_onus(parsed, slot, port)

    logger.info(
        'discover_huawei_onus: %d ONU(s) pendientes en %s (filtro slot=%s port=%s)',
        len(onus), conn.ip, slot, port,
    )
    return onus


def discover_zte_onus(
    conn: OltConnectionSchema,
    slot: int | None = None,
    port: int | None = None,
) -> list[dict[str, Any]]:
    """
    Lista ONUs no configuradas en OLT ZTE mediante 'show gpon onu unconfigured'.

    Retorna lista de dicts [{'sn': ..., 'slot': ..., 'port': ...}].
    Propaga ProvisioningError en caso de fallo SSH.
    """
    command = 'show gpon onu unconfigured'
    logger.info('discover_zte_onus: consultando ONUs pendientes en %s', conn.ip)

    try:
        raw_output = _send_single_command(conn, command)
    except (ConnectionError, CommandError) as exc:
        raise ProvisioningError(
            f'No se pudo consultar ONUs pendientes en ZTE {conn.ip}: {exc}'
        ) from exc

    parsed = _parse_output(conn.brand, 'show_gpon_onu_uncfg.textfsm', raw_output)
    onus   = _filter_onus(parsed, slot, port)

    logger.info(
        'discover_zte_onus: %d ONU(s) pendientes en %s (filtro slot=%s port=%s)',
        len(onus), conn.ip, slot, port,
    )
    return onus


def discover_onus(
    conn: OltConnectionSchema,
    slot: int | None = None,
    port: int | None = None,
) -> list[dict[str, Any]]:
    """
    Dispatcher de descubrimiento de ONUs no autorizadas.
    Síncrono — llamar desde asyncio.to_thread() en main.py.
    """
    handlers = {
        OltBrand.HUAWEI: discover_huawei_onus,
        OltBrand.ZTE:    discover_zte_onus,
    }
    handler = handlers.get(conn.brand)
    if handler is None:
        raise ProvisioningError(
            f'Marca "{conn.brand.value}" no soporta descubrimiento automático de ONUs'
        )
    return handler(conn, slot=slot, port=port)


# ── Operaciones Huawei MA5800 — Perfiles, Reset, Topología, Versión ──────────

def list_huawei_profiles(conn: OltConnectionSchema) -> dict[str, Any]:
    """
    Consulta en una sola sesión SSH los tres tipos de perfiles de la MA5800:
      display ont-lineprofile all   → line profiles (DBA + GEM mapping)
      display ont-srvprofile all    → service profiles (tipo de servicio)
      display traffic table all     → traffic tables (CIR/PIR para service-port)

    Retorna dict con 'lineprofiles', 'srvprofiles' y 'traffic_tables'.
    Síncrono — llamar desde asyncio.to_thread().
    """
    cmds = [
        'display ont-lineprofile all',
        'display ont-srvprofile all',
        'display traffic table all',
    ]
    try:
        lp_raw, sp_raw, tt_raw = _open_multi_commands(conn, cmds)
    except (ConnectionError, CommandError) as exc:
        logger.warning('list_huawei_profiles: fallo SSH en %s — %s', conn.ip, exc)
        return {
            'success': False,
            'error':   str(exc),
            'lineprofiles':   [],
            'srvprofiles':    [],
            'traffic_tables': [],
        }

    def _parse_profiles(raw: str, fsm_name: str) -> list[dict[str, Any]]:
        rows = _parse_output(conn.brand, fsm_name, raw)
        result = []
        for row in rows:
            if 'raw' in row:
                continue
            try:
                pid  = int(row.get('ProfileId') or -1)
                name = str(row.get('ProfileName') or '').strip()
            except (ValueError, TypeError):
                continue
            if pid < 0 or not name:
                continue
            result.append({'profile_id': pid, 'name': name})
        return result

    def _parse_traffic_tables(raw: str) -> list[dict[str, Any]]:
        rows = _parse_output(conn.brand, 'display_traffic_table_all.textfsm', raw)
        result = []
        for row in rows:
            if 'raw' in row:
                continue
            try:
                idx  = int(row.get('TrafficIndex') or -1)
                name = str(row.get('TrafficName')  or '').strip()
                cir  = int(row.get('Cir') or 0)
                pir  = int(row.get('Pir') or 0)
            except (ValueError, TypeError):
                continue
            if idx < 0:
                continue
            result.append({'index': idx, 'name': name, 'cir_kbps': cir, 'pir_kbps': pir})
        return result

    lineprofiles   = _parse_profiles(lp_raw, 'display_ont_lineprofile_all.textfsm')
    srvprofiles    = _parse_profiles(sp_raw, 'display_ont_srvprofile_all.textfsm')
    traffic_tables = _parse_traffic_tables(tt_raw)

    logger.info(
        'list_huawei_profiles: %s → %d lineprofiles, %d srvprofiles, %d traffic-tables',
        conn.ip, len(lineprofiles), len(srvprofiles), len(traffic_tables),
    )
    return {
        'success':        True,
        'lineprofiles':   lineprofiles,
        'srvprofiles':    srvprofiles,
        'traffic_tables': traffic_tables,
    }


def reset_huawei_onu(
    conn:   OltConnectionSchema,
    slot:   int,
    port:   int,
    onu_id: int,
) -> dict[str, Any]:
    """
    Reinicia una ONU Huawei MA5800 vía comando 'ont reset'.

    El comando pide confirmación "Are you sure? (y/n)[n]:" → insertar 'y'.
    Síncrono — llamar desde asyncio.to_thread().
    """
    commands = [
        'config',
        f'interface gpon 0/{slot}',
        f'ont reset {port} {onu_id}',
        'y',    # confirmación interactiva de MA5800
        'quit',
        'quit',
    ]
    logger.info(
        'reset_huawei_onu: reiniciando ONU slot=%d port=%d onu_id=%d en %s',
        slot, port, onu_id, conn.ip,
    )
    raw_output = _send_config_set(conn, commands)

    # 'y' puede producir "Invalid input" si la versión no pide confirmación.
    # Verificar que el propio 'ont reset' no reportó error (ignorar línea de 'y').
    reset_output = raw_output
    _check_cli_error(conn.brand, 'reset_huawei_onu', reset_output)

    logger.info('reset_huawei_onu: ONU slot=%d port=%d onu_id=%d reiniciada en %s', slot, port, onu_id, conn.ip)
    return {
        'success': True,
        'message': f'ONU slot={slot} port={port} onu_id={onu_id} reiniciada',
        'slot':    slot,
        'port':    port,
        'onu_id':  onu_id,
    }


def display_huawei_board(conn: OltConnectionSchema) -> dict[str, Any]:
    """
    Consulta la topología física de la OLT Huawei: slots y tarjetas instaladas.
    Comando: display board 0
    Retorna lista de slots con board_name, status y contadores online/offline.
    Síncrono — llamar desde asyncio.to_thread().
    """
    try:
        raw_output = _send_single_command(conn, 'display board 0')
    except (ConnectionError, CommandError) as exc:
        logger.warning('display_huawei_board: fallo en %s — %s', conn.ip, exc)
        return {'success': False, 'error': str(exc), 'slots': []}

    rows = _parse_output(conn.brand, 'display_board_0.textfsm', raw_output)
    slots: list[dict[str, Any]] = []
    for row in rows:
        if 'raw' in row:
            continue
        try:
            slot_id    = int(row.get('SlotId') or -1)
            board_name = str(row.get('BoardName') or '').strip()
            status     = str(row.get('Status')    or '').strip().lower()
            oo_str     = str(row.get('OnlineOffline') or '-/-').strip()
        except (ValueError, TypeError):
            continue
        if slot_id < 0 or not board_name:
            continue
        parts = oo_str.split('/')
        online  = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 0
        offline = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        slots.append({
            'slot_id':      slot_id,
            'board_name':   board_name,
            'status':       status,
            'online_onus':  online,
            'offline_onus': offline,
        })

    logger.info('display_huawei_board: %s → %d slots', conn.ip, len(slots))
    return {'success': True, 'slots': slots}


def get_huawei_ont_version(
    conn:   OltConnectionSchema,
    slot:   int,
    port:   int,
    onu_id: int,
) -> dict[str, Any]:
    """
    Consulta la versión de firmware de una ONU Huawei.
    Comando: display ont version 0/slot/port onu_id
    Retorna ont_version, software_version y equipment_id.
    Síncrono — llamar desde asyncio.to_thread().
    """
    command = f'display ont version 0/{slot}/{port} {onu_id}'
    try:
        raw_output = _send_single_command(conn, command)
    except (ConnectionError, CommandError) as exc:
        logger.warning('get_huawei_ont_version: fallo en %s — %s', conn.ip, exc)
        return {'success': False, 'error': str(exc)}

    rows = _parse_output(conn.brand, 'display_ont_version.textfsm', raw_output)
    if not rows or 'raw' in rows[0]:
        logger.warning(
            'get_huawei_ont_version: sin datos para slot=%d port=%d onu_id=%d en %s',
            slot, port, onu_id, conn.ip,
        )
        return {'success': False, 'error': 'Datos de versión no disponibles'}

    row = rows[0]
    return {
        'success':          True,
        'ont_version':      (str(row.get('OntVersion')      or '')).strip() or None,
        'software_version': (str(row.get('SoftwareVersion') or '')).strip() or None,
        'equipment_id':     (str(row.get('EquipmentId')     or '')).strip() or None,
    }


# ── VLAN / Traffic-Table CLI ──────────────────────────────────

def add_vlan(
    conn:    OltConnectionSchema,
    vlan_id: int,
    name:    str,
) -> dict[str, Any]:
    """
    Crea una VLAN en la OLT Huawei MA5800.
    Comandos: config → vlan {id} smart → vlan desc {id} {name} → quit
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'add_vlan no implementado para marca: {conn.brand.value}')

    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '_', name)[:64]
    commands = [
        'config',
        f'vlan {vlan_id} smart',
        f'vlan desc {vlan_id} {safe_name}',
        'quit',
    ]
    logger.info('add_vlan: vlan_id=%d name=%s en %s', vlan_id, safe_name, conn.ip)
    try:
        output = _send_config_set(conn, commands)
        _check_cli_error(conn.brand, 'add_vlan', output)
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except (ConnectionError, ProvisioningError) as exc:
        return {'success': False, 'error': str(exc)}
    logger.info('add_vlan: VLAN %d creada en %s', vlan_id, conn.ip)
    return {'success': True, 'vlan_id': vlan_id}


def delete_vlan(
    conn:    OltConnectionSchema,
    vlan_id: int,
) -> dict[str, Any]:
    """
    Elimina una VLAN de la OLT Huawei MA5800.
    Comando: config → undo vlan {id} → quit
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'delete_vlan no implementado para marca: {conn.brand.value}')

    commands = ['config', f'undo vlan {vlan_id}', 'quit']
    logger.info('delete_vlan: vlan_id=%d en %s', vlan_id, conn.ip)
    try:
        output = _send_config_set(conn, commands)
        _check_cli_error(conn.brand, 'delete_vlan', output)
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except (ConnectionError, ProvisioningError) as exc:
        return {'success': False, 'error': str(exc)}
    logger.info('delete_vlan: VLAN %d eliminada en %s', vlan_id, conn.ip)
    return {'success': True}


def add_traffic_table(
    conn:     OltConnectionSchema,
    name:     str,
    cir_kbps: int,
    pir_kbps: int,
) -> dict[str, Any]:
    """
    Crea un traffic table en la OLT Huawei MA5800.
    Tras crear, ejecuta display traffic table all para obtener el índice asignado.
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'add_traffic_table no implementado para marca: {conn.brand.value}')

    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '_', name)[:64]
    commands = [
        'config',
        (f'traffic table ip name {safe_name} cir {cir_kbps} pir {pir_kbps} '
         f'priority 0 priority-policy local-setting'),
        'quit',
    ]
    logger.info('add_traffic_table: name=%s cir=%d pir=%d en %s', safe_name, cir_kbps, pir_kbps, conn.ip)
    try:
        output = _send_config_set(conn, commands)
        _check_cli_error(conn.brand, 'add_traffic_table', output)
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except (ConnectionError, ProvisioningError) as exc:
        return {'success': False, 'error': str(exc)}

    # Consultar índice asignado
    try:
        all_raw = _send_single_command(conn, 'display traffic table all')
        rows    = _parse_output(conn.brand, 'display_traffic_table_all.textfsm', all_raw)
        for row in rows:
            if 'raw' in row:
                continue
            if str(row.get('TrafficName') or '').strip() == safe_name:
                try:
                    idx = int(row.get('TrafficIndex') or -1)
                except (ValueError, TypeError):
                    continue
                if idx >= 0:
                    logger.info('add_traffic_table: %s → index=%d en %s', safe_name, idx, conn.ip)
                    return {'success': True, 'index': idx, 'name': safe_name}
    except (ConnectionError, CommandError) as exc:
        logger.warning('add_traffic_table: tabla creada pero no se pudo obtener índice en %s — %s', conn.ip, exc)

    return {'success': True, 'index': None, 'name': safe_name}


def delete_traffic_table(
    conn:  OltConnectionSchema,
    index: int,
) -> dict[str, Any]:
    """
    Elimina un traffic table de la OLT Huawei MA5800 por índice.
    Comando: config → undo traffic table ip index {index} → quit
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'delete_traffic_table no implementado para marca: {conn.brand.value}')

    commands = ['config', f'undo traffic table ip index {index}', 'quit']
    logger.info('delete_traffic_table: index=%d en %s', index, conn.ip)
    try:
        output = _send_config_set(conn, commands)
        _check_cli_error(conn.brand, 'delete_traffic_table', output)
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except (ConnectionError, ProvisioningError) as exc:
        return {'success': False, 'error': str(exc)}
    logger.info('delete_traffic_table: index=%d eliminado en %s', index, conn.ip)
    return {'success': True}


def edit_traffic_table(
    conn:     OltConnectionSchema,
    index:    int,
    name:     str,
    cir_kbps: int,
    pir_kbps: int,
) -> dict[str, Any]:
    """
    Edita un traffic table Huawei MA5800: elimina por índice y lo recrea.
    Huawei CLI no permite rename in-place; retorna el nuevo índice asignado.
    Prerequisito: el caller (NestJS) debe haber verificado que no hay ONUs
    en uso antes de llamar este endpoint.
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'edit_traffic_table no implementado para marca: {conn.brand.value}')

    del_result = delete_traffic_table(conn, index)
    if not del_result['success']:
        return {
            'success': False,
            'error':   f'Fallo al eliminar tabla index={index}: {del_result.get("error")}',
        }

    add_result = add_traffic_table(conn, name, cir_kbps, pir_kbps)
    if not add_result['success']:
        return {
            'success': False,
            'error':   f'Tabla eliminada pero fallo al recrear "{name}": {add_result.get("error")}',
        }

    return {'success': True, 'new_index': add_result.get('index')}


# ── Dispatchers públicos ──────────────────────────────────────

def provision_onu(
    conn: OltConnectionSchema,
    onu: OnuProvisionSchema,
) -> dict[str, Any]:
    """
    Dispatcher de aprovisionamiento.  Delega a la función de la marca.
    Síncrono — llamar desde asyncio.to_thread() en main.py.
    """
    handlers = {
        OltBrand.HUAWEI: provision_huawei_onu,
        OltBrand.ZTE:    provision_zte_onu,
        OltBrand.VSOL:   provision_snmp_onu,
        OltBrand.CDATA:  provision_snmp_onu,
    }
    handler = handlers.get(conn.brand)
    if handler is None:
        raise ProvisioningError(
            f'Marca "{conn.brand.value}" aún no tiene driver de aprovisionamiento implementado'
        )
    return handler(conn, onu)


def get_onu_metrics(
    conn: OltConnectionSchema,
    onu: OnuProvisionSchema,
) -> dict[str, Any]:
    """
    Dispatcher de métricas ópticas.  Delega a la función de la marca.
    Nunca propaga excepciones de red — retorna success=False con alarm.
    Síncrono — llamar desde asyncio.to_thread() en main.py.
    """
    handlers = {
        OltBrand.HUAWEI: get_huawei_metrics,
        OltBrand.ZTE:    get_zte_metrics,
        OltBrand.VSOL:   get_snmp_metrics,
        OltBrand.CDATA:  get_snmp_metrics,
    }
    handler = handlers.get(conn.brand)
    if handler is None:
        return {
            'success':       False,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'alarm': {
                'level':   'error',
                'message': f'Marca "{conn.brand.value}" no soporta consulta de métricas nativas',
            },
        }
    return handler(conn, onu)


# ── Deprovision ONU ───────────────────────────────────────────

def _check_deprovision_error(brand: OltBrand, context: str, output: str) -> None:
    """
    Delega en _check_cli_error (reutiliza los mismos patrones de error
    de la marca).  Función separada por claridad semántica en logs.
    """
    _check_cli_error(brand, context, output)


def deprovision_huawei_onu(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
    onu_id: int,
    service_port_id: int | None,
) -> dict[str, Any]:
    """
    Elimina una ONU de una OLT Huawei MA5800/MA5600.

    Orden CLI correcto:
      1. `ont delete` — desvincula la ONU del puerto PON
      2. `undo service-port` — elimina el servicio de datos del cliente

    Si service_port_id es None, se omite el paso 2 (puede ocurrir si la
    ONU nunca completó el aprovisionamiento completo).
    """
    if service_port_id is None:
        logger.warning(
            'deprovision_huawei_onu: service_port_id no provisto para slot=%d port=%d onu_id=%d'
            ' en %s — se omitirá undo service-port',
            slot, port, onu_id, conn.ip,
        )

    context: dict[str, Any] = {
        'slot':            slot,
        'port':            port,
        'onu_id':          onu_id,
        'service_port_id': service_port_id if service_port_id is not None else 0,
    }

    rendered = _render_commands(conn.brand, 'deprovision_onu.j2', context)
    commands: list[str] = [
        line.strip()
        for line in rendered.strip().splitlines()
        if line.strip() and not line.strip().startswith('{#')
    ]

    # Si no hay service_port_id, filtrar la línea 'undo service-port 0'
    if service_port_id is None:
        commands = [c for c in commands if not c.startswith('undo service-port')]

    # Confirmación de save (igual que en provisioning)
    try:
        save_idx = commands.index('save')
        commands.insert(save_idx + 1, 'y')
    except ValueError:
        pass

    logger.info(
        'Desaprovisionando ONU en Huawei %s slot=%d port=%d onu_id=%d service_port=%s',
        conn.ip, slot, port, onu_id, service_port_id,
    )

    raw_output = _send_config_set(conn, commands)
    _check_deprovision_error(conn.brand, 'deprovision_huawei_onu', raw_output)

    logger.info(
        'ONU slot=%d port=%d onu_id=%d eliminada correctamente de Huawei %s',
        slot, port, onu_id, conn.ip,
    )
    return {
        'success':         True,
        'output':          raw_output,
        'slot':            slot,
        'port':            port,
        'onu_id':          onu_id,
        'service_port_id': service_port_id,
    }


def deprovision_zte_onu(
    conn: OltConnectionSchema,
    rack: int,
    slot: int,
    port: int,
    onu_id: int,
) -> dict[str, Any]:
    """
    Elimina una ONU de una OLT ZTE ZXA10 C300/C320.

    El comando `no onu <onu_id>` dentro de la interfaz gpon-olt_R/S/P
    es atómico: elimina la ONU y todos sus servicios asociados (tcont,
    gemport, switchport, pon-onu-mng).
    """
    context: dict[str, Any] = {
        'rack':   rack,
        'slot':   slot,
        'port':   port,
        'onu_id': onu_id,
    }

    rendered = _render_commands(conn.brand, 'deprovision_onu.j2', context)
    commands: list[str] = [
        line.strip()
        for line in rendered.strip().splitlines()
        if line.strip() and not line.strip().startswith('{#')
    ]

    commands.extend(['end', 'write'])

    logger.info(
        'Desaprovisionando ONU en ZTE %s rack=%d slot=%d port=%d onu_id=%d',
        conn.ip, rack, slot, port, onu_id,
    )

    raw_output = _send_config_set(conn, commands)
    _check_deprovision_error(conn.brand, 'deprovision_zte_onu', raw_output)

    logger.info(
        'ONU rack=%d slot=%d port=%d onu_id=%d eliminada correctamente de ZTE %s',
        rack, slot, port, onu_id, conn.ip,
    )
    return {
        'success': True,
        'output':  raw_output,
        'rack':    rack,
        'slot':    slot,
        'port':    port,
        'onu_id':  onu_id,
    }


def deprovision_onu(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
    onu_id: int,
    service_port_id: int | None = None,
    rack: int = 0,
) -> dict[str, Any]:
    """
    Dispatcher público de desaprovisionamiento.
    Síncrono — llamar desde asyncio.to_thread() en main.py.
    VSOL/CDATA no soportan desaprovisionamiento nativo SSH/SNMP en esta versión.
    """
    if conn.brand == OltBrand.HUAWEI:
        return deprovision_huawei_onu(conn, slot, port, onu_id, service_port_id)
    if conn.brand == OltBrand.ZTE:
        return deprovision_zte_onu(conn, rack, slot, port, onu_id)
    raise ProvisioningError(
        f'Desaprovisionamiento nativo no implementado para marca "{conn.brand.value}". '
        'Usa la API de SmartOLT para VSOL/CDATA.'
    )


# ── Verify ONU ────────────────────────────────────────────────

def verify_huawei_onu(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
    onu_id: int,
) -> dict[str, Any]:
    """
    Consulta el estado operativo y métricas ópticas de una ONU Huawei MA5800.

    Abre UNA sesión SSH y ejecuta DOS comandos en secuencia:
      display ont info 0/slot/port onu_id         → run_state + perfil vinculado
      display ont optical-info 0/slot/port onu_id → Rx/Tx/Temperatura

    Ambos comandos funcionan desde el modo exec sin entrar en config,
    lo que reduce el overhead a un único handshake SSH.
    """
    info_cmd    = f'display ont info 0/{slot}/{port} {onu_id}'
    optical_cmd = f'display ont optical-info 0/{slot}/{port} {onu_id}'

    try:
        info_raw, optical_raw = _open_multi_commands(conn, [info_cmd, optical_cmd])
    except (ConnectionError, CommandError) as exc:
        logger.warning(
            'verify_huawei_onu: fallo SSH para slot=%d port=%d onu_id=%d en %s — %s',
            slot, port, onu_id, conn.ip, exc,
        )
        return {
            'success':       False,
            'run_state':     None,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'error':         str(exc),
        }

    # ── Parsear estado de ONU ─────────────────────────────────
    info_rows = _parse_output(conn.brand, 'display_ont_info_single.textfsm', info_raw)
    if not info_rows or 'raw' in info_rows[0]:
        logger.warning(
            'verify_huawei_onu: sin datos de estado para slot=%d port=%d onu_id=%d en %s',
            slot, port, onu_id, conn.ip,
        )
        run_state = 'unknown'
    else:
        run_state = (info_rows[0].get('RunState') or 'unknown').lower().strip()

    # ── Parsear métricas ópticas ──────────────────────────────
    optical_rows = _parse_output(conn.brand, 'display_ont_optical_info.textfsm', optical_raw)
    rx_power = tx_power = temperature = None
    if optical_rows and 'raw' not in optical_rows[0]:
        opt = optical_rows[0]
        try:
            rx_s = str(opt.get('RxPower') or '').strip()
            tx_s = str(opt.get('TxPower') or '').strip()
            tc_s = str(opt.get('Temp')    or '').strip()
            if rx_s not in ('', '-', '--'):
                rx_power    = float(rx_s)
            if tx_s not in ('', '-', '--'):
                tx_power    = float(tx_s)
            if tc_s not in ('', '-', '--'):
                temperature = int(float(tc_s))
        except (ValueError, TypeError) as exc:
            logger.warning('verify_huawei_onu: conversión óptica fallida — %s', exc)

    return {
        'success':       True,
        'run_state':     run_state,
        'rx_power_dbm':  rx_power,
        'tx_power_dbm':  tx_power,
        'temperature_c': temperature,
    }


def verify_zte_onu(
    conn: OltConnectionSchema,
    rack: int,
    slot: int,
    port: int,
    onu_id: int,
) -> dict[str, Any]:
    """
    Consulta el estado operativo de una ONU en ZTE.
    Comando: show gpon onu detail-info gpon-onu_R/S/P:onu_id
    """
    command = f'show gpon onu detail-info gpon-onu_{rack}/{slot}/{port}:{onu_id}'
    raw_output = _send_single_command(conn, command)

    rows = _parse_output(conn.brand, 'show_gpon_onu_detail.textfsm', raw_output)
    if not rows:
        logger.warning(
            'verify_zte_onu: sin datos parseados para gpon-onu_%d/%d/%d:%d en %s',
            rack, slot, port, onu_id, conn.ip,
        )
        return {
            'success':       True,
            'run_state':     'unknown',
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
        }

    row = rows[0]
    run_state_raw: str = (row.get('RunState') or 'unknown')
    # Normalizar estado ZTE a términos comunes
    state_map = {
        'working':     'online',
        'not working': 'offline',
        'ranging':     'offline',
        'dyingasp':    'dyinggasp',
        'fail':        'los',
    }
    run_state = state_map.get(run_state_raw.lower(), run_state_raw.lower())

    rx_raw = row.get('RxPower')
    tx_raw = row.get('TxPower')

    return {
        'success':       True,
        'run_state':     run_state,
        'rx_power_dbm':  float(rx_raw) if rx_raw else None,
        'tx_power_dbm':  float(tx_raw) if tx_raw else None,
        'temperature_c': None,  # ZTE no reporta temperatura en este comando
    }


def verify_onu(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
    onu_id: int,
    rack: int = 0,
) -> dict[str, Any]:
    """
    Dispatcher público de verificación post-aprovisionamiento.
    Síncrono — llamar desde asyncio.to_thread() en main.py.
    Nunca propaga excepciones — retorna success=False con error en caso de fallo.
    """
    try:
        if conn.brand == OltBrand.HUAWEI:
            return verify_huawei_onu(conn, slot, port, onu_id)
        if conn.brand == OltBrand.ZTE:
            return verify_zte_onu(conn, rack, slot, port, onu_id)
        return {
            'success':   False,
            'run_state': None,
            'error':     f'Verificación no implementada para marca "{conn.brand.value}"',
        }
    except (ConnectionError, CommandError, ProvisioningError) as exc:
        logger.warning('verify_onu falló para %s slot=%d port=%d onu_id=%d: %s',
                       conn.ip, slot, port, onu_id, exc)
        return {
            'success':       False,
            'run_state':     None,
            'rx_power_dbm':  None,
            'tx_power_dbm':  None,
            'temperature_c': None,
            'error':         str(exc),
        }


def test_olt_connection(conn: OltConnectionSchema) -> dict[str, Any]:
    """
    Prueba de conectividad SSH liviana usando Paramiko directamente.
    Evita la session_preparation de Netmiko (que envía screen-length 0 temporary
    y se traba en el prompt de confirmación { <cr>||<K> }: del MA5800).
    Síncrono — llamar desde asyncio.to_thread() en main.py.
    """
    import paramiko

    t0 = _time_read.monotonic()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(
            hostname=conn.ip,
            port=conn.port,
            username=conn.username,
            password=conn.password,
            timeout=15,
            look_for_keys=False,
            allow_agent=False,
        )
        chan = ssh.invoke_shell()
        chan.settimeout(10)
        data = b''
        deadline = _time_read.monotonic() + 10
        while _time_read.monotonic() < deadline:
            if chan.recv_ready():
                data += chan.recv(4096)
                if b'>' in data or b'#' in data:
                    break
            _time_read.sleep(0.1)
        chan.close()
        ssh.close()
        latency_ms = int((_time_read.monotonic() - t0) * 1000)
        if b'>' in data or b'#' in data:
            logger.info('test_olt_connection OK | %s latencia=%dms', conn.ip, latency_ms)
            return {'success': True, 'latency_ms': latency_ms}
        return {'success': False, 'latency_ms': latency_ms,
                'error': 'Conexión establecida pero sin prompt reconocible'}
    except paramiko.AuthenticationException:
        latency_ms = int((_time_read.monotonic() - t0) * 1000)
        logger.warning('test_olt_connection auth fail | %s', conn.ip)
        return {'success': False, 'latency_ms': latency_ms, 'error': 'Credenciales incorrectas'}
    except (paramiko.SSHException, OSError, TimeoutError) as exc:
        latency_ms = int((_time_read.monotonic() - t0) * 1000)
        logger.warning('test_olt_connection error | %s: %s', conn.ip, exc)
        return {'success': False, 'latency_ms': latency_ms, 'error': str(exc)}


# ── FTTH Two-Phase Provisioning ───────────────────────────────
#
# Fase 1: provision_gpon_ftth   — ont add + service-port (sin WAN config)
# Fase 1r: rollback_gpon        — undo service-port + undo ont add
# Fase 1b: poll_onu_online      — espera que la ONU aparezca online (max 90s)
# Fase 2: inject_wan_pppoe      — ont wan-config add vía OMCI (PPPoE client en ONU)
#
# Todas usan _paramiko_huawei_run (bypass Netmiko session_preparation).
# ─────────────────────────────────────────────────────────────


def provision_gpon_ftth(
    conn:           OltConnectionSchema,
    frame:          int,
    slot:           int,
    port:           int,
    onu_id:         int,
    sn:             str,
    service_port_id: int,
    vlan:           int,
    lineprofile_id: int,
    srvprofile_id:  int,
    description:    str | None = None,
) -> dict[str, Any]:
    """
    Fase 1 del aprovisionamiento FTTH nativo.
    Registra la ONU en la OLT con lineprofile/srvprofile y crea el service-port.
    NO configura WAN — eso es responsabilidad de inject_wan_pppoe (Fase 2).

    Usa Paramiko directo para evitar el prompt de confirmación { <cr>||<K> }: del MA5800.
    Síncrono — llamar desde asyncio.to_thread().
    """
    logger.info(
        'provision_gpon_ftth: OLT=%s slot=%d port=%d onu_id=%d sn=%s vlan=%d',
        conn.ip, slot, port, onu_id, sn, vlan,
    )

    desc_part = f' desc "{description}"' if description else ''
    cmds = [
        f'config',
        f'interface gpon 0/{slot}',
        (
            f'ont add {port} {onu_id} sn-auth {sn} omci '
            f'ont-lineprofile-id {lineprofile_id} '
            f'ont-srvprofile-id {srvprofile_id}'
            f'{desc_part}'
        ),
        'quit',
        (
            f'service-port {service_port_id} vlan {vlan} '
            f'gpon 0/{slot}/{port} ont {onu_id} gemport 1 '
            f'user-vlan {vlan} '
            f'inbound traffic-table index 0 '
            f'outbound traffic-table index 0'
        ),
        'save',
    ]

    try:
        raw = _paramiko_huawei_run(conn, cmds, timeout=settings.ssh_command_timeout)
    except ProvisioningError:
        raise
    except Exception as exc:
        raise ProvisioningError(
            f'provision_gpon_ftth falló en {conn.ip}: {exc}'
        ) from exc

    # Detectar errores conocidos de la CLI Huawei en la salida
    error_patterns = [
        'Error:', 'Failure:', 'ont add failed', 'service-port failed',
        'already exists', 'ONT already',
    ]
    for pat in error_patterns:
        if pat.lower() in raw.lower():
            raise ProvisioningError(
                f'CLI Huawei reportó error en {conn.ip}: '
                + next(l for l in raw.splitlines() if pat.lower() in l.lower())
            )

    logger.info('provision_gpon_ftth OK | OLT=%s sn=%s service_port=%d', conn.ip, sn, service_port_id)
    return {'success': True, 'sn': sn, 'olt_ip': conn.ip}


def rollback_gpon(
    conn:           OltConnectionSchema,
    slot:           int,
    port:           int,
    onu_id:         int,
    service_port_id: int | None,
) -> dict[str, Any]:
    """
    Rollback de Fase 1: elimina el service-port y el ont add de la OLT.
    Se ejecuta automáticamente si provision_gpon_ftth falla, y manualmente
    cuando el operador desprovisionó un contrato FTTH.

    No propaga excepciones — si el rollback también falla, lo registra y retorna
    success=False para que el sistema lo marque como requiere_intervencion_manual.
    """
    logger.info(
        'rollback_gpon: OLT=%s slot=%d port=%d onu_id=%d', conn.ip, slot, port, onu_id,
    )
    cmds: list[str] = []
    if service_port_id is not None:
        cmds += ['config', f'undo service-port {service_port_id}']
    cmds += [
        'config',
        f'interface gpon 0/{slot}',
        f'ont delete {port} {onu_id}',
        'quit',
        'save',
    ]
    try:
        _paramiko_huawei_run(conn, cmds, timeout=settings.ssh_command_timeout)
        logger.info('rollback_gpon OK | OLT=%s onu_id=%d', conn.ip, onu_id)
        return {'success': True}
    except Exception as exc:
        logger.error('rollback_gpon FALLO | OLT=%s: %s', conn.ip, exc)
        return {'success': False, 'error': str(exc)}


def poll_onu_online(
    conn:     OltConnectionSchema,
    slot:     int,
    port:     int,
    onu_id:   int,
    max_wait: int = 90,
    interval: int = 5,
) -> dict[str, Any]:
    """
    Fase 1b: consulta display ont info 0/{slot}/{port} ont {onu_id} cada {interval}s
    hasta que el run-state sea 'online' o se agote max_wait.

    Retorna success=True + run_state cuando la ONU sube,
    o success=False + timeout=True si no responde en max_wait segundos.
    """
    logger.info(
        'poll_onu_online: OLT=%s slot=%d port=%d onu_id=%d max=%ds',
        conn.ip, slot, port, onu_id, max_wait,
    )
    cmd    = f'display ont info 0/{slot}/{port} {onu_id}'
    t_end  = _time_read.monotonic() + max_wait

    while _time_read.monotonic() < t_end:
        try:
            raw = _paramiko_huawei_run(conn, [cmd], timeout=20)
        except ProvisioningError as exc:
            logger.warning('poll_onu_online query error: %s', exc)
            _time_read.sleep(interval)
            continue

        for line in raw.splitlines():
            low = line.lower()
            if 'run state' in low or 'run-state' in low:
                if 'online' in low:
                    logger.info('poll_onu_online: ONU online | OLT=%s onu_id=%d', conn.ip, onu_id)
                    return {'success': True, 'run_state': 'online'}
                if any(s in low for s in ('offline', 'dying-gasp', 'los')):
                    logger.info('poll_onu_online: ONU %s | OLT=%s', low.split()[-1], conn.ip)

        _time_read.sleep(interval)

    logger.warning('poll_onu_online: timeout %ds | OLT=%s onu_id=%d', max_wait, conn.ip, onu_id)
    return {'success': False, 'timeout': True, 'run_state': 'unknown'}


def single_poll_check(
    conn:   OltConnectionSchema,
    slot:   int,
    port:   int,
    onu_id: int,
) -> dict[str, Any]:
    """
    Comprobación única de estado ONU — abre conexión SSH, consulta run-state y cierra.
    Diseñado para ser llamado repetidamente desde main.py con lock granular por intento,
    liberando el lock entre verificaciones para no bloquear la OLT 90 segundos.
    """
    cmd = f'display ont info 0/{slot}/{port} {onu_id}'
    try:
        raw = _paramiko_huawei_run(conn, [cmd], timeout=20)
    except ProvisioningError as exc:
        logger.warning('single_poll_check error: %s', exc)
        return {'online': False, 'error': str(exc)}

    for line in raw.splitlines():
        low = line.lower()
        if ('run state' in low or 'run-state' in low) and 'online' in low:
            return {'online': True}
    return {'online': False}


_PPPOE_SAFE_RE = re.compile(r'^[\w\-@\.]{1,64}$')


def inject_wan_pppoe(
    conn:     OltConnectionSchema,
    slot:     int,
    port:     int,
    onu_id:   int,
    vlan:     int,
    username: str,
    password: str,
) -> dict[str, Any]:
    """
    Fase 2: inyecta la configuración WAN PPPoE en la ONU vía OMCI desde la OLT.
    El CLI del MA5800 envía los parámetros a la ONU mediante OMCI sin necesidad
    de acceder directamente al dispositivo del cliente.

    Requiere que la ONU esté online (ejecutar poll_onu_online primero).
    Síncrono — llamar desde asyncio.to_thread().
    """
    if not _PPPOE_SAFE_RE.match(username):
        raise ProvisioningError(
            f'username PPPoE contiene caracteres no permitidos: {username!r}. '
            'Solo se aceptan: letras, dígitos, -, @, .'
        )
    if not _PPPOE_SAFE_RE.match(password):
        raise ProvisioningError(
            'password PPPoE contiene caracteres no permitidos. '
            'Solo se aceptan: letras, dígitos, -, @, .'
        )
    logger.info(
        'inject_wan_pppoe: OLT=%s slot=%d port=%d onu_id=%d vlan=%d user=%s',
        conn.ip, slot, port, onu_id, vlan, username,
    )
    cmds = [
        'config',
        f'interface gpon 0/{slot}',
        (
            f'ont wan-config add {port} {onu_id} '
            f'wan-type internet service-name INTERNET '
            f'user-type pppoe vlan-mode mode-vlan vlan-id {vlan} '
            f'username {username} password {password}'
        ),
        'quit',
        'save',
    ]
    try:
        raw = _paramiko_huawei_run(conn, cmds, timeout=settings.ssh_command_timeout)
    except ProvisioningError:
        raise
    except Exception as exc:
        raise ProvisioningError(f'inject_wan_pppoe falló en {conn.ip}: {exc}') from exc

    error_patterns = ['Error:', 'Failure:', 'wan-config failed', 'Command not found']
    for pat in error_patterns:
        if pat.lower() in raw.lower():
            raise ProvisioningError(
                f'CLI Huawei reportó error en WAN config {conn.ip}: '
                + next((l for l in raw.splitlines() if pat.lower() in l.lower()), pat)
            )

    logger.info('inject_wan_pppoe OK | OLT=%s onu_id=%d user=%s', conn.ip, onu_id, username)
    return {'success': True, 'olt_ip': conn.ip, 'onu_id': onu_id}


# ── Cambio de velocidad en caliente ───────────────────────────

def change_lineprofile(
    conn:            OltConnectionSchema,
    slot:            int,
    port:            int,
    onu_id:          int,
    service_port_id: int,
    traffic_index:   int,
) -> dict[str, Any]:
    """
    Cambia la velocidad de una ONU Huawei MA5800 en caliente modificando
    el traffic-table vinculado al service-port.

    NO cambia el ont-lineprofile (afectaría todas las ONUs del perfil).
    Solo actualiza el inbound/outbound del service-port específico.

    CLI:
      config
      service-port <id> traffic-table index <traffic_index> inbound traffic-table index <traffic_index>

    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(
            f'Cambio de velocidad en caliente no implementado para marca "{conn.brand.value}".'
        )
    logger.info(
        'change_lineprofile: OLT=%s slot=%d port=%d onu_id=%d sp=%d traffic_idx=%d',
        conn.ip, slot, port, onu_id, service_port_id, traffic_index,
    )
    cmds = [
        'config',
        (
            f'service-port {service_port_id} '
            f'traffic-table index {traffic_index} '
            f'inbound traffic-table index {traffic_index}'
        ),
        'save',
    ]
    try:
        raw = _paramiko_huawei_run(conn, cmds, timeout=settings.ssh_command_timeout)
    except ProvisioningError:
        raise
    except Exception as exc:
        raise ProvisioningError(f'change_lineprofile falló en {conn.ip}: {exc}') from exc

    _check_cli_error(conn.brand, 'change_lineprofile', raw)
    logger.info(
        'change_lineprofile OK | OLT=%s sp=%d traffic_index=%d',
        conn.ip, service_port_id, traffic_index,
    )
    return {
        'success':         True,
        'message':         f'Velocidad actualizada: service-port={service_port_id} traffic-table={traffic_index}',
        'service_port_id': service_port_id,
        'traffic_index':   traffic_index,
    }


# ── Suspensión / Rehabilitación por service-port ──────────────

def suspend_onu(
    conn:            OltConnectionSchema,
    slot:            int,
    port:            int,
    onu_id:          int,
    service_port_id: int,
) -> dict[str, Any]:
    """
    Suspende una ONU Huawei MA5800 desactivando su service-port.

    Usa `ont deactivate` dentro de la interfaz GPON para cortar el acceso
    a nivel de protocolo OMCI sin eliminar la configuración. El service-port
    queda intacto en la OLT (no se hace undo service-port).

    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(
            f'Suspensión nativa no implementada para marca "{conn.brand.value}".'
        )
    logger.info(
        'suspend_onu: OLT=%s slot=%d port=%d onu_id=%d service_port=%d',
        conn.ip, slot, port, onu_id, service_port_id,
    )
    cmds = [
        'config',
        f'interface gpon 0/{slot}',
        f'port {port} ont deactivate ontid {onu_id}',
        'quit',
        'save',
    ]
    try:
        raw = _paramiko_huawei_run(conn, cmds, timeout=settings.ssh_command_timeout)
    except ProvisioningError:
        raise
    except Exception as exc:
        raise ProvisioningError(f'suspend_onu falló en {conn.ip}: {exc}') from exc

    _check_cli_error(conn.brand, 'suspend_onu', raw)
    logger.info('suspend_onu OK | OLT=%s slot=%d port=%d onu_id=%d', conn.ip, slot, port, onu_id)
    return {
        'success':         True,
        'message':         f'ONU {onu_id} suspendida en slot={slot} port={port}',
        'olt_ip':          conn.ip,
        'service_port_id': service_port_id,
    }


def rehabilitate_onu(
    conn:            OltConnectionSchema,
    slot:            int,
    port:            int,
    onu_id:          int,
    service_port_id: int,
) -> dict[str, Any]:
    """
    Rehabilita una ONU Huawei MA5800 previamente suspendida.

    Usa `ont activate` para re-habilitar el protocolo OMCI.
    La ONU volverá a negociar GPON y su service-port quedará activo.

    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(
            f'Rehabilitación nativa no implementada para marca "{conn.brand.value}".'
        )
    logger.info(
        'rehabilitate_onu: OLT=%s slot=%d port=%d onu_id=%d service_port=%d',
        conn.ip, slot, port, onu_id, service_port_id,
    )
    cmds = [
        'config',
        f'interface gpon 0/{slot}',
        f'port {port} ont activate ontid {onu_id}',
        'quit',
        'save',
    ]
    try:
        raw = _paramiko_huawei_run(conn, cmds, timeout=settings.ssh_command_timeout)
    except ProvisioningError:
        raise
    except Exception as exc:
        raise ProvisioningError(f'rehabilitate_onu falló en {conn.ip}: {exc}') from exc

    _check_cli_error(conn.brand, 'rehabilitate_onu', raw)
    logger.info(
        'rehabilitate_onu OK | OLT=%s slot=%d port=%d onu_id=%d',
        conn.ip, slot, port, onu_id,
    )
    return {
        'success':         True,
        'message':         f'ONU {onu_id} rehabilitada en slot={slot} port={port}',
        'olt_ip':          conn.ip,
        'service_port_id': service_port_id,
    }
