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
    BoardInfo, OltDriver, OltTopology, OntInfo,
    PomData, TrafficTableInfo, VlanInfo,
)
from app.services.provisioning import (
    ConnectionError as ProvConnectionError,
    CommandError as ProvCommandError,
    ProvisioningError,
    _paramiko_huawei_run,
    _build_netmiko_params,
    _huawei_enter_enable,
    _check_cli_error,
    _parse_output,
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
        UNA sola sesión SSH — obtiene toda la topología en una secuencia de comandos.
        No abre sesiones adicionales para version ni profiles (evita 3x overhead SSH).
        """
        cmds = [
            'display board 0',
            'display ont-lineprofile all',
            'display ont-srvprofile all',
            'display traffic table all',
            'display vlan all',
        ]
        try:
            board_raw, lp_raw, sp_raw, tt_raw, vlan_raw = _open_multi_commands(
                self._conn, cmds,
            )
        except (ProvConnectionError, ProvCommandError) as exc:
            raise ProvisioningError(
                f'Error obteniendo topología de {self._conn.ip}: {exc}'
            ) from exc

        boards           = self._parse_boards(board_raw)
        line_profiles    = self._parse_profiles_raw(lp_raw, 'display_ont_lineprofile_all.textfsm')
        service_profiles = self._parse_profiles_raw(sp_raw, 'display_ont_srvprofile_all.textfsm')

        tt_rows = _parse_output(self._conn.brand, 'display_traffic_table_all.textfsm', tt_raw)
        traffic_tables = []
        for row in tt_rows:
            if 'raw' in row:
                continue
            try:
                traffic_tables.append(TrafficTableInfo(
                    index    = int(row.get('TrafficIndex') or -1),
                    name     = str(row.get('TrafficName') or '').strip(),
                    cir_kbps = int(row.get('Cir') or 0) or None,
                    pir_kbps = int(row.get('Pir') or 0) or None,
                ))
            except (ValueError, TypeError):
                continue

        vlans = self._parse_vlans(vlan_raw)

        return OltTopology(
            model            = 'Huawei MA5x00',
            firmware_version = '',
            boards           = boards,
            vlans            = vlans,
            traffic_tables   = traffic_tables,
            line_profiles    = line_profiles,
            service_profiles = service_profiles,
        )

    # ── get_board_status ──────────────────────────────────────

    def get_board_status(self) -> list[BoardInfo]:
        result = display_huawei_board(self._conn)
        if not result.get('success'):
            raise ProvisioningError(
                f"display_board falló en {self._conn.ip}: {result.get('error')}"
            )
        return self._parse_boards_from_dict(result['slots'])

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

    def _parse_profiles_raw(self, raw: str, fsm_name: str) -> list[dict]:
        """Parsea lineprofile/srvprofile sin abrir nueva sesión SSH."""
        rows = _parse_output(self._conn.brand, fsm_name, raw)
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

    def _parse_boards(self, raw: str) -> list[BoardInfo]:
        rows = _parse_output(self._conn.brand, 'display_board_0.textfsm', raw)
        return self._parse_boards_from_rows(rows)

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
