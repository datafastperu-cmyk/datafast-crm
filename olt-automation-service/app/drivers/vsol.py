"""
Driver V-SOL — familia VD5800 / V1600G.

CLI Cisco-like. Notación de interfaz:
    gpon-onu_[chassis]/[slot]/[port]:[onu_id]
    Ej: gpon-onu_1/1/2:5  → chasis 1, slot 1, puerto 2, ONU 5

Estado de cada método:
  [DOC]      → implementado desde documentación oficial V-SOL, no validado con OLT real
  [VALIDATE] → pendiente de prueba con OLT física antes de habilitar en producción
  [STUB]     → sin implementar hasta validación completa

Flujo de validación (Fase 11 del plan):
  1. Conectar a OLT V-SOL real.
  2. Ejecutar comandos [DOC] → verificar output real → ajustar parsers.
  3. Marcar métodos como [VALIDATED + fecha].
  4. Reemplazar NotImplementedError de métodos [STUB].
"""
from __future__ import annotations

import logging
import re
import time as _time
from typing import Any

import paramiko

from app.schemas.olt import OltConnectionSchema
from app.drivers.base import (
    BoardInfo, DriverNotImplementedError, OltDriver, OltTopology,
    OntInfo, PomData, TrafficTableInfo, VlanInfo,
)

logger = logging.getLogger(__name__)

# ── Thresholds POM ───────────────────────────────────────────
_TEMP_WARN_C = 75.0
_TEMP_CRIT_C = 85.0
_TX_WARN_DBM = -3.0


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


class VSolDriver(OltDriver):
    """
    Driver V-SOL VD5800 / V1600G4/8/16 / VD5824G.

    Usa Paramiko (invoke_shell) para manejar el prompt Cisco-like sin
    depender de la integración Netmiko que no tiene tipo nativo V-SOL.
    """

    # Patrón de prompt V-SOL: "hostname>" o "hostname#" o "hostname(config)#"
    _PROMPT_RE = re.compile(r'\S+[>#]\s*$', re.MULTILINE)

    def __init__(self, conn: OltConnectionSchema) -> None:
        self._conn = conn

    # ── SSH helpers ───────────────────────────────────────────

    def _ssh_run(self, commands: list[str], timeout: float = 30.0) -> str:
        """
        Abre shell SSH, ejecuta comandos secuencialmente,
        retorna salida acumulada.
        """
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(
                hostname=self._conn.ip,
                port=self._conn.port,
                username=self._conn.username,
                password=self._conn.password,
                timeout=15,
                look_for_keys=False,
                allow_agent=False,
            )
            chan = ssh.invoke_shell(width=200, height=50)
            chan.settimeout(timeout)
            deadline = _time.monotonic() + timeout

            # Consumir banner inicial
            self._read_until_prompt(chan, deadline)

            output_parts: list[str] = []
            for cmd in commands:
                chan.send(cmd + '\r\n')
                part = self._read_until_prompt(chan, deadline)
                output_parts.append(part)

            chan.close()
            return '\n'.join(output_parts)

        except paramiko.AuthenticationException as exc:
            raise ConnectionError(
                f'V-SOL auth fallida en {self._conn.ip}'
            ) from exc
        except (paramiko.SSHException, OSError, TimeoutError) as exc:
            raise ConnectionError(
                f'Error SSH V-SOL en {self._conn.ip}: {exc}'
            ) from exc
        finally:
            try:
                ssh.close()
            except Exception:  # noqa: BLE001
                pass

    def _read_until_prompt(self, chan: 'paramiko.Channel', deadline: float) -> str:
        buf = ''
        while _time.monotonic() < deadline:
            if chan.recv_ready():
                buf += chan.recv(4096).decode('utf-8', errors='replace')
                if self._PROMPT_RE.search(buf.replace('\r', '')):
                    break
            _time.sleep(0.05)
        return buf

    def _extract_float(self, text: str, pattern: str) -> float | None:
        m = re.search(pattern, text, re.IGNORECASE)
        if not m:
            return None
        try:
            return float(m.group(1))
        except (ValueError, TypeError):
            return None

    # ── test_connection ───────────────────────────────────────
    # [DOC] — show version

    def test_connection(self) -> dict[str, Any]:
        try:
            raw = self._ssh_run(['show version'], timeout=15.0)
        except Exception as exc:  # noqa: BLE001
            return {'ok': False, 'model': None, 'firmware': None, 'error': str(exc)}

        # Output esperado (V-SOL):
        # Product Name    : V-SOL VD5824G
        # Software Version: V1.0R003B10
        model = None
        firmware = None
        for line in raw.splitlines():
            if 'product name' in line.lower():
                model = line.split(':', 1)[-1].strip()
            elif 'software version' in line.lower():
                firmware = line.split(':', 1)[-1].strip()

        ok = model is not None
        return {'ok': ok, 'model': model, 'firmware': firmware, 'error': None if ok else 'No se pudo detectar modelo'}

    # ── get_board_status ──────────────────────────────────────
    # [DOC] — show card

    def get_board_status(self) -> list[BoardInfo]:
        raw = self._ssh_run(['show card'], timeout=20.0)
        return self._parse_cards(raw)

    def _parse_cards(self, raw: str) -> list[BoardInfo]:
        """
        Output esperado (V-SOL VD5800):
        SLOT  CARD TYPE    STATUS    PORT NUM  ONT NUM
        1     GPON-8       NORMAL    8         64
        2     GPON-8       NORMAL    8         128
        [VALIDATE con OLT real — ajustar columnas si difieren]
        """
        boards: list[BoardInfo] = []
        header_found = False
        for line in raw.splitlines():
            stripped = line.strip()
            if 'SLOT' in stripped.upper() and 'CARD' in stripped.upper():
                header_found = True
                continue
            if not header_found:
                continue
            parts = stripped.split()
            if len(parts) < 3:
                continue
            try:
                slot       = int(parts[0])
                board_type = parts[1]
                state      = parts[2].lower()
                capacity   = int(parts[4]) if len(parts) > 4 else 64
                boards.append(BoardInfo(
                    slot=slot, board_type=board_type, state=state,
                    onu_count=0, onu_capacity=capacity,
                ))
            except (ValueError, IndexError):
                continue
        return boards

    # ── get_pom_data ──────────────────────────────────────────
    # [DOC] — show interface gpon 1/slot/port

    def get_pom_data(self, slot: int, port: int) -> PomData:
        cmd = f'show interface gpon 1/{slot}/{port}'
        try:
            raw = self._ssh_run([cmd], timeout=20.0)
        except Exception as exc:  # noqa: BLE001
            logger.warning('V-SOL get_pom_data %d/%d en %s: %s', slot, port, self._conn.ip, exc)
            return PomData(
                slot=slot, port=port,
                temperature_celsius=None, voltage_mv=None,
                laser_current_ma=None, tx_power_dbm=None,
                rx_power_dbm=None, state='unavailable',
            )

        # Output esperado (VALIDATE):
        # Olt Tx Power      : 2.15 dBm
        # Olt Rx Power      : -18.43 dBm
        # Temperature       : 42.5 C
        # Voltage           : 3289 mV
        # Bias Current      : 41.3 mA
        tx   = self._extract_float(raw, r'Olt Tx Power\s*:\s*([\-\+]?\d+\.?\d*)')
        rx   = self._extract_float(raw, r'Olt Rx Power\s*:\s*([\-\+]?\d+\.?\d*)')
        temp = self._extract_float(raw, r'Temperature\s*:\s*([\-\+]?\d+\.?\d*)')
        volt = self._extract_float(raw, r'Voltage\s*:\s*([\-\+]?\d+\.?\d*)')
        bias = self._extract_float(raw, r'Bias Current\s*:\s*([\-\+]?\d+\.?\d*)')

        return PomData(
            slot=slot, port=port,
            temperature_celsius=temp, voltage_mv=volt,
            laser_current_ma=bias, tx_power_dbm=tx,
            rx_power_dbm=rx, state=_pom_state(temp, tx),
        )

    # ── get_all_pom ───────────────────────────────────────────

    def get_all_pom(self) -> list[PomData]:
        try:
            boards = self.get_board_status()
        except Exception:  # noqa: BLE001
            return []
        result: list[PomData] = []
        for board in boards:
            if board.state not in ('normal', 'active', 'ok'):
                continue
            for port in range(board.onu_capacity // 8 or 8):
                result.append(self.get_pom_data(board.slot, port))
        return result

    # ── get_ont_list ──────────────────────────────────────────
    # [DOC] — show gpon onu state gpon-onu_1/slot/port

    def get_ont_list(self, slot: int, port: int) -> list[OntInfo]:
        cmd = f'show gpon onu state gpon-onu_1/{slot}/{port}'
        try:
            raw = self._ssh_run([cmd], timeout=30.0)
        except Exception as exc:  # noqa: BLE001
            raise ConnectionError(
                f'V-SOL get_ont_list {slot}/{port} en {self._conn.ip}: {exc}'
            ) from exc
        return self._parse_onu_state(raw, slot, port)

    def _parse_onu_state(self, raw: str, slot: int, port: int) -> list[OntInfo]:
        """
        Output esperado (V-SOL):
        ONU  SERNO           ADMIN   OPER     AUTH   RX_POWER
        1    VSOL12345678    enable  online   auto   -18.50
        2    VSOL87654321    enable  offline  auto   N/A
        [VALIDATE con OLT real]
        """
        onts: list[OntInfo] = []
        header_found = False
        for line in raw.splitlines():
            stripped = line.strip()
            if 'SERNO' in stripped.upper() or 'ONU' in stripped.upper():
                header_found = True
                continue
            if not header_found or not stripped:
                continue
            parts = stripped.split()
            if len(parts) < 4:
                continue
            try:
                onu_id    = int(parts[0])
                sn        = parts[1]
                run_state = parts[3].lower()
                rx_str    = parts[5] if len(parts) > 5 else 'N/A'
                rx        = float(rx_str) if rx_str not in ('N/A', '-', '--', '') else None
                onts.append(OntInfo(
                    slot=slot, port=port, onu_id=onu_id, sn=sn,
                    run_state=run_state if run_state in ('online', 'offline', 'rogue') else 'unknown',
                    rx_power_dbm=rx,
                ))
            except (ValueError, IndexError):
                continue
        return onts

    # ── get_autofind_onus ─────────────────────────────────────
    # [DOC] — show gpon onu uncfg

    def get_autofind_onus(
        self, slot: int | None = None, port: int | None = None,
    ) -> list[dict[str, Any]]:
        try:
            raw = self._ssh_run(['show gpon onu uncfg'], timeout=30.0)
        except Exception as exc:  # noqa: BLE001
            raise ConnectionError(
                f'V-SOL autofind en {self._conn.ip}: {exc}'
            ) from exc
        return self._parse_autofind(raw, slot, port)

    def _parse_autofind(
        self, raw: str,
        slot: int | None, port: int | None,
    ) -> list[dict[str, Any]]:
        """
        Output esperado (V-SOL):
        INDEX  GPON-ONU          SN              LOID  PASSWORD  TIME
        1      1/1/1             VSOL12345678    -     -         2024-01-01
        [VALIDATE con OLT real]
        """
        result: list[dict[str, Any]] = []
        header_found = False
        for line in raw.splitlines():
            stripped = line.strip()
            if 'GPON-ONU' in stripped.upper() and 'SN' in stripped.upper():
                header_found = True
                continue
            if not header_found or not stripped:
                continue
            parts = stripped.split()
            if len(parts) < 3:
                continue
            try:
                iface = parts[1]          # "1/1/2"
                sn    = parts[2]
                bits  = iface.split('/')
                s     = int(bits[1]) if len(bits) > 2 else 0
                p     = int(bits[2]) if len(bits) > 2 else 0
            except (ValueError, IndexError):
                continue
            if slot is not None and s != slot:
                continue
            if port is not None and p != port:
                continue
            result.append({'sn': sn, 'slot': s, 'port': p, 'ont_model': None})
        return result

    # ── get_topology ──────────────────────────────────────────
    # [DOC] — compuesto de los métodos anteriores

    def get_topology(self) -> OltTopology:
        tc = self.test_connection()
        boards = self.get_board_status()

        # VLANs [VALIDATE]
        try:
            vlan_raw = self._ssh_run(['show vlan'], timeout=20.0)
            vlans = self._parse_vlans(vlan_raw)
        except Exception:  # noqa: BLE001
            vlans = []

        # Traffic profiles [VALIDATE]
        try:
            tt_raw = self._ssh_run(['show traffic profile'], timeout=20.0)
            traffic_tables = self._parse_traffic_profiles(tt_raw)
        except Exception:  # noqa: BLE001
            traffic_tables = []

        return OltTopology(
            model            = tc.get('model') or 'V-SOL',
            firmware_version = tc.get('firmware') or '',
            boards           = boards,
            vlans            = vlans,
            traffic_tables   = traffic_tables,
            line_profiles    = [],    # VALIDATE: no mapeado aún
            service_profiles = [],    # VALIDATE: no mapeado aún
        )

    def _parse_vlans(self, raw: str) -> list[VlanInfo]:
        """[VALIDATE] — parseo de 'show vlan' V-SOL."""
        vlans: list[VlanInfo] = []
        for line in raw.splitlines():
            parts = line.split()
            if not parts:
                continue
            try:
                vid = int(parts[0])
            except ValueError:
                continue
            if not 1 <= vid <= 4094:
                continue
            name = parts[1] if len(parts) > 1 else f'VLAN-{vid}'
            vlans.append(VlanInfo(vlan_id=vid, name=name))
        return vlans

    def _parse_traffic_profiles(self, raw: str) -> list[TrafficTableInfo]:
        """[VALIDATE] — parseo de 'show traffic profile' V-SOL."""
        tables: list[TrafficTableInfo] = []
        for line in raw.splitlines():
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                idx  = int(parts[0])
                name = parts[1]
                cir  = int(parts[2]) if len(parts) > 2 else None
                pir  = int(parts[3]) if len(parts) > 3 else None
                tables.append(TrafficTableInfo(index=idx, name=name, cir_kbps=cir, pir_kbps=pir))
            except (ValueError, IndexError):
                continue
        return tables

    # ── Métodos de escritura — pendientes de validación ──────
    # [STUB] — activar tras Fase 11 (validación con OLT real)

    def provision_onu(
        self, slot: int, port: int, sn: str,
        line_profile_id: int, service_profile_id: int,
        description: str = '',
    ) -> dict[str, Any]:
        raise DriverNotImplementedError(
            'Provisioning V-SOL pendiente de validación con OLT real (Fase 11). '
            'Conectar OLT V-SOL y validar secuencia CLI antes de activar.'
        )

    def deprovision_onu(
        self, slot: int, port: int, onu_id: int,
        service_port_id: int | None = None,
    ) -> bool:
        raise DriverNotImplementedError(
            'Deprovision V-SOL pendiente de validación (Fase 11).'
        )

    def set_onu_state(
        self, slot: int, port: int, onu_id: int, active: bool,
    ) -> bool:
        raise DriverNotImplementedError(
            'Suspensión/rehabilitación V-SOL pendiente de validación (Fase 11).'
        )

    def inject_wan_pppoe(
        self, slot: int, port: int, onu_id: int,
        vlan_id: int, username: str, password: str,
    ) -> bool:
        raise DriverNotImplementedError(
            'WAN PPPoE V-SOL pendiente de validación (Fase 11).'
        )
