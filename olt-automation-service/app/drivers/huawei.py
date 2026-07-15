"""
Driver Huawei MA5x00 — cubre toda la familia MA5600/MA5603/MA5608/MA5680/MA5800.

Todos los modelos comparten el mismo CLI VRP (Versatile Routing Platform).
El modelo exacto se detecta automáticamente con 'display version'.

Estrategia de implementación:
  - Los métodos de aprovisionamiento/deprovisionamiento delegan en
    app.services.provisioning (código ya validado en producción).
  - Los métodos de health/POM son nuevos (display transceiver diagnose).
  - get_topology() abre UNA sesión SSH para todos los comandos de import.
"""
from __future__ import annotations

import logging
import re
import time as _time
from typing import Any

from app.schemas.olt import OltConnectionSchema
from app.drivers.base import (
    BoardInfo, NtpServerData, OltDriver, OltTopology, OntInfo,
    PomData, PonPortInfo, ServicePortInfo, SnmpCommunityData, SnmpNtpConfigData,
    TrafficTableInfo, VlanInfo,
)
from app.services.provisioning import (
    ConnectionError as ProvConnectionError,
    CommandError as ProvCommandError,
    ProvisioningError,
    _paramiko_huawei_run,
    _parse_version_info,
    _build_netmiko_params,
    _huawei_enter_enable,
    _check_cli_error,
    _open_multi_commands,
    deprovision_onu,
    discover_huawei_onus,
    display_huawei_board,
    get_bulk_metrics_huawei,
    inject_wan_pppoe,
    provision_gpon_ftth,
    rehabilitate_onu,
    suspend_onu,
    test_olt_connection,
)

logger = logging.getLogger(__name__)

# ── Thresholds POM ───────────────────────────────────────────
_TEMP_WARN_C     = 75.0
_TEMP_CRIT_C     = 85.0
_TX_WARN_DBM     = -3.0    # SFP degradado
_RX_WARN_DBM     = -28.0   # pérdida alta en fibra


def _pom_state(temp: float | None, tx: float | None) -> str:
    if temp is not None and temp >= _TEMP_CRIT_C:
        return 'critical'
    if temp is not None and temp >= _TEMP_WARN_C:
        return 'warn'
    if tx is not None and tx < _TX_WARN_DBM:
        return 'warn'
    if temp is None and tx is None:
        return 'unavailable'
    return 'ok'


class HuaweiDriver(OltDriver):
    """
    Driver Huawei MA5x00 (MA5600T / MA5603T / MA5608T / MA5680T / MA5800-Xn).

    Construir con la conexión de la OLT:
        driver = HuaweiDriver(conn)
    Todas las llamadas son síncronas — usar asyncio.to_thread() en main.py.
    """

    def __init__(self, conn: OltConnectionSchema) -> None:
        self._conn = conn

    # ── test_connection ───────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        """
        Abre sesión SSH, ejecuta 'display version', cierra.
        Retorna modelo y versión de firmware detectados.
        Nunca lanza — siempre retorna dict.
        """
        result = test_olt_connection(self._conn)
        # test_olt_connection retorna {'success': bool, 'model': ..., 'error': ...}
        # adaptamos al formato del driver
        return {
            'ok':       result.get('success', False),
            'model':    result.get('model'),
            'firmware': result.get('firmware_version') or result.get('software_version'),
            'error':    result.get('error'),
        }

    # ── get_topology ──────────────────────────────────────────

    def get_topology(self) -> OltTopology:
        """
        UNA sola sesión SSH (Paramiko puro) — obtiene toda la topología.
        Usa _paramiko_huawei_run con return_list=True para evitar el bug de
        session_preparation de Netmiko en Huawei MA5800 (ReadTimeout en prompt).
        """
        # display ont-lineprofile/srvprofile gpon all requiere config mode.
        # display traffic table ip from-index 0 y display board/vlan son global.
        cmds = [
            'display version',                       # idx 0 (modelo + firmware reales)
            'display board 0',                       # idx 1
            'display vlan all',                      # idx 2
            'config',                                # idx 3 (transición a config mode)
            'display ont-lineprofile gpon all',      # idx 4
            'display ont-srvprofile gpon all',       # idx 5
            'quit',                                  # idx 6 (vuelve a global)
            'display traffic table ip from-index 0', # idx 7
        ]
        try:
            outputs = _paramiko_huawei_run(
                self._conn, cmds,
                timeout=120.0,
                return_list=True,
            )
            ver_raw   = outputs[0]
            board_raw = outputs[1]
            vlan_raw  = outputs[2]
            lp_raw    = outputs[4]
            sp_raw    = outputs[5]
            tt_raw    = outputs[7]
        except ProvisioningError:
            raise
        except Exception as exc:
            raise ProvisioningError(
                f'Error obteniendo topología de {self._conn.ip}: {exc}'
            ) from exc

        boards           = self._parse_boards(board_raw)
        line_profiles    = self._parse_profiles_raw(lp_raw, 'display_ont_lineprofile_all.textfsm')
        service_profiles = self._parse_profiles_raw(sp_raw, 'display_ont_srvprofile_all.textfsm')

        traffic_tables = self._parse_traffic_tables(tt_raw)

        vlans = self._parse_vlans(vlan_raw)

        # Modelo/firmware reales (antes hardcodeado 'Huawei MA5x00' + '').
        # Necesario para clasificar compatibilidad de firmware en el ERP.
        ver = _parse_version_info(ver_raw)

        return OltTopology(
            model            = ver['model'] or 'Huawei MA5x00',
            firmware_version = '/'.join(x for x in [ver['firmware'], ver['patch']] if x),
            boards           = boards,
            vlans            = vlans,
            traffic_tables   = traffic_tables,
            line_profiles    = line_profiles,
            service_profiles = service_profiles,
        )

    # ── get_board_status ──────────────────────────────────────

    def get_board_status(self) -> list[BoardInfo]:
        raw = _paramiko_huawei_run(self._conn, ['display board 0'], timeout=30.0)
        boards = self._parse_boards(raw)
        if not boards:
            raise ProvisioningError(
                f"display_board falló en {self._conn.ip}: sin tarjetas parseadas"
            )
        return boards

    # ── get_pom_data ──────────────────────────────────────────

    def get_pom_data(self, slot: int, port: int) -> PomData:
        """
        Comando: display transceiver diagnose 0/slot/port
        Output Huawei:
          Transceiver Type               :GPON
          Temperature(C)                 :42.500
          Voltage(mV)                    :3289.400
          Bias Current(mA)               :41.310
          Tx Power(dBm)                  :+2.150
          Rx Power(dBm)                  :-18.430
        """
        cmd = f'display transceiver diagnose 0/{slot}/{port}'
        try:
            raw = _paramiko_huawei_run(self._conn, [cmd], timeout=30.0)
        except ProvisioningError as exc:
            logger.warning('get_pom_data slot=%d port=%d en %s: %s', slot, port, self._conn.ip, exc)
            return PomData(
                slot=slot, port=port,
                temperature_celsius=None, voltage_mv=None,
                laser_current_ma=None, tx_power_dbm=None,
                rx_power_dbm=None, state='unavailable',
            )

        temp = self._extract_float(raw, r'Temperature\(C\)\s*:\s*([\-\+]?\d+\.?\d*)')
        volt = self._extract_float(raw, r'Voltage\(mV\)\s*:\s*([\-\+]?\d+\.?\d*)')
        bias = self._extract_float(raw, r'Bias Current\(mA\)\s*:\s*([\-\+]?\d+\.?\d*)')
        tx   = self._extract_float(raw, r'Tx Power\(dBm\)\s*:\s*([\-\+]?\d+\.?\d*)')
        rx   = self._extract_float(raw, r'Rx Power\(dBm\)\s*:\s*([\-\+]?\d+\.?\d*)')

        return PomData(
            slot=slot, port=port,
            temperature_celsius=temp,
            voltage_mv=volt,
            laser_current_ma=bias,
            tx_power_dbm=tx,
            rx_power_dbm=rx,
            state=_pom_state(temp, tx),
        )

    # ── get_all_pom ───────────────────────────────────────────

    def get_all_pom(self) -> list[PomData]:
        """
        POM de todos los puertos PON en boards activos.
        Itera sobre get_board_status() para conocer los slots activos.
        """
        try:
            boards = self.get_board_status()
        except ProvisioningError:
            return []

        result: list[PomData] = []
        for board in boards:
            if board.state not in ('normal', 'active'):
                continue
            ports_count = self._ports_per_board(board.board_type)
            for port in range(ports_count):
                result.append(self.get_pom_data(board.slot, port))
        return result

    # ── get_snmp_ntp_config ────────────────────────────────────

    def get_snmp_ntp_config(self) -> SnmpNtpConfigData:
        """
        Config real de SNMP (communities read/write + versiones) y NTP
        (servidores configurados + reach) — UNA sesión Paramiko, 4 comandos.

        Comandos y formato de salida validados contra OLT real (MA5800-X7,
        2026-07-13):
          display snmp-agent community read
          display snmp-agent community write
          display snmp-agent sys-info
          display ntp-service sessions

        reach=0 en un servidor NTP significa que la OLT nunca recibió
        respuesta válida de ese servidor en los últimos 8 polls (RFC 5905) —
        no que esté "mal escrito", sino que el reloj no está sincronizado.
        """
        # NTP primero: es el único comando paginado ("---- More ----") y por
        # lo tanto el más lento/frágil. El deadline de _paramiko_huawei_run es
        # compartido entre los 4 comandos — ponerlo al final lo dejaba sin
        # presupuesto cuando esta llamada corría justo después de clasificar
        # ONUs de varios boards (sesión previa pesada, OLT con latencia alta).
        cmds = [
            'display ntp-service sessions',
            'display snmp-agent community read',
            'display snmp-agent community write',
            'display snmp-agent sys-info',
        ]
        try:
            outputs = _paramiko_huawei_run(self._conn, cmds, timeout=90.0, return_list=True)
        except Exception as exc:  # noqa: BLE001
            logger.warning('get_snmp_ntp_config en %s: %s', self._conn.ip, exc)
            return SnmpNtpConfigData(ok=False, error=str(exc))

        ntp_raw, read_raw, write_raw, sysinfo_raw = outputs

        communities = (
            [SnmpCommunityData(name=n, access='read')  for n in self._parse_community_names(read_raw)] +
            [SnmpCommunityData(name=n, access='write') for n in self._parse_community_names(write_raw)]
        )
        versions = self._parse_snmp_versions(sysinfo_raw)
        ntp_servers = self._parse_ntp_sessions(ntp_raw)

        return SnmpNtpConfigData(
            ok=True,
            snmp_communities=communities,
            snmp_versions=versions,
            ntp_servers=ntp_servers,
        )

    # ── get_service_ports ───────────────────────────────────────
    #
    # `display service-port all` — lista TODOS los service-ports reales.
    # Validado contra OLT real (MA5800-X7, 2026-07-14): 234 filas, formato
    #   INDEX VLAN VLAN-ATTR PORT-TYPE F/S/P VPI VCI FLOW-TYPE FLOW-PARA RX TX STATE
    # Solo se parsean INDEX, VLAN e STATE — suficiente para reconciliar el
    # pool de service-ports del ERP contra la realidad (Incremento 6: migrar
    # OLT en producción, hoy controlada por SmartOLT, sin que el ERP choque
    # con IDs que SmartOLT ya usa).
    def get_service_ports(self) -> list[ServicePortInfo]:
        try:
            raw = _paramiko_huawei_run(self._conn, ['display service-port all'], timeout=90.0)
        except Exception as exc:  # noqa: BLE001
            logger.warning('get_service_ports en %s: %s', self._conn.ip, exc)
            return []

        # Sin anclar '^': el paginador ("---- More ----") a veces deja la fila
        # siguiente pegada al final de esa misma línea de texto (el espacio que
        # avanza página no inserta salto de línea) — anclar a inicio de línea
        # perdía filas justo después de cada corte de página. Validado contra
        # OLT real: cuenta correcta (234 filas) sin el ancla.
        rows = re.findall(
            r'(\d+)\s+(\d+)\s+\S+\s+gpon\s+.*?(up|down)',
            raw,
        )
        return [
            ServicePortInfo(index=int(idx), vlan_id=int(vlan), state=state)
            for idx, vlan, state in rows
        ]

    # ── apply_ntp_servers ──────────────────────────────────────
    #
    # Incremento 5 — Execution real: converge la OLT hacia el estado
    # deseado que declara el ERP (antes solo se leía y se avisaba).
    #
    # SIEMPRE relee el estado actual antes de decidir el diff — nunca
    # confía en un snapshot cacheado que pudo cambiar. Idempotente: una
    # segunda llamada con el mismo `desired` calcula un diff vacío y no
    # ejecuta ningún comando de escritura.
    def apply_ntp_servers(self, desired: list[str]) -> SnmpNtpConfigData:
        actual_cfg = self.get_snmp_ntp_config()
        if not actual_cfg.ok:
            return actual_cfg  # no se pudo leer el estado real — no se escribe a ciegas

        actual_ips = {s.source for s in actual_cfg.ntp_servers}
        desired_ips = set(desired)

        a_agregar = desired_ips - actual_ips
        a_quitar  = actual_ips - desired_ips

        if not a_agregar and not a_quitar:
            logger.info('apply_ntp_servers en %s: sin cambios (ya converge)', self._conn.ip)
            return actual_cfg

        cmds = ['config']
        for ip in a_agregar:
            cmds.append(f'ntp-service unicast-server {ip}')
        for ip in a_quitar:
            cmds.append(f'undo ntp-service unicast-server {ip}')
        cmds.append('quit')

        logger.info(
            'apply_ntp_servers en %s: agregar=%s quitar=%s',
            self._conn.ip, sorted(a_agregar), sorted(a_quitar),
        )
        try:
            _paramiko_huawei_run(self._conn, cmds, timeout=60.0, return_list=True)
        except Exception as exc:  # noqa: BLE001
            logger.warning('apply_ntp_servers en %s: %s', self._conn.ip, exc)
            return SnmpNtpConfigData(ok=False, error=str(exc))

        # Releer para confirmar el estado real post-cambio — nunca asumir éxito.
        return self.get_snmp_ntp_config()

    def _parse_community_names(self, raw: str) -> list[str]:
        return re.findall(r'Community name\s*:\s*(\S+)', raw)

    def _parse_snmp_versions(self, raw: str) -> list[str]:
        # "\s*" abarca el salto de línea entre la etiqueta y el valor —
        # en el MA5800-X7 real no hay línea en blanco entre ambos.
        m = re.search(r'SNMP version running in the system:\s*(.+)', raw)
        if not m:
            return []
        return m.group(1).split()

    def _parse_ntp_sessions(self, raw: str) -> list[NtpServerData]:
        servers: list[NtpServerData] = []
        # Cada sesión es un bloque que empieza en "clock source:" — se separa
        # por ese marcador y se parsea cada bloque independientemente.
        blocks = re.split(r'(?=clock source\s*:)', raw)
        for block in blocks:
            m_source = re.search(r'clock source\s*:\s*(\S+)', block)
            if not m_source:
                continue
            m_stratum = re.search(r'clock stratum\s*:\s*(\d+)', block)
            m_status  = re.search(r'clock status\s*:\s*(.+)', block)
            m_reach   = re.search(r'reach\s*:\s*(\d+)', block)
            servers.append(NtpServerData(
                source=m_source.group(1),
                stratum=int(m_stratum.group(1)) if m_stratum else None,
                reach=int(m_reach.group(1)) if m_reach else 0,
                status=m_status.group(1).strip() if m_status else '',
            ))
        return servers

    # ── get_pon_port_status ───────────────────────────────────

    def get_pon_port_status(self, slot: int) -> list[PonPortInfo]:
        """
        Obtiene estado operativo de todos los puertos PON del slot.

        En MA5800 no existe 'display port state'; usamos solo
        'display ont info summary 0/slot/port' por cada puerto (0-15).
        El oper_state se deriva: total > 0 → 'up', si no → 'no-onus'.
        admin_state siempre 'enabled' (no hay comando CLI directo accesible).

        Una sola sesión SSH vía _paramiko_huawei_run con 16 comandos.
        Puertos sin respuesta (error CLI o vacíos) se descartan.
        """
        MAX_GPON_PORTS = 16
        cmds = [
            f'display ont info summary 0/{slot}/{p}'
            for p in range(MAX_GPON_PORTS)
        ]
        try:
            outputs = _paramiko_huawei_run(
                self._conn, cmds, timeout=90.0, return_list=True,
            )
        except ProvisioningError as exc:
            logger.warning('get_pon_port_status slot %d en %s: %s', slot, self._conn.ip, exc)
            return []

        result: list[PonPortInfo] = []
        for port_idx in range(MAX_GPON_PORTS):
            raw  = outputs[port_idx] if port_idx < len(outputs) else ''
            onus = self._parse_ont_summary(slot, port_idx, raw)
            if onus is None:
                # Puerto no existe en este slot (error CLI "% Unknown command")
                continue
            total   = onus['total']
            online  = onus['online']
            offline = onus['offline']
            result.append(PonPortInfo(
                slot         = slot,
                port         = port_idx,
                port_type    = 'GPON',
                admin_state  = 'enabled',
                oper_state   = 'up' if total > 0 else 'no-onus',
                autofind     = 'autofind',
                onus_total   = total,
                onus_online  = online,
                onus_offline = offline,
                max_capacity = 128,
            ))
        return result

    def _parse_ont_summary(self, slot: int, port: int, raw: str) -> dict | None:
        """
        Parsea 'display ont info summary 0/{slot}/{port}'.

        Formato MA5800 (confirmado en producción):
          In port 0/1/0, the total of ONTs are: 2, online: 2

        Retorna dict {total, online, offline}  o  None si el puerto no existe.
        None indica error CLI (comando no reconocido o slot/port inválido).
        """
        if not raw:
            return None

        # Puerto inválido (no existe en esta tarjeta)
        if re.search(r'%\s*(Unknown command|Parameter error)', raw):
            return None

        # Formato MA5800: "In port 0/1/0, the total of ONTs are: 2, online: 2"
        m = re.search(
            r'total of ONTs are\s*:\s*(\d+)[,\s]+online\s*:\s*(\d+)',
            raw, re.IGNORECASE,
        )
        if m:
            total  = int(m.group(1))
            online = int(m.group(2))
            return {'total': total, 'online': online, 'offline': total - online}

        # Formato alternativo tabular (MA5600/MA5603):
        #   Port       Total  Online  Offline
        #   0/ 1/ 0      2      2       0
        row_re = re.compile(
            r'0\s*/\s*' + str(slot) + r'\s*/\s*' + str(port) +
            r'\s+(\d+)\s+(\d+)\s+(\d+)',
        )
        m2 = row_re.search(raw)
        if m2:
            total   = int(m2.group(1))
            online  = int(m2.group(2))
            offline = int(m2.group(3))
            return {'total': total, 'online': online, 'offline': offline}

        # Puerto existe pero sin ONUs (output vacío / header sin datos)
        return {'total': 0, 'online': 0, 'offline': 0}

    # ── get_ont_list ──────────────────────────────────────────

    def get_ont_list(self, slot: int, port: int) -> list[OntInfo]:
        try:
            raw_list = get_bulk_metrics_huawei(self._conn, slot, port)
        except ProvisioningError as exc:
            raise ProvisioningError(
                f'get_ont_list {slot}/{port} en {self._conn.ip}: {exc}'
            ) from exc

        return [
            OntInfo(
                slot=r['slot'], port=r['port'], onu_id=r['onu_id'],
                sn=r.get('sn') or '',
                run_state=r.get('run_state', 'unknown'),
                rx_power_dbm=r.get('rx_power_dbm'),
                tx_power_dbm=r.get('tx_power_dbm'),
            )
            for r in raw_list
        ]

    # ── get_autofind_onus ─────────────────────────────────────

    def get_autofind_onus(
        self, slot: int | None = None, port: int | None = None,
    ) -> list[dict[str, Any]]:
        return discover_huawei_onus(self._conn, slot=slot, port=port)

    # ── provision_onu ─────────────────────────────────────────

    def provision_onu(
        self, slot: int, port: int, sn: str,
        line_profile_id: int, service_profile_id: int,
        description: str = '',
    ) -> dict[str, Any]:
        # Delega en provision_gpon_ftth que ya existe y está validado
        return provision_gpon_ftth(
            self._conn,
            frame=0, slot=slot, port=port, onu_id=0,
            sn=sn, service_port_id=None, vlan=None,
            lineprofile_id=line_profile_id,
            srvprofile_id=service_profile_id,
            description=description,
        )

    # ── deprovision_onu ───────────────────────────────────────

    def deprovision_onu(
        self, slot: int, port: int, onu_id: int,
        service_port_id: int | None = None,
    ) -> bool:
        result = deprovision_onu(
            self._conn, slot, port, onu_id, service_port_id, rack=0,
        )
        return bool(result.get('success'))

    # ── set_onu_state ─────────────────────────────────────────

    def set_onu_state(
        self, slot: int, port: int, onu_id: int, active: bool,
    ) -> bool:
        if active:
            result = rehabilitate_onu(self._conn, slot, port, onu_id, service_port_id=None)
        else:
            result = suspend_onu(self._conn, slot, port, onu_id, service_port_id=None)
        return bool(result.get('success', True))

    # ── inject_wan_pppoe ──────────────────────────────────────

    def inject_wan_pppoe(
        self, slot: int, port: int, onu_id: int,
        vlan_id: int, username: str, password: str,
    ) -> bool:
        result = inject_wan_pppoe(
            self._conn, slot, port, onu_id, vlan_id, username, password,
        )
        return bool(result.get('success'))

    # ── Helpers privados ──────────────────────────────────────

    def _extract_float(self, text: str, pattern: str) -> float | None:
        m = re.search(pattern, text, re.IGNORECASE)
        if not m:
            return None
        try:
            return float(m.group(1))
        except (ValueError, TypeError):
            return None

    def _parse_profiles_raw(self, raw: str, _fsm_name: str = '') -> list[dict]:
        """
        Parsea lineprofile/srvprofile con regex directo.
        Formato MA5800-X7: bloques "Profile-Index : N / Profile-Name : name".
        También soporta formato tabular como fallback.
        """
        result: list[dict] = []
        # Bloque: Profile-Index : N ... Profile-Name : name
        idx_matches  = list(re.finditer(r'Profile-[Ii]ndex\s*:\s*(\d+)', raw))
        name_matches = list(re.finditer(r'Profile-[Nn]ame\s*:\s*(\S+)', raw))
        if idx_matches and name_matches:
            for m_idx in idx_matches:
                pid = int(m_idx.group(1))
                # nombre más cercano después del índice
                following = [m for m in name_matches if m.start() > m_idx.start()]
                if not following:
                    continue
                nm = following[0].group(1)
                result.append({'profile_id': pid, 'name': nm})
            if result:
                return result
        # Fallback tabular: "  N  name  ..."
        for line in raw.splitlines():
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                pid = int(parts[0])
                name = parts[1]
                if pid >= 0 and name and not name.startswith('-'):
                    result.append({'profile_id': pid, 'name': name})
            except (ValueError, TypeError):
                continue
        return result

    def _parse_boards(self, raw: str) -> list[BoardInfo]:
        """
        Parsea 'display board 0' con regex directo.
        Formato MA5800-X7: "  N  BOARDNAME  STATUS  [SubType0 SubType1]  [X/Y]"
        El campo Online/Offline puede estar ausente (MA5800 con ciertos firmwares).
        Slots vacíos (sin nombre de tarjeta) se omiten automáticamente.
        """
        result: list[BoardInfo] = []
        # Online/Offline (X/Y) es opcional — no siempre aparece en display board 0
        pattern = re.compile(
            r'^\s{1,8}(\d{1,3})\s+([A-Za-z]\S*)\s+(\w[\w_]*)'  # slot, board, status
            r'(?:.*?(\d+)/(\d+))?',                              # online/offline (opcional)
            re.MULTILINE,
        )
        for m in pattern.finditer(raw):
            slot_id    = int(m.group(1))
            board_name = m.group(2)
            status     = m.group(3).lower()
            online     = int(m.group(4)) if m.group(4) is not None else 0
            offline    = int(m.group(5)) if m.group(5) is not None else 0
            result.append(BoardInfo(
                slot=slot_id, board_type=board_name, state=status,
                onu_count=online + offline, onu_capacity=128,
                online_onus=online, offline_onus=offline,
            ))
        return result

    def _parse_traffic_tables(self, raw: str) -> list[TrafficTableInfo]:
        """
        Parsea la salida de 'display traffic table ip from-index 0'.
        MA5800: formato tabular — columnas TID CIR CBS PIR PBS Priority ...
        Fallback: bloques key-value (MA5600/MA5603 firmware antiguo).
        """
        result: list[TrafficTableInfo] = []

        # Formato 1: key-value (firmware antiguo)
        # "Traffic table name : X" + "Traffic table index : N" + "CIR : N" + "PIR : N"
        name_matches = list(re.finditer(r'Traffic table name\s*:\s*(\S+)', raw))
        if name_matches:
            idx_matches = list(re.finditer(r'Traffic table index\s*:\s*(\d+)', raw))
            cir_matches = list(re.finditer(r'CIR\S*\s*:\s*(\d+)', raw))
            pir_matches = list(re.finditer(r'PIR\S*\s*:\s*(\d+)', raw))
            cbs_matches = list(re.finditer(r'CBS\S*\s*:\s*(\d+)', raw))
            pbs_matches = list(re.finditer(r'PBS\S*\s*:\s*(\d+)', raw))

            def _nearest_after(matches: list, pos: int):
                following = [m for m in matches if m.start() > pos]
                return following[0] if following else None

            for m_name in name_matches:
                m_idx = _nearest_after(idx_matches, m_name.start())
                m_cir = _nearest_after(cir_matches, m_name.start())
                m_pir = _nearest_after(pir_matches, m_name.start())
                m_cbs = _nearest_after(cbs_matches, m_name.start())
                m_pbs = _nearest_after(pbs_matches, m_name.start())
                next_block = _nearest_after(name_matches, m_name.start())
                boundary   = next_block.start() if next_block else len(raw)
                try:
                    idx  = int(m_idx.group(1)) if m_idx and m_idx.start() < boundary else -1
                    cir  = int(m_cir.group(1)) if m_cir and m_cir.start() < boundary else 0
                    pir  = int(m_pir.group(1)) if m_pir and m_pir.start() < boundary else 0
                    cbs  = int(m_cbs.group(1)) if m_cbs and m_cbs.start() < boundary else 0
                    pbs  = int(m_pbs.group(1)) if m_pbs and m_pbs.start() < boundary else 0
                    name = m_name.group(1)
                    if idx >= 0 and name:
                        result.append(TrafficTableInfo(
                            index=idx, name=name,
                            cir_kbps=cir or None,
                            pir_kbps=pir or None,
                            cbs_bytes=cbs or None,
                            pbs_bytes=pbs or None,
                        ))
                except (ValueError, TypeError):
                    continue
            return result

        # Formato 2: tabular MA5800 — TID CIR CBS PIR PBS Priority ...
        # Las columnas con valor "off" se omiten (TID 6 en algunos firmwares)
        for i, line in enumerate(raw.splitlines()):
            parts = line.split()
            if len(parts) < 4:
                continue
            try:
                tid = int(parts[0])
                cir = int(parts[1])   # col 1 = CIR
                cbs = int(parts[2])   # col 2 = CBS (bytes)
                pir = int(parts[3])   # col 3 = PIR
                pbs = int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 0  # col 4 = PBS
                result.append(TrafficTableInfo(
                    index=tid,
                    name=f'traffic-table-{tid}',
                    cir_kbps=cir if cir > 0 else None,
                    pir_kbps=pir if pir > 0 else None,
                    cbs_bytes=cbs if cbs > 0 else None,
                    pbs_bytes=pbs if pbs > 0 else None,
                ))
            except (ValueError, TypeError):
                continue
        return result

    def _parse_boards_from_dict(self, slots: list[dict]) -> list[BoardInfo]:
        result = []
        for s in slots:
            online  = s.get('online_onus', 0) or 0
            offline = s.get('offline_onus', 0) or 0
            result.append(BoardInfo(
                slot         = s['slot_id'],
                board_type   = s.get('board_name', ''),
                state        = s.get('status', 'unknown'),
                onu_count    = online + offline,
                onu_capacity = 128,   # default MA5800 GPBD; ajustar si hay datos
                online_onus  = online,
                offline_onus = offline,
            ))
        return result

    def _parse_boards_from_rows(self, rows: list[dict]) -> list[BoardInfo]:
        result = []
        for row in rows:
            if 'raw' in row:
                continue
            try:
                slot_id    = int(row.get('SlotId') or -1)
                board_name = str(row.get('BoardName') or '').strip()
                status     = str(row.get('Status') or '').strip().lower()
                oo_str     = str(row.get('OnlineOffline') or '-/-').strip()
            except (ValueError, TypeError):
                continue
            if slot_id < 0 or not board_name:
                continue
            parts   = oo_str.split('/')
            online  = int(parts[0]) if parts and parts[0].isdigit() else 0
            offline = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
            result.append(BoardInfo(
                slot         = slot_id,
                board_type   = board_name,
                state        = status,
                onu_count    = online + offline,
                onu_capacity = 128,
                online_onus  = online,
                offline_onus = offline,
            ))
        return result

    def _parse_vlans(self, raw: str) -> list[VlanInfo]:
        """
        Parsea 'display vlan all'.
        Formato Huawei: líneas con VLAN ID y nombre.
        """
        vlans: list[VlanInfo] = []
        # Líneas típicas: "  100    smartolt          common  ..."
        for line in raw.splitlines():
            parts = line.split()
            if not parts:
                continue
            try:
                vid = int(parts[0])
            except ValueError:
                continue
            if vid < 1 or vid > 4094:
                continue
            name = parts[1] if len(parts) > 1 else f'VLAN-{vid}'
            vlans.append(VlanInfo(vlan_id=vid, name=name))
        return vlans

    def _ports_per_board(self, board_type: str) -> int:
        """Retorna puertos PON según el tipo de tarjeta."""
        bt = board_type.upper()
        if any(t in bt for t in ('GPBD', 'GPBH', 'GPFD', 'GPFH')):
            return 8
        if 'GPHF' in bt or 'GPLF' in bt:
            return 16
        return 8   # default seguro
