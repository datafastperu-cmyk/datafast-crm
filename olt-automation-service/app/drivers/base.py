"""
Interfaz común para todos los drivers de OLT.

Cualquier nueva marca se implementa creando una clase que herede
de OltDriver y registrándola en __init__.py::get_driver().
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


# ── Dataclasses de retorno ────────────────────────────────────

@dataclass
class BoardInfo:
    slot: int
    board_type: str           # "GPBD", "GPON-8", "X2CS"
    state: str                # "normal" | "fault" | "absent" | "standby"
    onu_count: int            # ONUs activas en el slot
    onu_capacity: int         # capacidad máxima del slot
    online_onus: int = 0
    offline_onus: int = 0


@dataclass
class PomData:
    slot: int
    port: int
    temperature_celsius: float | None
    voltage_mv: float | None
    laser_current_ma: float | None
    tx_power_dbm: float | None    # potencia TX del SFP del OLT
    rx_power_dbm: float | None    # potencia RX promedio recibida
    state: str = 'ok'             # "ok" | "warn" | "critical" | "unavailable"


@dataclass
class OntInfo:
    slot: int
    port: int
    onu_id: int
    sn: str
    run_state: str              # "online" | "offline" | "rogue" | "unknown"
    config_state: str = 'active'
    rx_power_dbm: float | None = None
    tx_power_dbm: float | None = None
    distance_m: int | None = None
    description: str = ''


@dataclass
class VlanInfo:
    vlan_id: int
    name: str


@dataclass
class TrafficTableInfo:
    index: int
    name: str
    cir_kbps: int | None
    pir_kbps: int | None


@dataclass
class PonPortInfo:
    slot:         int
    port:         int
    port_type:    str         # 'GPON' | 'EPON' | 'XGS-PON'
    admin_state:  str         # 'enabled' | 'disabled' | 'unknown'
    oper_state:   str         # 'up' | 'down' | 'unknown'
    autofind:     str         # 'autofind' | 'manual' | 'unknown'
    onus_total:   int = 0
    onus_online:  int = 0
    onus_offline: int = 0
    max_capacity: int = 128


@dataclass
class OltTopology:
    model: str
    firmware_version: str
    boards: list[BoardInfo] = field(default_factory=list)
    vlans: list[VlanInfo] = field(default_factory=list)
    traffic_tables: list[TrafficTableInfo] = field(default_factory=list)
    line_profiles: list[dict[str, Any]] = field(default_factory=list)
    service_profiles: list[dict[str, Any]] = field(default_factory=list)


# ── Excepciones del driver ────────────────────────────────────

class UnsupportedBrandError(Exception):
    """Marca no registrada en el factory."""


class DriverNotImplementedError(Exception):
    """Operación pendiente de validación con OLT real."""


# ── Interfaz abstracta ────────────────────────────────────────

class OltDriver(ABC):
    """
    Contrato que todo driver de marca debe implementar.

    Todos los métodos son SÍNCRONOS (Netmiko/Paramiko usan sockets
    bloqueantes). Invocarlos desde asyncio.to_thread() en main.py.
    """

    @abstractmethod
    def test_connection(self) -> dict[str, Any]:
        """
        Prueba de conectividad SSH sin ejecutar comandos de negocio.
        Retorna: {'ok': bool, 'model': str|None, 'firmware': str|None, 'error': str|None}
        Nunca lanza excepciones — siempre retorna dict.
        """

    @abstractmethod
    def get_topology(self) -> OltTopology:
        """
        Recupera en UNA sesión SSH: boards, VLANs, traffic tables,
        line profiles y service profiles.
        """

    @abstractmethod
    def get_board_status(self) -> list[BoardInfo]:
        """Estado de todos los boards/slots del chasis."""

    @abstractmethod
    def get_pom_data(self, slot: int, port: int) -> PomData:
        """POM del transceptor SFP en un puerto PON específico."""

    @abstractmethod
    def get_all_pom(self) -> list[PomData]:
        """POM de todos los puertos PON activos (itera get_board_status)."""

    def get_pon_port_status(self, slot: int) -> list[PonPortInfo]:
        """
        Estado operativo de todos los puertos PON en un slot:
        admin/oper state, ONUs online/offline.
        Implementación opcional — retorna [] por defecto.
        No es abstracto para no forzar implementación en drivers sin soporte.
        """
        return []

    @abstractmethod
    def get_ont_list(self, slot: int, port: int) -> list[OntInfo]:
        """Lista de ONUs registradas en un puerto PON."""

    @abstractmethod
    def get_autofind_onus(
        self, slot: int | None = None, port: int | None = None,
    ) -> list[dict[str, Any]]:
        """ONUs no configuradas detectadas en autofind/uncfg."""

    @abstractmethod
    def provision_onu(
        self, slot: int, port: int, sn: str,
        line_profile_id: int, service_profile_id: int,
        description: str = '',
    ) -> dict[str, Any]:
        """Registrar ONU en la OLT (ont add)."""

    @abstractmethod
    def deprovision_onu(
        self, slot: int, port: int, onu_id: int,
        service_port_id: int | None = None,
    ) -> bool:
        """Eliminar ONU de la OLT."""

    @abstractmethod
    def set_onu_state(
        self, slot: int, port: int, onu_id: int, active: bool,
    ) -> bool:
        """Activar (True) o suspender (False) una ONU."""

    @abstractmethod
    def inject_wan_pppoe(
        self, slot: int, port: int, onu_id: int,
        vlan_id: int, username: str, password: str,
    ) -> bool:
        """Inyectar configuración PPPoE en la ONU vía OMCI."""
