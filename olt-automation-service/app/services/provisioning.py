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
            try:
                session.send_command('enable', expect_string=r'[>#]', read_timeout=10)
                logger.debug('huawei_enter_enable: modo privilegiado activo en %s', conn.ip)
            except Exception:  # noqa: BLE001
                # enable puede requerir password o no estar disponible.
                # Enviamos \r\n para cancelar cualquier prompt pendiente (Password:)
                # y limpiamos el canal para que el siguiente comando llegue limpio.
                session.write_channel('\r\n')
                _time_read.sleep(0.5)
                session.clear_buffer()
                logger.debug('huawei_enter_enable: enable falló — continuando en modo usuario en %s', conn.ip)
        # Deshabilitar paginación usando _send_huawei_confirmed para manejar
        # correctamente el prompt { <cr>||<K> }: que MA5800 muestra como
        # confirmación antes de aplicar screen-length 0 temporary.
        try:
            _send_huawei_confirmed(session, 'screen-length 0 temporary', 15)
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
    Envía un comando Huawei y maneja el prompt de confirmación/paginación
    '{ <cr>||<K> }:' que el MA5800 muestra. Soporta múltiples páginas:
    cada vez que aparece '{ <cr>' en el último renglón, envía Enter para
    continuar. Termina cuando encuentra el prompt real (hostname> o hostname#).

    Flujo:
      1. Escribe el comando al canal.
      2. Lee chunks en loop; si '{ <cr>' → envía Enter; si prompt real → break.
      4. Limpia el echo del comando y el prompt del output retornado.
    """
    session.write_channel(command + '\r\n')

    data = ''
    deadline = _time_read.monotonic() + read_timeout

    while _time_read.monotonic() < deadline:
        chunk = session.read_channel()
        data += chunk

        # Verificar el último renglón para detectar paginación o prompt real.
        last_line = data.rsplit('\n', 1)[-1].replace('\r', '').strip()

        if '{ <cr>' in last_line:
            # Paginación: responder con Enter y seguir leyendo (puede haber N páginas).
            session.write_channel('\r\n')
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
                # Para Huawei usar _send_huawei_confirmed que maneja correctamente
                # el prompt de paginación { <cr>||<K> }: — send_command() de Netmiko
                # falla porque ese prompt nunca coincide con expect_string r'\S+[>#]'
                # y el OLT queda bloqueado esperando confirmación de página.
                if conn.brand == OltBrand.HUAWEI:
                    output = _send_huawei_confirmed(
                        session, command, float(settings.ssh_command_timeout)
                    )
                else:
                    output = session.send_command(
                        command,
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
    timeout = float(settings.ssh_command_timeout)
    try:
        with ConnectHandler(**params) as session:
            _huawei_enter_enable(session, conn)
            if conn.brand == OltBrand.HUAWEI:
                return [
                    _send_huawei_confirmed(session, cmd, timeout)
                    for cmd in commands
                ]
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
    command = f'display ont optical-info 0 {onu.slot} {onu.port} {onu.onu_id}'

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
        f'display ont info 0 {slot} {port} all',
        f'display ont optical-info 0 {slot} {port} all',
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
            ctl = str(row.get('ControlFlag') or '').strip().lower() or None
            cfg = str(row.get('ConfigState') or '').strip().lower() or None
            opt = optical_map.get(oid, {})
            result.append({
                'slot':          slot,
                'port':          port,
                'onu_id':        oid,
                'sn':            sn,
                'run_state':     run,
                'control_flag':  ctl,
                'config_state':  cfg,
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
    # Huawei MA5800 muestra "---- More ( Press 'Q' to break ) ----" cuando
    # screen-length 0 no se aplicó o hay paginación activa en el comando.
    # Responder con espacio (avanza página) hasta llegar al prompt final.
    MORE_RE   = re.compile(r'----\s*[Mm]ore', re.IGNORECASE)
    # Confirmación interactiva estilo "Are you sure? (y/n)[n]:" (ont reset, etc.) —
    # NO coincide con CONFIRM_RE (ese es solo el prompt '{ <cr>||<K> }:'). Sin este
    # handler, comandos como 'ont reset' quedaban esperando un PROMPT_RE que nunca
    # llega hasta agotar el `deadline` completo de la sesión (incidente 2026-07-17:
    # enviar 'y' como comando separado en la lista no funciona porque el deadline es
    # compartido entre TODOS los comandos, no por-comando). Se auto-confirma con 'y'.
    YESNO_RE  = re.compile(r'\(y/n\)\s*\[.\]\s*:\s*$', re.IGNORECASE)

    def _read_until_prompt(chan: 'paramiko.Channel', deadline: float) -> str:
        buf = ''
        while _time_read.monotonic() < deadline:
            if chan.recv_ready():
                buf += chan.recv(4096).decode('utf-8', errors='replace')
                last = buf.rsplit('\n', 1)[-1].replace('\r', '').strip()
                if CONFIRM_RE.search(last):
                    chan.send('\r\n')
                    continue
                if MORE_RE.search(last):
                    chan.send(' ')  # Espacio avanza una página en el pager Huawei
                    continue
                if YESNO_RE.search(last):
                    chan.send('y\r\n')
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

        # Ejecutar cada comando y acumular salida.
        # Nota de firmware (MA5800 R018, validado 2026-07-17): si un token no es
        # prefijo válido en el modo actual, la VTY RECHAZA el espacio siguiente
        # (el eco llega pegado: "undo dba-profileprofile-name...") y responde
        # "% Unknown command". Ese eco corrupto significa comando/modo inválido
        # — no un problema de transporte; el error se propaga vía
        # _check_cli_error. El drenaje pre-envío evita que logs asíncronos
        # (autosave) contaminen la lectura del comando siguiente.
        output_parts: list[str] = []
        for cmd in commands:
            _time_read.sleep(0.15)
            while chan.recv_ready():  # drenar output asíncrono acumulado
                chan.recv(4096)
            chan.send(cmd + '\r\n')
            output_parts.append(_read_until_prompt(chan, deadline))

        chan.close()
        return output_parts if return_list else '\n'.join(output_parts)

    except paramiko.AuthenticationException as exc:
        raise ProvisioningError(f'Autenticación fallida en Huawei {conn.ip}') from exc
    except (paramiko.SSHException, OSError, TimeoutError) as exc:
        raise ProvisioningError(f'Error SSH en Huawei {conn.ip}: {exc}') from exc
    finally:
        # SIEMPRE cerrar: en el camino de error, no cerrar dejaba la sesión SSH
        # colgada en la OLT hasta su idle-timeout, saturando el límite de sesiones
        # concurrentes del MA5800 ("Reenter times have reached the upper limit").
        try:
            ssh.close()
        except Exception:  # noqa: BLE001
            pass


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
    Consulta los tres tipos de perfiles de la MA5800 en UNA sola sesión Paramiko:
      display ont-lineprofile all   → line profiles (DBA + GEM mapping)
      display ont-srvprofile all    → service profiles (tipo de servicio)
      display traffic table all     → traffic tables (CIR/PIR para service-port)

    Usa _paramiko_huawei_run (bypass Netmiko session_preparation) con return_list=True
    para obtener la salida de cada comando individualmente. Netmiko session_preparation
    interfiere con el canal en el MA5800 (prompt { <cr>||<K> }: no confirmado).
    Síncrono — llamar desde asyncio.to_thread().
    """
    # Los comandos de perfiles GPON se ejecutan en config mode.
    # display traffic table ip opera en enable mode (#), después de quit.
    # from-index 0 muestra todas las tablas desde el índice 0.
    cmds = [
        'config',
        'display ont-lineprofile gpon all',
        'display ont-srvprofile gpon all',
        'quit',
        'display traffic table ip from-index 0',
    ]
    try:
        parts = _paramiko_huawei_run(
            conn, cmds,
            timeout=float(settings.ssh_command_timeout),
            return_list=True,
        )
        # parts[0]=config, parts[1]=lp, parts[2]=sp, parts[3]=quit, parts[4]=tt
        lp_raw, sp_raw, tt_raw = parts[1], parts[2], parts[4]
    except ProvisioningError as exc:
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
                # display traffic table ip from-index no incluye nombre;
                # usar TrafficName si existe, sino construir desde índice.
                name = str(row.get('TrafficName') or f'traffic-table-{idx}').strip()
                cir_val = row.get('Cir') or '0'
                pir_val = row.get('Pir') or '0'
                cbs_val = row.get('Cbs') or '0'
                pbs_val = row.get('Pbs') or '0'
                cir  = int(cir_val) if str(cir_val).isdigit() else 0
                pir  = int(pir_val) if str(pir_val).isdigit() else 0
                cbs  = int(cbs_val) if str(cbs_val).isdigit() else 0
                pbs  = int(pbs_val) if str(pbs_val).isdigit() else 0
            except (ValueError, TypeError):
                continue
            if idx < 0:
                continue
            result.append({
                'index': idx, 'name': name,
                'cir_kbps': cir, 'pir_kbps': pir,
                'cbs_bytes': cbs or None, 'pbs_bytes': pbs or None,
            })
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

    El comando pide confirmación "Are you sure? (y/n)[n]:" → `_paramiko_huawei_run`
    la auto-responde con 'y' (ver YESNO_RE en su lector de prompt).

    Migrado de Netmiko (`_send_config_set`) a `_paramiko_huawei_run` (incidente
    2026-07-17): el driver `huawei_smartax` de Netmiko cuelga en
    `session_preparation → _disable_infoswitch_cli → exit_enable_mode`
    (netmiko.exceptions.ReadTimeout) contra este firmware — el mismo problema de
    fondo que ya forzó migrar rollback_gpon/DBA-profile al transporte paramiko
    (ver memoria firmware R018). `_send_config_set` sigue siendo válido para otros
    comandos menos sensibles al prompt, pero `ont reset` lo dejaba inutilizable.

    Síncrono — llamar desde asyncio.to_thread().
    """
    commands = [
        'config',
        f'interface gpon 0/{slot}',
        f'ont reset {port} {onu_id}',
        'quit',
        'quit',
    ]
    logger.info(
        'reset_huawei_onu: reiniciando ONU slot=%d port=%d onu_id=%d en %s',
        slot, port, onu_id, conn.ip,
    )
    raw_output = _paramiko_huawei_run(conn, commands, timeout=settings.ssh_command_timeout)
    _check_cli_error(conn.brand, 'reset_huawei_onu', raw_output)

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

    UNA sesión Paramiko (_paramiko_huawei_run) — mismo bypass que
    add_traffic_table: el _send_config_set (Netmiko) falla en este hardware
    con ReadTimeout: Pattern not detected 'MA5800-X7' (reproducido en
    producción 2026-07-14 al aplicar el primer plan de baseline).
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'add_vlan no implementado para marca: {conn.brand.value}')

    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '_', name)[:64]
    commands = [
        'config',                            # [0]
        f'vlan {vlan_id} smart',             # [1]
        f'vlan desc {vlan_id} {safe_name}',  # [2]
        'quit',                              # [3]
    ]
    logger.info('add_vlan: vlan_id=%d name=%s en %s', vlan_id, safe_name, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=60.0, return_list=True)
        _check_cli_error(conn.brand, 'add_vlan', outputs[1])
        _check_cli_error(conn.brand, 'add_vlan', outputs[2])
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except Exception as exc:  # noqa: BLE001
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
    UNA sesión Paramiko — mismo bypass de Netmiko que add_vlan.
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'delete_vlan no implementado para marca: {conn.brand.value}')

    commands = ['config', f'undo vlan {vlan_id}', 'quit']
    logger.info('delete_vlan: vlan_id=%d en %s', vlan_id, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=60.0, return_list=True)
        _check_cli_error(conn.brand, 'delete_vlan', outputs[1])
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}
    logger.info('delete_vlan: VLAN %d eliminada en %s', vlan_id, conn.ip)
    return {'success': True}


def _parse_version_info(raw: str) -> dict[str, str | None]:
    """
    Extrae PRODUCT (modelo), VERSION (firmware) y PATCH de 'display version'.
    Formato Huawei VRP (MA5800):
      VERSION : MA5800V100R019C10
      PATCH   : SPH113
      PRODUCT : MA5800-X7
    """
    def buscar(clave: str) -> str | None:
        m = re.search(rf'^\s*{clave}\s*:\s*(\S+)', raw, re.MULTILINE | re.IGNORECASE)
        return m.group(1).strip() if m else None

    return {
        'model':    buscar('PRODUCT'),
        'firmware': buscar('VERSION'),
        'patch':    buscar('PATCH'),
    }


def get_version_info(conn: OltConnectionSchema) -> dict[str, Any]:
    """
    Lee modelo, firmware y patch reales de la OLT ('display version').
    Una sesión Paramiko, un solo comando. Solo lectura.
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'get_version_info no implementado para marca: {conn.brand.value}')

    try:
        raw = _paramiko_huawei_run(conn, ['display version'], timeout=45.0)
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}

    info = _parse_version_info(raw)
    if not info['model'] and not info['firmware']:
        return {'success': False, 'error': 'display version no retornó PRODUCT ni VERSION reconocibles'}

    logger.info('get_version_info: %s → model=%s firmware=%s patch=%s',
                conn.ip, info['model'], info['firmware'], info['patch'])
    return {'success': True, **info}


def add_ont_srvprofile(
    conn: OltConnectionSchema,
    name: str,
    eth:  int,
    pots: int = 0,
    catv: int = 0,
) -> dict[str, Any]:
    """
    Crea un ONT service-profile ("tipo de ONU") en la OLT Huawei MA5800.
    Validado manualmente 2026-07-16: al entrar al modo perfil, el PROMPT revela
    el Profile-ID asignado — 'MA5800-X7(config-gpon-srvprofile-19)#' — de ahí
    se resuelve el índice (sin diffs de displays paginados).
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'add_ont_srvprofile no implementado para marca: {conn.brand.value}')

    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '_', name)[:32]
    port_cmd  = f'ont-port eth {eth}'
    if pots > 0:
        port_cmd += f' pots {pots}'
    if catv > 0:
        port_cmd += f' catv {catv}'

    commands = [
        'config',                                            # [0]
        f'ont-srvprofile gpon profile-name {safe_name}',     # [1] crea + entra al modo perfil
        port_cmd,                                            # [2] capacidades del modelo
        'commit',                                            # [3]
        'quit',                                              # [4] sale del modo perfil
        'quit',                                              # [5] sale de config
    ]
    logger.info('add_ont_srvprofile: name=%s eth=%d pots=%d catv=%d en %s',
                safe_name, eth, pots, catv, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=90.0, return_list=True)
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}

    raw = '\n'.join(outputs)
    try:
        _check_cli_error(conn.brand, 'add_ont_srvprofile', raw)
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}

    m = re.search(r'config-gpon-srvprofile-(\d+)', raw)
    if not m:
        return {'success': False,
                'error': 'La OLT no entró al modo de perfil (sin profile-id en el prompt)'}
    profile_id = int(m.group(1))
    logger.info('add_ont_srvprofile: %s → profile_id=%d en %s', safe_name, profile_id, conn.ip)
    return {'success': True, 'profile_id': profile_id, 'name': safe_name}


def delete_ont_srvprofile(
    conn: OltConnectionSchema,
    name: str,
) -> dict[str, Any]:
    """
    Elimina un ONT service-profile por nombre. La OLT rechaza el undo si el
    perfil tiene ONTs asociadas (Binding times > 0) — ese error se propaga.
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'delete_ont_srvprofile no implementado para marca: {conn.brand.value}')

    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '_', name)[:32]
    commands = ['config', f'undo ont-srvprofile gpon profile-name {safe_name}', 'quit']
    logger.info('delete_ont_srvprofile: name=%s en %s', safe_name, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=60.0, return_list=True)
        _check_cli_error(conn.brand, 'delete_ont_srvprofile', '\n'.join(outputs))
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}
    logger.info('delete_ont_srvprofile: %s eliminado en %s', safe_name, conn.ip)
    return {'success': True}


def add_ont_lineprofile(
    conn:         OltConnectionSchema,
    name:         str,
    dba_name:     str,
    dba_max_kbps: int,
) -> dict[str, Any]:
    """
    Crea un ONT line-profile GPON canónico en la OLT Huawei MA5800 con su propio
    DBA profile (type4 best-effort). Sintaxis validada manualmente 2026-07-17:
      - 'dba-profile add ...' responde 'Profile ID  : N' en la salida.
      - 'ont-lineprofile gpon profile-name X' entra al modo perfil y el PROMPT
        revela el ID: 'MA5800-X7(config-gpon-lineprofile-10)#'.
      - mapping-mode priority (802.1p flexible, multi-VLAN por service-port),
        tr069-management enable, tcont 1 → DBA propio, GEM 1 eth con mapping
        de las 8 prioridades 802.1p.
    Idempotente ante DBA preexistente ('exist' tolerado — se referencia por
    nombre). Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'add_ont_lineprofile no implementado para marca: {conn.brand.value}')

    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '_', name)[:32]
    safe_dba  = re.sub(r'[^A-Za-z0-9_\-]', '_', dba_name)[:32]
    if dba_max_kbps < 128 or dba_max_kbps > 10_000_000:
        return {'success': False, 'error': f'dba_max_kbps fuera de rango: {dba_max_kbps}'}

    commands = [
        'config',
        f'dba-profile add profile-name {safe_dba} type4 max {dba_max_kbps}',
        f'ont-lineprofile gpon profile-name {safe_name}',
        'mapping-mode priority',
        'tr069-management enable',
        f'tcont 1 dba-profile-name {safe_dba}',
        'gem add 1 eth tcont 1',
        *[f'gem mapping 1 {i} priority {i}' for i in range(8)],
        'commit',
        'quit',
        'quit',
    ]
    logger.info('add_ont_lineprofile: name=%s dba=%s max=%d en %s',
                safe_name, safe_dba, dba_max_kbps, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=120.0, return_list=True)
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}

    # DBA: tolerar 'exists already' (referenciado por nombre); otro Failure → error
    salida_dba = outputs[1]
    dba_id: int | None = None
    m_dba = re.search(r'Profile ID\s*:\s*(\d+)', salida_dba)
    if m_dba:
        dba_id = int(m_dba.group(1))
    elif 'Failure' in salida_dba and 'exist' not in salida_dba.lower():
        return {'success': False, 'error': f'DBA profile falló: {salida_dba.strip()[:300]}'}

    raw = '\n'.join(outputs[2:])
    try:
        _check_cli_error(conn.brand, 'add_ont_lineprofile', raw)
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}

    m = re.search(r'config-gpon-lineprofile-(\d+)', raw)
    if not m:
        return {'success': False,
                'error': 'La OLT no entró al modo line-profile (sin profile-id en el prompt)'}
    profile_id = int(m.group(1))
    logger.info('add_ont_lineprofile: %s → profile_id=%d dba_id=%s en %s',
                safe_name, profile_id, dba_id, conn.ip)
    return {'success': True, 'profile_id': profile_id, 'name': safe_name,
            'dba_profile_id': dba_id, 'dba_name': safe_dba}


def add_gem_mgmt_to_lineprofile(
    conn:       OltConnectionSchema,
    profile_id: int,
) -> dict[str, Any]:
    """
    Agrega GEM index 2 (tcont 0, el DBA por-defecto que Huawei crea implícitamente
    en todo ONT) a un line-profile GPON existente, para habilitar el carril de
    gestión TR-069 (provision_mgmt_bootstrap usa `service-port ... gemport 2`).

    Causa raíz (incidente 2026-07-17): `add_ont_lineprofile` solo crea GEM index 1
    (tcont 1, DBA propio) para el plano de datos — el line-profile canónico
    DATAFAST_LINE nunca tuvo GEM 2, por lo que NINGUNA ONU con ese perfil podía
    recibir el carril de gestión ("The GEM index does not exist or the T-CONT
    binding with this GEM port does not bind a DBA profile"). Fix estructural
    de una sola vez sobre el perfil compartido — no requiere recrear el DBA ni
    tocar GEM 1 (datos).

    Idempotente: 'has existed already'/'already exist' en la respuesta se
    tolera (GEM 2 ya presente). Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'add_gem_mgmt_to_lineprofile no implementado para marca: {conn.brand.value}')

    commands = [
        'config',
        f'ont-lineprofile gpon profile-id {profile_id}',
        'gem add 2 eth tcont 0',
        'commit',
        'quit',
        'quit',
    ]
    logger.info('add_gem_mgmt_to_lineprofile: profile_id=%d en %s', profile_id, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=60.0, return_list=True)
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}

    raw = '\n'.join(outputs[1:4])
    error_patterns = ['Error:', 'Failure:', 'Parameter error', 'Unknown command', 'Incomplete command']
    benign = ('has existed already', 'already exist', 'already exists', 'has already existed')
    for pat in error_patterns:
        if pat.lower() in raw.lower():
            linea = next((l for l in raw.splitlines() if pat.lower() in l.lower()), pat)
            if any(b in linea.lower() for b in benign):
                logger.info('add_gem_mgmt_to_lineprofile: GEM 2 ya existía en profile_id=%d en %s', profile_id, conn.ip)
                break
            return {'success': False, 'error': f'CLI Huawei reportó error: {linea.strip()}'}

    logger.info('add_gem_mgmt_to_lineprofile OK | profile_id=%d en %s', profile_id, conn.ip)
    return {'success': True, 'profile_id': profile_id}


def delete_ont_lineprofile(
    conn:     OltConnectionSchema,
    name:     str,
    dba_name: str | None = None,
) -> dict[str, Any]:
    """
    Elimina un ONT line-profile por nombre y, opcionalmente, su DBA profile
    asociado. La OLT rechaza el undo si el perfil tiene ONTs asociadas
    (Binding times > 0) — ese error se propaga. Si el DBA sigue referenciado
    por otro line-profile, su undo falla sin afectar el resultado principal.
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'delete_ont_lineprofile no implementado para marca: {conn.brand.value}')

    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '_', name)[:32]
    commands  = ['config', f'undo ont-lineprofile gpon profile-name {safe_name}']
    if dba_name:
        safe_dba = re.sub(r'[^A-Za-z0-9_\-]', '_', dba_name)[:32]
        # Firmware R018: 'undo dba-profile' NO existe — el borrado es
        # 'dba-profile delete profile-name X' (validado 2026-07-17).
        commands.append(f'dba-profile delete profile-name {safe_dba}')
    commands.append('quit')

    logger.info('delete_ont_lineprofile: name=%s dba=%s en %s', safe_name, dba_name, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=90.0, return_list=True)
        _check_cli_error(conn.brand, 'delete_ont_lineprofile', outputs[1])
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}

    dba_eliminado = True
    if dba_name and 'Failure' in outputs[2]:
        dba_eliminado = False
        logger.warning('delete_ont_lineprofile: DBA %s no eliminado (¿referenciado?): %s',
                       dba_name, outputs[2].strip()[:200])
    logger.info('delete_ont_lineprofile: %s eliminado en %s (dba_eliminado=%s)',
                safe_name, conn.ip, dba_eliminado)
    return {'success': True, 'dba_eliminado': dba_eliminado}


def _parse_port_vlan_ids(raw: str) -> list[int]:
    """
    Extrae los VLAN IDs de la salida de 'display port vlan F/S/P'.
    Formato real (MA5800-X7, validado 2026-07-14):
      ---------------------------------------
         1    201   1500   1600
      ---------------------------------------
      Total: 4
      Native VLAN: 1
    Solo cuentan las líneas compuestas exclusivamente por enteros (la tabla);
    el eco del comando y 'Total:'/'Native VLAN:' contienen letras y se ignoran.
    """
    ids: list[int] = []
    for line in raw.splitlines():
        s = line.strip()
        if s and re.fullmatch(r'\d+(?:\s+\d+)*', s):
            ids.extend(int(x) for x in s.split())
    return sorted(set(ids))


def get_uplink_vlans(
    conn:      OltConnectionSchema,
    port_path: str,
) -> dict[str, Any]:
    """
    Lee las VLANs taggeadas en un puerto uplink (frame/slot/port).
    Solo lectura. Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'get_uplink_vlans no implementado para marca: {conn.brand.value}')

    try:
        outputs = _paramiko_huawei_run(
            conn, [f'display port vlan {port_path}'], timeout=60.0, return_list=True,
        )
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}

    vlan_ids = _parse_port_vlan_ids('\n'.join(outputs))
    logger.info('get_uplink_vlans: %s %s → %s', conn.ip, port_path, vlan_ids)
    return {'success': True, 'vlan_ids': vlan_ids}


def add_uplink_vlan(
    conn:      OltConnectionSchema,
    vlan_id:   int,
    port_path: str,
) -> dict[str, Any]:
    """
    Taguea una VLAN en el puerto uplink (comando ADITIVO: 'port vlan {vid} F/S P'
    agrega la VLAN sin tocar las existentes — validado manualmente contra
    MA5800-X7 el 2026-07-14 con VLAN de prueba 3999).

    El destagueo (undo port vlan) NUNCA se automatiza: la OLT advierte
    'may cause interruptions of many user services'.

    Nunca asume éxito: relee el puerto al final y confirma que la VLAN quedó.
    UNA sesión Paramiko. Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'add_uplink_vlan no implementado para marca: {conn.brand.value}')

    frame, slot, port = port_path.split('/')
    commands = [
        'config',                                       # [0]
        f'port vlan {vlan_id} {frame}/{slot} {port}',   # [1]
        'quit',                                          # [2]
        f'display port vlan {port_path}',               # [3] verificación
    ]
    logger.info('add_uplink_vlan: vlan=%d port=%s en %s', vlan_id, port_path, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=90.0, return_list=True)
        _check_cli_error(conn.brand, 'add_uplink_vlan', outputs[1])
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}

    # Verificación real: el helper puede desplazar los límites entre comandos
    # (eco del prompt), así que se parsea la salida completa de la sesión.
    vlan_ids = _parse_port_vlan_ids('\n'.join(outputs))
    if vlan_id not in vlan_ids:
        return {
            'success': False,
            'vlan_ids': vlan_ids,
            'error': f'El comando no reportó error pero la VLAN {vlan_id} no aparece taggeada en {port_path}',
        }
    logger.info('add_uplink_vlan: vlan=%d confirmada en %s (%s)', vlan_id, port_path, vlan_ids)
    return {'success': True, 'vlan_ids': vlan_ids}


def _parse_traffic_table_indices(raw: str) -> set[int]:
    """
    Extrae los TID (índices) de 'display traffic table ip from-index 0'.
    Formato real (MA5800-X7, validado 2026-07-14):
      TID CIR      CBS        PIR      PBS        Pri Copy-policy     Pri-Policy
        0 1024     34768      2048     69536        6 -                  tag-pri
        6 off      off        off      off          0 -                  tag-pri
    Sin '^' anclado: el paginador puede pegar una fila al texto del "More".
    """
    return {
        int(m.group(1))
        for m in re.finditer(
            r'(\d+)\s+(?:\d+|off)\s+(?:\d+|off)\s+(?:\d+|off)\s+(?:\d+|off)\s+\d\s+\S+\s+(?:tag-pri|local-pri)',
            raw,
        )
    }


def add_traffic_table(
    conn:      OltConnectionSchema,
    name:      str,
    cir_kbps:  int,
    pir_kbps:  int,
    cbs_bytes: int | None = None,
    pbs_bytes: int | None = None,
) -> dict[str, Any]:
    """
    Crea un traffic table en la OLT Huawei MA5800.

    UNA sesión Paramiko (_paramiko_huawei_run) — bypass del bug de
    session_preparation de Netmiko en este hardware.

    Resolución del índice (validado manualmente 2026-07-16): la OLT retorna
    el índice EN LA RESPUESTA del propio comando de creación:
      Create traffic descriptor record successfully
      Traffic Table Index          : 22
      Traffic Table Name           : ERP-MGMT
    El método anterior (diff de 'display traffic table ip from-index 0'
    antes/después) fallaba con listas largas: el paginador More desfasaba
    la segmentación por comando y el diff salía vacío, reportando
    "creada sin índice" cuando en realidad la creación había fallado o
    quedaba sin registrar (reproducido en producción al aplicar el
    Baseline Estándar).

    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'add_traffic_table no implementado para marca: {conn.brand.value}')

    safe_name = re.sub(r'[^A-Za-z0-9_\-]', '_', name)[:64]
    # Orden Huawei: cir [cbs] pir [pbs] priority ... — cbs/pbs opcionales (bytes).
    cbs_part = f'cbs {cbs_bytes} ' if cbs_bytes is not None else ''
    pbs_part = f'pbs {pbs_bytes} ' if pbs_bytes is not None else ''
    add_cmd = (f'traffic table ip name {safe_name} cir {cir_kbps} {cbs_part}'
               f'pir {pir_kbps} {pbs_part}priority 0 priority-policy local-setting')

    # IDEMPOTENTE (2026-07-17): tras el create se verifica SIEMPRE con
    # 'display traffic table ip name X' (sí existe en este firmware, validado
    # a mano) — resiste respuestas perdidas: si el create dice "exists
    # already" (creación previa cuya confirmación se perdió, caso real en la
    # prueba de integración limpia) o la sesión se corta a mitad, la
    # verificación por nombre resuelve el índice igual y el plan continúa.
    commands = ['config', add_cmd, 'quit', f'display traffic table ip name {safe_name}']
    logger.info('add_traffic_table: name=%s cir=%d cbs=%s pir=%d pbs=%s en %s',
                safe_name, cir_kbps, cbs_bytes, pir_kbps, pbs_bytes, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=90.0, return_list=True)
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}

    # Se parsea la sesión completa (los límites entre comandos pueden desfasarse).
    raw = '\n'.join(outputs)
    m = re.search(
        rf'Traffic Table Index\s*:\s*(\d+)\s*\r?\n\s*Traffic Table Name\s*:\s*{re.escape(safe_name)}\b',
        raw,
    )
    if m:
        idx = int(m.group(1))
        ya_existia = 'exists already' in raw
        logger.info('add_traffic_table: %s → index=%d en %s%s',
                    safe_name, idx, conn.ip, ' (ya existía — idempotente)' if ya_existia else '')
        return {'success': True, 'index': idx, 'name': safe_name}

    try:
        _check_cli_error(conn.brand, 'add_traffic_table', raw)
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    return {'success': False,
            'error': f'La OLT no confirmó "{safe_name}" ni la reporta por nombre tras el create'}


def delete_traffic_table(
    conn:  OltConnectionSchema,
    index: int,
) -> dict[str, Any]:
    """
    Elimina un traffic table de la OLT Huawei MA5800 por índice.
    Comando: config → undo traffic table ip index {index} → quit
    UNA sesión Paramiko — mismo bypass que add_traffic_table.
    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(f'delete_traffic_table no implementado para marca: {conn.brand.value}')

    commands = ['config', f'undo traffic table ip index {index}', 'quit']
    logger.info('delete_traffic_table: index=%d en %s', index, conn.ip)
    try:
        outputs = _paramiko_huawei_run(conn, commands, timeout=60.0, return_list=True)
        _check_cli_error(conn.brand, 'delete_traffic_table', outputs[1])
    except CommandError as exc:
        return {'success': False, 'error': str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {'success': False, 'error': str(exc)}
    logger.info('delete_traffic_table: index=%d eliminado en %s', index, conn.ip)
    return {'success': True}


def edit_traffic_table(
    conn:      OltConnectionSchema,
    index:     int,
    name:      str,
    cir_kbps:  int,
    pir_kbps:  int,
    cbs_bytes: int | None = None,
    pbs_bytes: int | None = None,
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

    add_result = add_traffic_table(conn, name, cir_kbps, pir_kbps, cbs_bytes, pbs_bytes)
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
    info_cmd    = f'display ont info 0 {slot} {port} {onu_id}'
    optical_cmd = f'display ont optical-info 0 {slot} {port} {onu_id}'

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
    finally:
        # Cerrar siempre — no cerrar en el camino de error dejaba sesiones colgadas
        # en la OLT hasta el idle-timeout (satura el límite de sesiones concurrentes).
        try:
            ssh.close()
        except Exception:  # noqa: BLE001
            pass


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
    conn:               OltConnectionSchema,
    frame:              int,
    slot:               int,
    port:               int,
    onu_id:             int,
    sn:                 str,
    service_port_id:    int,
    vlan:               int,
    lineprofile_id:     int,
    srvprofile_id:      int,
    traffic_index_down: int | None = None,
    traffic_index_up:   int | None = None,
    description:        str | None = None,
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
    # El último comando es una verificación: display service-port ... ont ...
    # NO confiar en la ausencia de "Failure:" — el service-port puede fallar en
    # silencio (dejando el ONT online sin ruta de datos y reportando "GPON OK"
    # falsamente). Se verifica su existencia real antes de dar la fase por buena.
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
            # Sintaxis MA5800 verificada: `user-vlan` requiere `multi-service` delante
            # (sin el, la CLI devuelve "Too many parameters"). `tag-transform translate`
            # replica la config que crea SmartOLT (S-VLAN=C-VLAN=vlan, traduccion 1:1).
            f'service-port {service_port_id} vlan {vlan} '
            f'gpon 0/{slot}/{port} ont {onu_id} gemport 1 '
            f'multi-service user-vlan {vlan} tag-transform translate '
            f'inbound traffic-table index {traffic_index_up or 0} '
            f'outbound traffic-table index {traffic_index_down or 0}'
        ),
        f'display service-port port 0/{slot}/{port} ont {onu_id}',
    ]
    # NOTA: el `save` se ejecuta SOLO al final si la verificación pasa. Guardar en cada
    # intento (incl. los que fallan por colisión/lock) dejaba a la OLT guardando en
    # segundo plano ("takes several minutes"), y ese guardado en curso hacía que la
    # siguiente operación de config diera "Currently operating conflicts" — una cascada.

    try:
        parts = _paramiko_huawei_run(
            conn, cmds, timeout=settings.ssh_command_timeout, return_list=True,
        )
    except ProvisioningError:
        raise
    except Exception as exc:
        raise ProvisioningError(
            f'provision_gpon_ftth falló en {conn.ip}: {exc}'
        ) from exc

    # parts alineado con cmds: [0]config [1]interface [2]ont-add [3]quit
    # [4]service-port [5]display-verificación
    raw_create = '\n'.join(parts[:5])
    verify_out = parts[5] if len(parts) > 5 else ''

    # 1) Errores explícitos de la CLI en la fase de creación (ont add + service-port).
    error_patterns = [
        'Error:', 'Failure:', 'ont add failed', 'service-port failed',
        'already exists', 'ONT already', 'has already existed',
        'Too many parameters', 'Parameter error', 'Incomplete command',
        'Unknown command', 'conflicts with',
    ]
    for pat in error_patterns:
        if pat.lower() in raw_create.lower():
            linea = next(
                (l for l in raw_create.splitlines() if pat.lower() in l.lower()), pat,
            )
            raise ProvisioningError(
                f'CLI Huawei reportó error en {conn.ip}: {linea.strip()}'
            )

    # 2) Verificación dura: el service-port DEBE existir tras la creación.
    v = verify_out.lower()
    creado = (
        'no service virtual port' not in v
        and 'does not exist' not in v
        and ('gpon' in v or str(service_port_id) in verify_out)
    )
    if not creado:
        raise ProvisioningError(
            f'El service-port {service_port_id} no se creó en {conn.ip} '
            f'(ont {slot}/{port}/{onu_id}). Salida creación: '
            f'{raw_create[-400:].strip()} || Verificación: {verify_out[-200:].strip()}'
        )

    # Solo aquí (verificación OK) se persiste. Un único save por provisión exitosa.
    try:
        _paramiko_huawei_run(conn, ['save'], timeout=settings.ssh_command_timeout)
    except Exception as exc:
        logger.warning('provision_gpon_ftth: save falló (config en running) OLT=%s: %s', conn.ip, exc)

    logger.info(
        'provision_gpon_ftth OK verificado | OLT=%s sn=%s service_port=%d',
        conn.ip, sn, service_port_id,
    )
    return {'success': True, 'sn': sn, 'olt_ip': conn.ip}


def provision_mgmt_bootstrap(
    conn:                 OltConnectionSchema,
    slot:                 int,
    port:                 int,
    onu_id:               int,
    mgmt_vlan:            int,
    mgmt_service_port_id: int,
    traffic_index:        int = 0,
    priority:             int = 2,
) -> dict[str, Any]:
    """
    Carril de bootstrap TR-069 (ZTP) — se aplica a una ONU YA registrada (tras Fase 1 GPON).

    Crea el plano de gestión que permite que la ONU aparezca sola en el ACS (GenieACS):
      - service-port de gestión (GEM 2) en la VLAN de gestión (bridged).
      - IP host de gestión en modo DHCP (ip-index 0) sobre la VLAN de gestión.
      - FEC (estabilidad del enlace; best-effort).

    La ONU hace DHCP en la VLAN de gestión y recibe la ACS URL vía DHCP Option 43 (servida por
    el MikroTik gateway de esa VLAN), con lo que escribe ManagementServer.URL e inicia el
    BOOTSTRAP/Inform hacia el ACS. Comportamiento verificado en EG8145V5 V5R020C10S195.

    IMPORTANTE: NO usa `ont wan-config` para ip-index 0 — crear una WAN ruteada le quita la VLAN
    al IP host de gestión y la ONU deja de emitir (verificado). La gestión es SOLO un IP host OMCI.
    `ont tr069-server-config` NO inicializa ManagementServer.URL en este firmware → se delega al
    DHCP Option 43. Requiere ONU online. Síncrono — llamar desde asyncio.to_thread().
    """
    logger.info(
        'provision_mgmt_bootstrap: OLT=%s slot=%d port=%d onu_id=%d mgmt_vlan=%d svc_port=%d',
        conn.ip, slot, port, onu_id, mgmt_vlan, mgmt_service_port_id,
    )
    cmds = [
        'config',
        (
            f'service-port {mgmt_service_port_id} vlan {mgmt_vlan} '
            f'gpon 0/{slot}/{port} ont {onu_id} gemport 2 '
            f'multi-service user-vlan {mgmt_vlan} tag-transform translate '
            f'inbound traffic-table index {traffic_index} '
            f'outbound traffic-table index {traffic_index}'
        ),
        f'interface gpon 0/{slot}',
        f'ont ipconfig {port} {onu_id} ip-index 0 dhcp vlan {mgmt_vlan} priority {priority}',
        f'display ont ipconfig {port} {onu_id}',
    ]

    error_patterns = [
        'Error:', 'Failure:', 'Parameter error', 'Too many parameters',
        'Unknown command', 'Incomplete command', 'conflicts with',
    ]
    # Errores TRANSITORIOS (autosave asíncrono de la OLT aún procesando la operación
    # anterior — mismo patrón que rollback_gpon/suspend_onu, ver memoria firmware R018):
    # se reintenta el batch completo. Sin este retry, UN solo choque con el autosave
    # tumbaba el carril de gestión para siempre (incidente 2026-07-17, CNT-2026-000004:
    # la ONU nunca apareció en GenieACS pese a que el plano de datos quedó 100% OK).
    transient_patterns = ('conflicts with', 'currently operating', 'please retry later')
    # IDEMPOTENCIA SEGURA: "service virtual port has existed already" SOLO es benigno si el
    # service-port existente es de ESTA MISMA ONU y VLAN de gestión (re-aplicación tras factory
    # reset). Si el ID ya pertenece a OTRA ONU (p.ej. un puerto de DATOS de un cliente en
    # producción), reutilizarlo es una COLISIÓN peligrosa → error duro. Verificamos el dueño real
    # con `display service-port <id>` antes de decidir. (Regresión: antes se tragaba cualquier
    # "already exists" y enmascaraba colisiones con puertos de producción.)
    benign_patterns = (
        'has existed already', 'already exist', 'already exists', 'has already existed',
    )

    verify_out = ''
    last_transient_err: str | None = None
    for attempt in range(3):
        try:
            parts = _paramiko_huawei_run(
                conn, cmds, timeout=settings.ssh_command_timeout, return_list=True,
            )
        except ProvisioningError:
            raise
        except Exception as exc:
            raise ProvisioningError(
                f'provision_mgmt_bootstrap falló en {conn.ip}: {exc}'
            ) from exc

        # parts: [0]config [1]service-port [2]interface [3]ipconfig [4]display-verificación
        raw_create = '\n'.join(parts[:4])
        verify_out = parts[4] if len(parts) > 4 else ''

        hubo_error = False
        for pat in error_patterns:
            if pat.lower() in raw_create.lower():
                hubo_error = True
                linea = next(
                    (l for l in raw_create.splitlines() if pat.lower() in l.lower()), pat,
                )
                if any(b in linea.lower() for b in benign_patterns):
                    # Verificar de quién es realmente el service-port.
                    try:
                        check = _paramiko_huawei_run(
                            conn, [f'display service-port {mgmt_service_port_id}'],
                            timeout=settings.ssh_command_timeout,
                        )
                    except Exception:
                        check = ''
                    m_fsp  = re.search(r'F/S/P\s*:\s*(\S+)', check)
                    m_ont  = re.search(r'ONT ID\s*:\s*(\d+)', check)
                    m_vlan = re.search(r'VLAN ID\s*:\s*(\d+)', check)
                    fsp  = m_fsp.group(1)  if m_fsp  else '?'
                    ont  = m_ont.group(1)  if m_ont  else '?'
                    vlan = m_vlan.group(1) if m_vlan else '?'
                    mine = (fsp == f'0/{slot}/{port}' and str(ont) == str(onu_id)
                            and str(vlan) == str(mgmt_vlan))
                    if mine:
                        logger.info(
                            'provision_mgmt_bootstrap: service-port %s ya existe y ES de esta ONU/VLAN '
                            '(0/%d/%d ont %d vlan %d) — idempotente OK en %s',
                            mgmt_service_port_id, slot, port, onu_id, mgmt_vlan, conn.ip,
                        )
                        hubo_error = False
                        break
                    raise ProvisioningError(
                        f'COLISIÓN de service-port en {conn.ip}: el ID {mgmt_service_port_id} ya está '
                        f'EN USO por otra ONU (F/S/P {fsp}, ONT {ont}, VLAN {vlan}) — NO se reutiliza. '
                        f'Asigna un ID libre desde el pool de gestión (canal "gestion").'
                    )
                if any(t in linea.lower() for t in transient_patterns):
                    last_transient_err = linea.strip()
                    logger.warning(
                        'provision_mgmt_bootstrap: error transitorio (autosave) intento=%d | OLT=%s: %s',
                        attempt + 1, conn.ip, last_transient_err,
                    )
                    _time_read.sleep(3)
                    break
                raise ProvisioningError(
                    f'CLI Huawei reportó error en el bootstrap de gestión en {conn.ip}: {linea.strip()}'
                )
        if not hubo_error:
            last_transient_err = None
            break
    else:
        raise ProvisioningError(
            f'Bootstrap de gestión falló tras 3 intentos por conflicto transitorio en {conn.ip}: '
            f'{last_transient_err}'
        )

    # Diagnóstico: dejar en el log el estado real del IP host de gestión (IP asignada o requesting).
    logger.info(
        'provision_mgmt_bootstrap ipconfig verify | OLT=%s ont %d/%d/%d:\n%s',
        conn.ip, slot, port, onu_id, verify_out.strip(),
    )

    # Verificación dura: el IP host de gestión debe quedar en modo DHCP.
    v = verify_out.lower()
    if 'dhcp' not in v:
        raise ProvisioningError(
            f'El IP host de gestión (ip-index 0, DHCP) no se configuró en {conn.ip} '
            f'(ont {slot}/{port}/{onu_id}). Verificación: {verify_out[-200:].strip()}'
        )

    # FEC — estabilidad del enlace. Best-effort: no aborta el bootstrap si el modelo no lo soporta.
    try:
        _paramiko_huawei_run(
            conn,
            [
                'config', f'interface gpon 0/{slot}',
                f'ont fec {port} {onu_id} enable ont-type 2.5g/1.25g use-profile-config',
            ],
            timeout=settings.ssh_command_timeout,
        )
    except Exception as exc:
        logger.warning('provision_mgmt_bootstrap: ont fec falló (no crítico) OLT=%s: %s', conn.ip, exc)

    try:
        _paramiko_huawei_run(conn, ['save'], timeout=settings.ssh_command_timeout)
    except Exception as exc:
        logger.warning('provision_mgmt_bootstrap: save falló (config en running) OLT=%s: %s', conn.ip, exc)

    logger.info(
        'provision_mgmt_bootstrap OK | OLT=%s ont %d/%d/%d mgmt_vlan=%d (DHCP + Option 43)',
        conn.ip, slot, port, onu_id, mgmt_vlan,
    )
    return {'success': True, 'olt_ip': conn.ip}


def check_ont_wan_pppoe(
    conn:              OltConnectionSchema,
    slot:              int,
    port:              int,
    onu_id:            int,
    expected_username: str,
) -> dict[str, Any]:
    """
    Verifica si la WAN PPPoE de una ONU sigue viva (`display ont wan-info`) y si
    el username configurado coincide con el esperado. Usado por el watcher de
    re-inyección post factory-reset del flujo FTTH nativo: un factory-reset (botón
    o físico) borra la config OMCI de la ONU (WAN incluida) pero el registro del
    ERP la sigue marcando "activo" — sin esta verificación de estado real, nada
    detecta el drift. No lanza: drift/errores de lectura se tratan como "no verificado"
    para que el watcher reintente en el próximo ciclo. Síncrono — llamar desde
    asyncio.to_thread().
    """
    try:
        parts = _paramiko_huawei_run(
            conn,
            ['config', f'interface gpon 0/{slot}', f'display ont wan-info {port} {onu_id}', 'quit', 'quit'],
            timeout=settings.ssh_command_timeout, return_list=True,
        )
    except Exception as exc:
        logger.warning('check_ont_wan_pppoe: SSH falló | OLT=%s onu_id=%d: %s', conn.ip, onu_id, exc)
        return {'ok': False, 'connected': False, 'username': None, 'error': str(exc)}

    raw = parts[2] if len(parts) > 2 else ''
    # Puede haber varios "Index" (Internet/Other/IPTV) — nos quedamos con el bloque
    # 'Service type : Internet' (el mismo criterio que usa la WAN PPPoE inyectada).
    bloques = re.split(r'\n\s*Index\s*:', raw)
    connected = False
    username: str | None = None
    for bloque in bloques:
        if 'internet' not in bloque.lower():
            continue
        m_status = re.search(r'IPv4 Connection status\s*:\s*(\S+)', bloque)
        m_user   = re.search(r'PPPoE username\s*:\s*(\S+)', bloque)
        connected = bool(m_status and m_status.group(1).lower() == 'connected')
        username  = m_user.group(1) if m_user else None
        break

    ok = connected and username == expected_username
    return {'ok': ok, 'connected': connected, 'username': username, 'error': None}


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

    # Fase 1: `undo service-port` + VERIFICACIÓN activa de que la OLT terminó de
    # procesarlo antes de tocar el ont. En el MA5800 el `undo service-port` no es
    # síncrono con el prompt de vuelta: si el `ont delete` se envía inmediatamente
    # después (como hacía este código antes), la OLT lo rechaza con "This configured
    # object has some service virtual ports" porque la baja interna del service-port
    # aún no terminó. El drenaje de `_paramiko_huawei_run` solo limpia buffers de
    # lectura (0.15s) — no espera a que el equipo termine de procesar el comando
    # anterior. Confirmado en incidente 2026-07-17 (contrato CNT-2026-000005) — ver
    # memoria del firmware R018 para el mismo patrón de causa raíz.
    if service_port_id is not None:
        sp_gone = False
        for sp_attempt in range(4):
            try:
                sp_parts = _paramiko_huawei_run(
                    conn,
                    ['config', f'undo service-port {service_port_id}',
                     f'display service-port {service_port_id}', 'quit'],
                    timeout=settings.ssh_command_timeout, return_list=True,
                )
            except Exception as exc:
                logger.error(
                    'rollback_gpon: undo service-port SSH falló | OLT=%s intento=%d: %s',
                    conn.ip, sp_attempt + 1, exc,
                )
                _time_read.sleep(2)
                continue
            sp_verify = sp_parts[2] if len(sp_parts) > 2 else ''
            if 'does not exist' in sp_verify.lower():
                sp_gone = True
                logger.info(
                    'rollback_gpon: service-port %d confirmado eliminado | OLT=%s intento=%d',
                    service_port_id, conn.ip, sp_attempt + 1,
                )
                break
            logger.warning(
                'rollback_gpon: service-port %d aún no se confirma eliminado | OLT=%s intento=%d',
                service_port_id, conn.ip, sp_attempt + 1,
            )
            _time_read.sleep(2)
        if not sp_gone:
            logger.warning(
                'rollback_gpon: no se pudo confirmar la baja del service-port %d tras reintentos '
                '| OLT=%s — se intentará igual el ont delete',
                service_port_id, conn.ip,
            )

    # Fase 2: ont delete + verificación dura + reintento. NO basta con que SSH no
    # lance excepción. El `ont delete` puede fallar en silencio (lock de otra sesión
    # tipo SmartOLT, o el bug de espacios de VRP) y dejar el ONT en la OLT mientras
    # el sistema cree que se borró → huérfano. Se verifica con `display ont info`
    # que el ONT ya no exista, reintentando ante bloqueos transitorios.
    verify_cmd = f'display ont info {port} {onu_id}'
    last_err: str | None = None
    for attempt in range(3):
        # Sin `save` en el loop: guardar en cada reintento dejaba la OLT guardando en
        # segundo plano y provocaba "Currently operating conflicts" en el siguiente
        # comando. El `ont delete` es efectivo en running-config al instante; se persiste
        # con un único save al confirmar el borrado.
        cmds = [
            'config',
            f'interface gpon 0/{slot}',
            f'ont delete {port} {onu_id}',
            verify_cmd,
            'quit',
        ]
        try:
            parts = _paramiko_huawei_run(
                conn, cmds, timeout=settings.ssh_command_timeout, return_list=True,
            )
        except Exception as exc:
            last_err = str(exc)
            logger.error('rollback_gpon SSH FALLO | OLT=%s intento=%d: %s', conn.ip, attempt + 1, exc)
            _time_read.sleep(3)
            continue

        verify_out = parts[3] if len(parts) > 3 else ''
        if 'does not exist' in verify_out.lower():
            try:
                _paramiko_huawei_run(conn, ['save'], timeout=settings.ssh_command_timeout)
            except Exception:
                pass  # el delete ya está en running-config
            logger.info('rollback_gpon OK verificado | OLT=%s onu_id=%d intento=%d', conn.ip, onu_id, attempt + 1)
            return {'success': True}

        raw = '\n'.join(parts)
        last_err = next(
            (l.strip() for l in raw.splitlines()
             if any(k in l.lower() for k in ('failure', 'conflicts', 'error', 'parameter'))),
            verify_out[-150:].strip() or 'el ONT sigue presente',
        )
        logger.warning(
            'rollback_gpon NO verificado | OLT=%s onu_id=%d intento=%d: %s',
            conn.ip, onu_id, attempt + 1, last_err,
        )
        _time_read.sleep(3)

    return {
        'success': False,
        'error': f'El ONT {slot}/{port}/{onu_id} sigue en la OLT tras 3 intentos de ont delete: {last_err}',
    }


def list_configured_ont_ids(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
) -> list[int]:
    """
    Lista los ONT-IDs ya configurados en un puerto PON Huawei (`display ont info
    <port> all`). Incluye TODAS las ONUs registradas en la OLT — también las creadas
    por SmartOLT/AdminOLT fuera de nuestra BD. Se usa para que el pool de ONU-ID no
    asigne un ID en colisión al aprovisionar en un puerto compartido.
    """
    try:
        parts = _paramiko_huawei_run(
            conn,
            ['config', f'interface gpon 0/{slot}', f'display ont info {port} all'],
            timeout=settings.ssh_command_timeout, return_list=True,
        )
    except Exception as exc:
        raise ProvisioningError(
            f'No se pudieron listar los ONT-IDs de {conn.ip} puerto {slot}/{port}: {exc}'
        ) from exc

    out = parts[-1] if parts else ''
    # Filas tipo: "  0/ 1/8    4  4857544...  active  online  ..."
    fsp_re = re.compile(rf'0/\s*{slot}\s*/\s*{port}\s+(\d+)\s')
    ids: set[int] = set()
    for line in out.splitlines():
        m = fsp_re.search(line)
        if m:
            ids.add(int(m.group(1)))
    logger.info(
        'list_configured_ont_ids | OLT=%s %d/%d → %d ONTs (%s)',
        conn.ip, slot, port, len(ids), sorted(ids)[:10],
    )
    return sorted(ids)


def _bulk_metrics_paramiko_huawei(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
) -> list[dict[str, Any]]:
    """
    Igual que get_bulk_metrics_huawei pero usando el helper Paramiko (_paramiko_huawei_run)
    en lugar del path Netmiko. Netmiko se traba en el pager `{ <cr>||<K> }:` / `---- More`
    del MA5800 y genera "Timeout en respuesta a comandos bulk". Paramiko lo maneja bien.
    UNA sesión SSH en contexto interface-gpon: info all + optical-info all.
    """
    cmds = [
        'config', f'interface gpon 0/{slot}',
        f'display ont info {port} all',
        f'display ont optical-info {port} all',
        'quit',
    ]
    parts = _paramiko_huawei_run(
        conn, cmds, timeout=max(90.0, settings.ssh_command_timeout), return_list=True,
    )
    status_raw  = parts[2] if len(parts) > 2 else ''
    optical_raw = parts[3] if len(parts) > 3 else ''

    status_rows  = _parse_output(conn.brand, 'display_ont_info_all.textfsm',    status_raw)
    optical_rows = _parse_output(conn.brand, 'display_ont_optical_all.textfsm', optical_raw)

    optical_map: dict[int, dict[str, Any]] = {}
    for row in optical_rows:
        if 'raw' in row:
            continue
        try:
            oid  = int(row.get('OnuId')   or 0)
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
            ctl = str(row.get('ControlFlag') or '').strip().lower() or None
            cfg = str(row.get('ConfigState') or '').strip().lower() or None
            opt = optical_map.get(oid, {})
            result.append({
                'slot': slot, 'port': port, 'onu_id': oid, 'sn': sn,
                'run_state': run, 'control_flag': ctl, 'config_state': cfg,
                'rx_power_dbm':  opt.get('rx_power_dbm'),
                'tx_power_dbm':  opt.get('tx_power_dbm'),
                'temperature_c': opt.get('temperature_c'),
            })
        except (ValueError, TypeError):
            continue
    return result


def get_onu_down_causes_huawei(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
    onu_ids: list[int],
) -> dict[int, dict[str, str | None]]:
    """
    Para un conjunto de ONUs OFFLINE, consulta el detalle y extrae la causa de
    caída (`Last down cause`) y la marca de dying-gasp (`Last dying gasp time`).
    Permite distinguir "ONU apagada" (dying-gasp/power) de "ruptura de fibra"
    (LOS/LOF/pérdida de señal). UNA sola sesión SSH con N comandos de detalle.
    """
    if not onu_ids:
        return {}
    ids = onu_ids[:64]  # cota defensiva: evita sesiones gigantes en puertos saturados
    cmds = [f'display ont info 0 {slot} {port} {oid}' for oid in ids]
    try:
        outs = _paramiko_huawei_run(
            conn, cmds, timeout=max(90.0, settings.ssh_command_timeout), return_list=True,
        )
    except Exception as exc:
        logger.warning('get_onu_down_causes_huawei %d/%d en %s: %s', slot, port, conn.ip, exc)
        return {}

    cause_re = re.compile(r'Last down cause\s*:\s*([^\r\n]+)', re.IGNORECASE)
    gasp_re  = re.compile(r'Last dying gasp time\s*:\s*([^\r\n]+)', re.IGNORECASE)
    result: dict[int, dict[str, str | None]] = {}
    for oid, raw in zip(ids, outs):
        mc = cause_re.search(raw or '')
        mg = gasp_re.search(raw or '')
        cause = mc.group(1).strip() if mc else None
        gasp  = mg.group(1).strip() if mg else None
        result[oid] = {
            'down_cause':      None if cause in (None, '-', '') else cause,
            'dying_gasp_time': None if gasp  in (None, '-', '') else gasp,
        }
    return result


def _map_estado_operativo(
    control_flag: str | None,
    run_state:    str | None,
    down_cause:   str | None,
    dying_gasp:   str | None,
) -> str:
    """
    Traduce los campos crudos de la OLT a un estado operativo único:
      desactivada | online | apagada | ruptura_fibra | offline
    (El cruce con contrato/BD y "no_aprovisionada" se resuelve fuera —
    aquí solo se clasifica lo que la OLT reporta del enlace físico.)
    """
    if (control_flag or '').lower() == 'deactivated':
        return 'desactivada'
    if (run_state or '').lower() == 'online':
        return 'online'
    # offline / unknown → precisar causa
    cause = (down_cause or '').lower()
    if dying_gasp or 'dying' in cause or 'power' in cause:
        return 'apagada'
    if any(k in cause for k in ('los', 'lof', 'signal', 'sf')):
        return 'ruptura_fibra'
    return 'offline'


def classify_port_onus_huawei(
    conn: OltConnectionSchema,
    slot: int,
    port: int,
) -> dict[str, Any]:
    """
    Clasifica TODAS las ONUs de un puerto PON Huawei combinando:
      - `display ont info 0/slot/port all`   → estado/control/óptica por ONU
      - detalle de las OFFLINE                → down cause (apagada vs fibra)
      - `display ont autofind`                → ONUs físicas sin aprovisionar

    Retorna {onus:[...], autofind:[...]}. El estado operativo ya viene resuelto;
    el cruce con contrato lo hace el backend (tiene la BD).
    """
    metrics = _bulk_metrics_paramiko_huawei(conn, slot, port)
    offline_ids = [
        m['onu_id'] for m in metrics
        if (m.get('run_state') or '').lower() != 'online'
        and (m.get('control_flag') or '').lower() != 'deactivated'
    ]
    causes = get_onu_down_causes_huawei(conn, slot, port, offline_ids)

    onus: list[dict[str, Any]] = []
    for m in metrics:
        c = causes.get(m['onu_id'], {})
        estado = _map_estado_operativo(
            m.get('control_flag'), m.get('run_state'),
            c.get('down_cause'), c.get('dying_gasp_time'),
        )
        onus.append({
            **m,
            'down_cause':       c.get('down_cause'),
            'dying_gasp_time':  c.get('dying_gasp_time'),
            'estado_operativo': estado,
        })

    try:
        autofind = discover_huawei_onus(conn, slot=slot, port=port)
    except Exception as exc:
        logger.warning('classify_port_onus_huawei autofind %d/%d en %s: %s', slot, port, conn.ip, exc)
        autofind = []

    return {'onus': onus, 'autofind': autofind}


def poll_onu_online(
    conn:     OltConnectionSchema,
    slot:     int,
    port:     int,
    onu_id:   int,
    max_wait: int = 90,
    interval: int = 5,
) -> dict[str, Any]:
    """
    Fase 1b: consulta display ont info 0 {slot} {port} ont {onu_id} cada {interval}s
    hasta que el run-state sea 'online' o se agote max_wait.

    Retorna success=True + run_state cuando la ONU sube,
    o success=False + timeout=True si no responde en max_wait segundos.
    """
    logger.info(
        'poll_onu_online: OLT=%s slot=%d port=%d onu_id=%d max=%ds',
        conn.ip, slot, port, onu_id, max_wait,
    )
    cmd    = f'display ont info 0 {slot} {port} {onu_id}'
    t_end  = _time_read.monotonic() + max_wait
    last_state = 'unknown'   # último run-state observado (diagnóstico)

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
                # Capturar el valor tras los ':' para diagnóstico (offline/initial/etc.)
                if ':' in line:
                    last_state = line.split(':', 1)[1].strip().lower() or last_state
                if 'online' in low:
                    logger.info('poll_onu_online: ONU online | OLT=%s onu_id=%d', conn.ip, onu_id)
                    return {'success': True, 'run_state': 'online'}
                if any(s in low for s in ('offline', 'dying-gasp', 'los')):
                    logger.info('poll_onu_online: ONU %s | OLT=%s', last_state, conn.ip)

        _time_read.sleep(interval)

    logger.warning(
        'poll_onu_online: timeout %ds | OLT=%s onu_id=%d | ultimo run-state observado=%r',
        max_wait, conn.ip, onu_id, last_state,
    )
    return {'success': False, 'timeout': True, 'run_state': last_state}


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
    cmd = f'display ont info 0 {slot} {port} {onu_id}'
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


# Usuario PPPoE: alfanumérico + separadores comunes.
_PPPOE_USER_RE = re.compile(r'^[\w\-@\.]{1,64}$')
# La clave va entre comillas dobles en el CLI → se prohíben la comilla doble (0x22)
# y los caracteres de control (romperían el comando / permitirían inyección). Se
# permite el resto de imprimibles ASCII (las claves PPPoE suelen tener símbolos).
_PPPOE_PASS_RE = re.compile(r'^[\x20-\x21\x23-\x7e]{1,128}$')
_IPV4_RE = re.compile(r'^(\d{1,3}\.){3}\d{1,3}$')


def inject_wan_pppoe(
    conn:       OltConnectionSchema,
    slot:       int,
    port:       int,
    onu_id:     int,
    vlan:       int,
    username:   'str | None' = None,
    password:   'str | None' = None,
    mode:       str = 'pppoe',
    ip_address: 'str | None' = None,
    mask:       'str | None' = None,
    gateway:    'str | None' = None,
    pri_dns:    'str | None' = None,
) -> dict[str, Any]:
    """
    Fase 2 (modo routing): inyecta la WAN en la ONU vía OMCI desde el MA5800.

    Soporta los 3 métodos de autenticación del abonado (parámetro `mode`), mapeados a
    `ont ipconfig` (sintaxis verificada en MA5800 V100R018):
      - 'pppoe'  → ... pppoe vlan <v> priority 0 user-account username "<u>" password "<p>"
      - 'static' → ... static ip-address <ip> mask <m> [gateway <gw>] [pri-dns <d>] vlan <v>
      - 'dhcp'   → ... dhcp vlan <v>
    El resto (internet-config + wan-config profile-id 0 + policy-route + rutas eth) es
    común. Requiere ONU online. Síncrono — llamar desde asyncio.to_thread().
    """
    mode = (mode or 'pppoe').lower()
    if mode == 'pppoe':
        if not username or not _PPPOE_USER_RE.match(username):
            raise ProvisioningError(f'username PPPoE inválido: {username!r}.')
        if not password or not _PPPOE_PASS_RE.match(password):
            raise ProvisioningError('password PPPoE inválida (comillas dobles/control o >128).')
        ipcfg = (
            f'ont ipconfig {port} {onu_id} ip-index 1 pppoe vlan {vlan} priority 0 '
            f'user-account username "{username}" password "{password}"'
        )
    elif mode == 'static':
        if not (_IPV4_RE.match(ip_address or '') and _IPV4_RE.match(mask or '')):
            raise ProvisioningError('modo static requiere ip-address y mask IPv4 válidos.')
        gw_part  = f' gateway {gateway}' if gateway and _IPV4_RE.match(gateway) else ''
        dns_part = f' pri-dns {pri_dns}' if pri_dns and _IPV4_RE.match(pri_dns) else ''
        ipcfg = (
            f'ont ipconfig {port} {onu_id} ip-index 1 static '
            f'ip-address {ip_address} mask {mask}{gw_part}{dns_part} vlan {vlan}'
        )
    elif mode == 'dhcp':
        ipcfg = f'ont ipconfig {port} {onu_id} ip-index 1 dhcp vlan {vlan}'
    else:
        raise ProvisioningError(f'modo WAN no soportado: {mode!r} (pppoe|static|dhcp).')

    logger.info(
        'inject_wan: OLT=%s slot=%d port=%d onu_id=%d vlan=%d mode=%s',
        conn.ip, slot, port, onu_id, vlan, mode,
    )
    core_cmds = [
        'config',
        f'interface gpon 0/{slot}',
        ipcfg,
        f'ont internet-config {port} {onu_id} ip-index 1',
        f'ont wan-config {port} {onu_id} ip-index 1 profile-id 0',
        f'ont policy-route-config {port} {onu_id} profile-id 0',
    ]
    # Rutas de los puertos LAN (modo routing). Best-effort: una ONU con menos de 4
    # puertos ETH devolverá error en los inexistentes — no debe abortar la inyección.
    route_cmds = [f'ont port route {port} {onu_id} eth {i} enable' for i in range(1, 5)]
    verify_cmd = f'display ont wan-info {port} {onu_id}'   # 2-arg: contexto interface
    error_patterns = [
        'Error:', 'Failure:', 'Parameter error', 'Too many parameters',
        'Unknown command', 'Incomplete command', 'conflicts with', 'does not exist',
    ]
    n_verify = len(core_cmds) + len(route_cmds)

    # Reintento (hasta 3×): el comando largo `ont ipconfig` falla de forma intermitente
    # por el bug de espacios de VRP, o porque la ONU acaba de subir y el canal OMCI aún
    # no está listo. Se reintenta el bloque completo con espera. Sin `save` salvo al
    # verificar OK (evita el guardado en background que causa "conflicts").
    last_detail = ''
    for attempt in range(3):
        cmds = core_cmds + route_cmds + [verify_cmd, 'quit']
        try:
            parts = _paramiko_huawei_run(
                conn, cmds, timeout=settings.ssh_command_timeout, return_list=True,
            )
        except Exception as exc:
            last_detail = str(exc)
            logger.warning('inject_wan_pppoe intento %d SSH falló | OLT=%s: %s', attempt + 1, conn.ip, exc)
            _time_read.sleep(4)
            continue

        core_out = '\n'.join(parts[:len(core_cmds)])
        err_line = next(
            (l.strip() for pat in error_patterns for l in core_out.splitlines()
             if pat.lower() in l.lower()),
            None,
        )
        verify_out = parts[n_verify] if len(parts) > n_verify else ''
        # Verificación específica: PPPoE + la VLAN de gestión = la nuestra (distingue de
        # una config WAN previa de la ONU con otra VLAN).
        vlan_ok = re.search(rf'vlan\s*:\s*{vlan}\b', verify_out, re.IGNORECASE) is not None
        # El wan-info muestra "IPv4 access type: PPPoE/DHCP/Static" — verificamos el modo.
        mode_ok = mode in verify_out.lower()
        if not err_line and mode_ok and vlan_ok:
            try:
                _paramiko_huawei_run(conn, ['save'], timeout=settings.ssh_command_timeout)
            except Exception as exc:
                logger.warning('inject_wan: save falló (config en running) OLT=%s: %s', conn.ip, exc)
            logger.info(
                'inject_wan OK verificado | OLT=%s onu_id=%d mode=%s intento=%d',
                conn.ip, onu_id, mode, attempt + 1,
            )
            return {'success': True, 'olt_ip': conn.ip, 'onu_id': onu_id}

        last_detail = err_line or f'wan-info sin {mode}/VLAN {vlan}: {verify_out[-200:].strip()}'
        logger.warning('inject_wan intento %d no verificado | OLT=%s: %s', attempt + 1, conn.ip, last_detail)
        _time_read.sleep(4)

    raise ProvisioningError(
        f'La WAN ({mode}) no se aplicó en {conn.ip} (ont {slot}/{port}/{onu_id}) tras 3 intentos: {last_detail}'
    )


# ── Cambio de velocidad en caliente ───────────────────────────

def change_lineprofile(
    conn:               OltConnectionSchema,
    slot:               int,
    port:               int,
    onu_id:             int,
    service_port_id:    int,
    traffic_index_down: int,
    traffic_index_up:   int,
) -> dict[str, Any]:
    """
    Cambia la velocidad de una ONU Huawei MA5800 en caliente modificando
    el traffic-table vinculado al service-port.

    NO cambia el ont-lineprofile (afectaría todas las ONUs del perfil).
    Solo actualiza el outbound (downstream) e inbound (upstream) del service-port.

    CLI Huawei:
      service-port <id> traffic-table index <down> inbound traffic-table index <up>

    Síncrono — llamar desde asyncio.to_thread().
    """
    if conn.brand != OltBrand.HUAWEI:
        raise ProvisioningError(
            f'Cambio de velocidad en caliente no implementado para marca "{conn.brand.value}".'
        )
    logger.info(
        'change_lineprofile: OLT=%s slot=%d port=%d onu_id=%d sp=%d down=%d up=%d',
        conn.ip, slot, port, onu_id, service_port_id, traffic_index_down, traffic_index_up,
    )
    cmds = [
        'config',
        (
            f'service-port {service_port_id} '
            f'traffic-table index {traffic_index_down} '
            f'inbound traffic-table index {traffic_index_up}'
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
        'change_lineprofile OK | OLT=%s sp=%d down=%d up=%d',
        conn.ip, service_port_id, traffic_index_down, traffic_index_up,
    )
    return {
        'success':            True,
        'message':            (
            f'Velocidad actualizada: service-port={service_port_id} '
            f'down={traffic_index_down} up={traffic_index_up}'
        ),
        'service_port_id':    service_port_id,
        'traffic_index_down': traffic_index_down,
        'traffic_index_up':   traffic_index_up,
    }


# ── Suspensión / Rehabilitación por service-port ──────────────

def _get_ont_control_flag(
    conn: OltConnectionSchema, slot: int, port: int, onu_id: int,
) -> str | None:
    """
    Lee el 'Control flag' actual de un ONT (`display ont info <port> <onu_id>`
    dentro de `interface gpon 0/<slot>`). Devuelve el valor en minúsculas
    (ej. 'active', 'deactive') o None si no se pudo leer.
    """
    try:
        parts = _paramiko_huawei_run(
            conn,
            ['config', f'interface gpon 0/{slot}', f'display ont info {port} {onu_id}', 'quit', 'quit'],
            timeout=settings.ssh_command_timeout, return_list=True,
        )
    except Exception as exc:
        logger.error('_get_ont_control_flag SSH falló | OLT=%s: %s', conn.ip, exc)
        return None
    verify_out = parts[2] if len(parts) > 2 else ''
    m = re.search(r'Control flag\s*:\s*(\S+)', verify_out, re.IGNORECASE)
    return m.group(1).lower() if m else None


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

    Verificación dura + reintento (incidente 2026-07-17, contrato CNT-2026-000004):
    `_check_cli_error` solo detecta patrones de error conocidos — si el comando se
    corrompe por la misma colisión con el autosave asíncrono documentada para
    rollback_gpon/DBA-profile (ver memoria firmware R018), el ONT sigue
    "Control flag: active" pero la función igual reportaba success=True. Ahora se
    relee el Control flag real tras el comando y solo se confirma éxito si cambió.

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
        f'ont deactivate {port} {onu_id}',
        'quit',
        'save',
    ]
    last_flag: str | None = None
    for attempt in range(3):
        try:
            raw = _paramiko_huawei_run(conn, cmds, timeout=settings.ssh_command_timeout)
        except Exception as exc:
            logger.error('suspend_onu SSH falló | OLT=%s intento=%d: %s', conn.ip, attempt + 1, exc)
            _time_read.sleep(2)
            continue
        try:
            _check_cli_error(conn.brand, 'suspend_onu', raw)
        except CommandError as exc:
            raise ProvisioningError(str(exc)) from exc

        last_flag = _get_ont_control_flag(conn, slot, port, onu_id)
        if last_flag is not None and last_flag != 'active':
            logger.info(
                'suspend_onu OK verificado | OLT=%s slot=%d port=%d onu_id=%d control_flag=%s intento=%d',
                conn.ip, slot, port, onu_id, last_flag, attempt + 1,
            )
            return {
                'success':         True,
                'message':         f'ONU {onu_id} suspendida en slot={slot} port={port}',
                'olt_ip':          conn.ip,
                'service_port_id': service_port_id,
            }
        logger.warning(
            'suspend_onu NO verificado (control_flag=%s) | OLT=%s slot=%d port=%d onu_id=%d intento=%d',
            last_flag, conn.ip, slot, port, onu_id, attempt + 1,
        )
        _time_read.sleep(2)

    return {
        'success': False,
        'error':   f'ONT {slot}/{port}/{onu_id} sigue "Control flag: {last_flag}" tras 3 intentos de deactivate.',
        'olt_ip':  conn.ip,
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
        f'ont activate {port} {onu_id}',
        'quit',
        'save',
    ]
    last_flag: str | None = None
    for attempt in range(3):
        try:
            raw = _paramiko_huawei_run(conn, cmds, timeout=settings.ssh_command_timeout)
        except Exception as exc:
            logger.error('rehabilitate_onu SSH falló | OLT=%s intento=%d: %s', conn.ip, attempt + 1, exc)
            _time_read.sleep(2)
            continue
        try:
            _check_cli_error(conn.brand, 'rehabilitate_onu', raw)
        except CommandError as exc:
            raise ProvisioningError(str(exc)) from exc

        last_flag = _get_ont_control_flag(conn, slot, port, onu_id)
        if last_flag == 'active':
            logger.info(
                'rehabilitate_onu OK verificado | OLT=%s slot=%d port=%d onu_id=%d intento=%d',
                conn.ip, slot, port, onu_id, attempt + 1,
            )
            return {
                'success':         True,
                'message':         f'ONU {onu_id} rehabilitada en slot={slot} port={port}',
                'olt_ip':          conn.ip,
                'service_port_id': service_port_id,
            }
        logger.warning(
            'rehabilitate_onu NO verificado (control_flag=%s) | OLT=%s slot=%d port=%d onu_id=%d intento=%d',
            last_flag, conn.ip, slot, port, onu_id, attempt + 1,
        )
        _time_read.sleep(2)

    return {
        'success': False,
        'error':   f'ONT {slot}/{port}/{onu_id} sigue "Control flag: {last_flag}" tras 3 intentos de activate.',
        'olt_ip':  conn.ip,
        'service_port_id': service_port_id,
    }
