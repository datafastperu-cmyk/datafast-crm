from enum import Enum
from pydantic import BaseModel, Field, field_validator
import re


class OltBrand(str, Enum):
    HUAWEI = 'huawei'
    ZTE    = 'zte'
    VSOL   = 'vsol'
    CDATA  = 'cdata'


class OltConnectionSchema(BaseModel):
    ip:       str = Field(..., description='IP de gestión de la OLT (dentro de la VPN)')
    port:     int = Field(22, ge=1, le=65535, description='Puerto SSH')
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=200)
    brand:    OltBrand

    @field_validator('ip')
    @classmethod
    def validate_ip(cls, v: str) -> str:
        import ipaddress
        try:
            ipaddress.ip_address(v)
        except ValueError as exc:
            raise ValueError(f'IP inválida: {v}') from exc
        return v


class TestConnectionRequest(BaseModel):
    connection: OltConnectionSchema


class TestConnectionResponse(BaseModel):
    success:    bool
    latency_ms: int | None = None
    error:      str | None = None


class OnuProvisionSchema(BaseModel):
    frame:         int = Field(..., ge=0, le=7,   description='Frame del chasis (0-7)')
    slot:          int = Field(..., ge=0, le=15,  description='Slot de la tarjeta de línea')
    port:          int = Field(..., ge=0, le=15,  description='Puerto PON en la tarjeta')
    onu_id:        int = Field(..., ge=1, le=128, description='ID de ONU en el puerto PON')
    sn:            str = Field(..., description='Serial number de la ONU (hex, 16 chars)')
    vlan:          int = Field(..., ge=1, le=4094, description='VLAN de servicio del cliente')
    vlan_gestion:  int = Field(..., ge=1, le=4094, description='VLAN de gestión de la OLT')
    profile_speed: str = Field(..., min_length=1, max_length=100,
                               description='Nombre del perfil de velocidad en la OLT')

    # Huawei-específicos (requeridos por provision.j2)
    service_port_id: int | None = Field(
        None, ge=1,
        description='ID del service-port en la OLT Huawei. Debe ser único por equipo.',
    )
    traffic_index: int | None = Field(
        None, ge=0,
        description='Índice del traffic-table configurado en la OLT Huawei (inbound y outbound).',
    )

    # ZTE-específicos (requeridos por provision.j2)
    onu_type: str | None = Field(
        None, min_length=1, max_length=50,
        description='Tipo/modelo de ONU ZTE (ej: ZTE-F660, F601E, ZTE-F680). Requerido para OLTs ZTE.',
    )

    # Huawei MA5800 — modo perfil (ont-lineprofile + ont-srvprofile)
    lineprofile_id: int | None = Field(
        None, ge=1,
        description='ID del ont-lineprofile en la OLT Huawei MA5800 (modo perfil). '
                    'Si se define junto con srvprofile_id, se usa modo perfil en vez de traffic-table directo.',
    )
    srvprofile_id: int | None = Field(
        None, ge=1,
        description='ID del ont-srvprofile en la OLT Huawei MA5800 (modo perfil).',
    )
    description: str | None = Field(
        None, max_length=64,
        description='Descripción libre de la ONU (se pasa al comando ont add como desc).',
    )
    onu_mode: str | None = Field(
        None,
        description='"bridge" (PPPoE externo, sin ont ipconfig) o "routing" (IPoE/DHCP en la ONU). '
                    'Si no se especifica, el template usa bridge por defecto.',
    )

    @field_validator('description')
    @classmethod
    def sanitize_description(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if re.search(r'[\n\r\"\';\\]', v):
            raise ValueError('description contiene caracteres no permitidos (\\n \\r " \' ; \\)')
        return v

    @field_validator('onu_mode')
    @classmethod
    def validate_onu_mode(cls, v: str | None) -> str | None:
        if v is not None and v not in ('bridge', 'routing'):
            raise ValueError('onu_mode debe ser "bridge" o "routing"')
        return v

    @field_validator('sn')
    @classmethod
    def validate_serial(cls, v: str) -> str:
        # Huawei: HWTC + 8 hex chars — ZTE/VSOL/CDATA: 16 hex chars
        v = v.upper().strip()
        if not re.match(r'^[0-9A-F]{16}$', v):
            raise ValueError(
                f'Serial number inválido: "{v}". Debe ser 16 caracteres hexadecimales.'
            )
        return v


class ProvisionRequest(BaseModel):
    """Cuerpo completo del endpoint POST /api/v1/olt/provision."""
    connection: OltConnectionSchema
    onu:        OnuProvisionSchema


class ProvisionResponse(BaseModel):
    success:    bool
    message:    str
    olt_ip:     str
    onu_sn:     str
    details:    dict | None = None


class AlarmInfo(BaseModel):
    level:   str    # 'warning' | 'critical' | 'error'
    message: str


class MetricsResponse(BaseModel):
    success:       bool
    rx_power_dbm:  float | None = None   # potencia que RECIBE la ONU (downstream)
    tx_power_dbm:  float | None = None   # potencia que EMITE la ONU (upstream)
    # Potencia que la OLT recibe de esta ONU (upstream, medida en el puerto GPON de la OLT).
    olt_rx_power_dbm: float | None = None
    temperature_c: int | None   = None
    alarm:         AlarmInfo | None = None
    raw:           str | None   = None
    error:         str | None   = None


class DiscoverRequest(BaseModel):
    """Cuerpo del endpoint POST /api/v1/olt/discover-onus."""
    connection: OltConnectionSchema
    slot:       int | None = Field(None, ge=0, le=15, description='Filtrar por slot (0-15). None = todos.')
    port:       int | None = Field(None, ge=0, le=15, description='Filtrar por puerto PON (0-15). None = todos.')


# ─── Batch status (cron de monitoreo) ────────────────────────

class OnuQueryInfo(BaseModel):
    """Identificación de una ONU para consulta masiva."""
    slot:   int  = Field(..., ge=0, le=15)
    port:   int  = Field(..., ge=0, le=15)
    onu_id: int  = Field(..., ge=1, le=128)
    sn:     str | None = None


class BatchStatusRequest(BaseModel):
    """Cuerpo del endpoint POST /api/v1/olt/batch-status."""
    connection: OltConnectionSchema
    onus:       list[OnuQueryInfo] = Field(..., min_length=1)


class OnuStatusInfo(BaseModel):
    """Estado y métricas de una ONU — resultado del batch-status."""
    slot:          int
    port:          int
    onu_id:        int
    sn:            str | None = None
    run_state:     str        # 'online' | 'offline' | 'unknown' | 'los' | etc.
    rx_power_dbm:  float | None = None
    tx_power_dbm:  float | None = None
    temperature_c: float | None = None


class BatchStatusResponse(BaseModel):
    success: bool
    total:   int
    onus:    list[OnuStatusInfo]
    error:   str | None = None


class OntFoundInfo(BaseModel):
    sn:        str
    slot:      int
    port:      int
    ont_model: str | None = None


class DiscoverResponse(BaseModel):
    success: bool
    total:   int
    onus:    list[OntFoundInfo]
    error:   str | None = None


# ─── Firmware Upgrade (OMCI) ─────────────────────────────────────

class FirmwareUpgradeRequest(BaseModel):
    """Cuerpo del endpoint POST /api/v1/olt/firmware-upgrade."""
    connection:        OltConnectionSchema
    slot:              int  = Field(..., ge=0, le=15)
    port:              int  = Field(..., ge=0, le=15)
    onu_ids:           list[int] = Field(..., min_length=1)
    firmware_file:     str  = Field(..., min_length=1,
                                    description='Ruta absoluta del .bin en disco del VPS')
    firmware_filename: str  = Field(..., min_length=1,
                                    description='Nombre del archivo para comandos CLI')


class FirmwareJobProgress(BaseModel):
    onu_id:  int
    status:  str            # 'pending' | 'transferring' | 'success' | 'failed'
    message: str | None = None


class FirmwareJobStatus(BaseModel):
    job_id:     str
    olt_ip:     str
    status:     str         # 'upgrading' | 'success' | 'failed' | 'partial'
    message:    str
    progress:   list[FirmwareJobProgress]
    started_at: str
    updated_at: str


# ─── Deprovision ONU ─────────────────────────────────────────

class OnuDeprovisionSchema(BaseModel):
    """Identificación de la ONU a desaprovisionar en la OLT."""
    slot:            int = Field(..., ge=0, le=15,  description='Slot de la tarjeta de línea')
    port:            int = Field(..., ge=0, le=15,  description='Puerto PON en la tarjeta')
    onu_id:          int = Field(..., ge=1, le=128, description='ID de ONU en el puerto PON')
    service_port_id: int | None = Field(
        None, ge=1,
        description='ID del service-port Huawei a eliminar. Requerido para OLTs Huawei.',
    )
    # ZTE requiere rack para el path de interfaz (habitualmente 0)
    rack: int = Field(0, ge=0, le=7, description='Rack del chasis ZTE (normalmente 0)')


class DeprovisionRequest(BaseModel):
    """Cuerpo del endpoint POST /api/v1/olt/deprovision."""
    connection: OltConnectionSchema
    onu:        OnuDeprovisionSchema


class DeprovisionResponse(BaseModel):
    success:  bool
    message:  str
    olt_ip:   str
    onu_id:   int
    details:  dict | None = None


# ─── Verify ONU ──────────────────────────────────────────────

class VerifyOnuRequest(BaseModel):
    """Cuerpo del endpoint POST /api/v1/olt/verify-onu."""
    connection: OltConnectionSchema
    slot:       int = Field(..., ge=0, le=15)
    port:       int = Field(..., ge=0, le=15)
    onu_id:     int = Field(..., ge=1, le=128)


class VerifyOnuResponse(BaseModel):
    success:       bool
    run_state:     str | None = None   # 'online' | 'offline' | 'los' | 'unknown'
    rx_power_dbm:  float | None = None
    tx_power_dbm:  float | None = None
    temperature_c: float | None = None
    error:         str | None = None


# ─── Perfiles MA5800 ──────────────────────────────────────────

class OltProfileInfo(BaseModel):
    profile_id: int
    name:       str


class OltTrafficTableInfo(BaseModel):
    index:     int
    name:      str
    cir_kbps:  int | None = None
    pir_kbps:  int | None = None
    cbs_bytes: int | None = None
    pbs_bytes: int | None = None


class ListProfilesRequest(BaseModel):
    connection: OltConnectionSchema


class ListProfilesResponse(BaseModel):
    success:        bool
    lineprofiles:   list[OltProfileInfo]      = []
    srvprofiles:    list[OltProfileInfo]      = []
    traffic_tables: list[OltTrafficTableInfo] = []
    error:          str | None = None


# ─── ONT Reset ───────────────────────────────────────────────

class OntResetRequest(BaseModel):
    connection: OltConnectionSchema
    slot:       int = Field(..., ge=0, le=15)
    port:       int = Field(..., ge=0, le=15)
    onu_id:     int = Field(..., ge=1, le=128)


class OntResetResponse(BaseModel):
    success: bool
    message: str
    error:   str | None = None


# ─── Board Topology ──────────────────────────────────────────

class BoardSlotInfo(BaseModel):
    slot_id:       int
    board_name:    str
    status:        str
    online_onus:   int
    offline_onus:  int
    ports_per_slot: int | None = None


class BoardTopologyRequest(BaseModel):
    connection: OltConnectionSchema


class BoardTopologyResponse(BaseModel):
    success: bool
    slots:   list[BoardSlotInfo] = []
    error:   str | None = None


# ─── ONT Version ─────────────────────────────────────────────

class OntVersionRequest(BaseModel):
    connection: OltConnectionSchema
    slot:       int = Field(..., ge=0, le=15)
    port:       int = Field(..., ge=0, le=15)
    onu_id:     int = Field(..., ge=1, le=128)


class OntVersionResponse(BaseModel):
    success:          bool
    ont_version:      str | None = None
    software_version: str | None = None
    equipment_id:     str | None = None
    error:            str | None = None


# ─── FTTH Two-Phase Provisioning ─────────────────────────────

class FtthGponRequest(BaseModel):
    """Fase 1 del aprovisionamiento FTTH: registrar ONU en la OLT (GPON)."""
    connection:         OltConnectionSchema
    frame:              int = Field(0, ge=0, le=7)
    slot:               int = Field(..., ge=0, le=15)
    port:               int = Field(..., ge=0, le=15)
    onu_id:             int = Field(..., ge=1, le=128)
    sn:                 str = Field(..., min_length=12, max_length=16)
    service_port_id:    int = Field(..., ge=1)
    vlan:               int = Field(..., ge=1, le=4094)
    lineprofile_id:     int = Field(..., ge=0)  # 0 = perfil por defecto (line-profile_default_0)
    srvprofile_id:      int = Field(..., ge=0)  # 0 = perfil por defecto (srv-profile_default_0)
    traffic_index_down: int | None = Field(None, ge=0, description='Traffic-table outbound (bajada). None = índice 0 (sin límite).')
    traffic_index_up:   int | None = Field(None, ge=0, description='Traffic-table inbound (subida). None = índice 0 (sin límite).')
    description:        str | None = Field(None, max_length=64)

    @field_validator('description')
    @classmethod
    def sanitize_description(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if re.search(r'[\n\r\"\';\\]', v):
            raise ValueError('description contiene caracteres no permitidos (\\n \\r " \' ; \\)')
        return v


class FtthGponResponse(BaseModel):
    success: bool
    sn:      str | None = None
    olt_ip:  str | None = None
    error:   str | None = None


class FtthRollbackRequest(BaseModel):
    """Deshacer el registro GPON de una ONU en la OLT."""
    connection:           OltConnectionSchema
    slot:                 int = Field(..., ge=0, le=15)
    port:                 int = Field(..., ge=0, le=15)
    onu_id:               int = Field(..., ge=1, le=128)
    service_port_id:      int | None = Field(None, ge=1)
    # Service-port del carril de gestión TR-069 (GEM 2), si la ONU lo tiene. Sin
    # deshacerlo también, `ont delete` falla con "has some service virtual ports"
    # (incidente 2026-07-17, CNT-2026-000004 — el rollback solo conocía el de datos).
    mgmt_service_port_id: int | None = Field(None, ge=1)


class FtthRollbackResponse(BaseModel):
    success: bool
    error:   str | None = None


class FtthBootstrapRequest(BaseModel):
    """Carril de bootstrap TR-069: mgmt IP-host + service-port GEM3 + FEC.

    `modo` selecciona la estrategia de entrega de la ACS URL (canal del resolver):
      - 'dhcp'   → IP-host DHCP; URL por DHCP Option 43 (canal dhcp_bootstrap).
        VALIDADO 2026-07-19 en EG8145V5/V5R020C10S195.
      - 'static' → IP-host estático + ME137 (canal omci_management_server). En este
        firmware NO materializa (CNT-2026-000004); se mantiene para otras variantes.
    En modo 'dhcp', mgmt_ip/mask/gateway se ignoran (la IP la da el DHCP)."""
    connection:           OltConnectionSchema
    slot:                 int = Field(..., ge=0, le=15)
    port:                 int = Field(..., ge=0, le=15)
    onu_id:               int = Field(..., ge=1, le=128)
    mgmt_vlan:            int = Field(..., ge=1, le=4094)
    mgmt_service_port_id: int = Field(..., ge=1)
    mgmt_ip:              str = Field(..., description='IP estática del pool de gestión del ERP.')
    mgmt_mask:            str = Field(..., description='Máscara de la VLAN de gestión, ej. 255.255.255.0.')
    mgmt_gateway:         str = Field(..., description='Gateway de la VLAN de gestión.')
    acs_url:              str = Field(..., description='URL CWMP del ACS (GenieACS), ej. http://10.8.1.1:7547')
    mgmt_dns:             str = Field('8.8.8.8', description='DNS primario del IP-host de gestión.')
    traffic_index:        int = Field(0, ge=0, description='Traffic-table del service-port de gestión. 0 = sin límite.')
    priority:             int = Field(2, ge=0, le=7, description='PCP del IP host de gestión (Huawei suele esperar 2).')
    modo:                 str = Field('dhcp', description="Estrategia de entrega ACS URL: 'dhcp' (Option 43) | 'static' (ME137).")


class FtthBootstrapResponse(BaseModel):
    success: bool
    olt_ip:  str | None = None
    error:   str | None = None


class FtthTeardownRequest(BaseModel):
    """Quitar SOLO el carril de gestión TR-069 (ip-index 0 + tr069-server-config +
    service-port de gestión), preservando el plano de datos y los datos ACS del CPE."""
    connection:           OltConnectionSchema
    slot:                 int = Field(..., ge=0, le=15)
    port:                 int = Field(..., ge=0, le=15)
    onu_id:               int = Field(..., ge=1, le=128)
    mgmt_service_port_id: int | None = Field(None, ge=1)


class FtthTeardownResponse(BaseModel):
    success: bool
    olt_ip:  str | None = None
    error:   str | None = None


class FtthOntIdsRequest(BaseModel):
    """Listar los ONT-IDs ya configurados en un puerto PON (incl. los de SmartOLT)."""
    connection: OltConnectionSchema
    slot:       int = Field(..., ge=0, le=15)
    port:       int = Field(..., ge=0, le=15)


class FtthOntIdsResponse(BaseModel):
    ont_ids: list[int] = []


class FtthPollRequest(BaseModel):
    """Fase 1b: esperar que la ONU aparezca online tras el registro GPON."""
    connection: OltConnectionSchema
    slot:       int = Field(..., ge=0, le=15)
    port:       int = Field(..., ge=0, le=15)
    onu_id:     int = Field(..., ge=1, le=128)
    max_wait:   int = Field(90, ge=10, le=180)


class FtthPollResponse(BaseModel):
    success:   bool
    run_state: str | None = None
    timeout:   bool = False
    error:     str | None = None


class UndoServicePortRequest(BaseModel):
    """Elimina un service-port puntual (mantenimiento — no toca el ONT)."""
    connection:      OltConnectionSchema
    service_port_id: int = Field(..., ge=1)


class UndoServicePortResponse(BaseModel):
    success: bool


class FtthCheckMgmtIpRequest(BaseModel):
    """Verifica si el IP-host de gestión (ip-index 0) materializó una IP real."""
    connection: OltConnectionSchema
    slot:       int = Field(..., ge=0, le=15)
    port:       int = Field(..., ge=0, le=15)
    onu_id:     int = Field(..., ge=1, le=128)


class FtthCheckMgmtIpResponse(BaseModel):
    has_ip: bool
    ip:     str | None = None
    error:  str | None = None


class FtthCheckWanRequest(BaseModel):
    """Verifica si la WAN PPPoE de una ONU activa sigue viva (watcher post factory-reset)."""
    connection:        OltConnectionSchema
    slot:               int = Field(..., ge=0, le=15)
    port:               int = Field(..., ge=0, le=15)
    onu_id:             int = Field(..., ge=1, le=128)
    expected_username:  str = Field(..., min_length=1, max_length=64)


class FtthCheckWanResponse(BaseModel):
    ok:        bool
    connected: bool
    username:  str | None = None
    error:     str | None = None


class FtthWanPppoeRequest(BaseModel):
    """Fase 2: inyectar la WAN en la ONU vía OMCI. Soporta pppoe/static/dhcp."""
    connection: OltConnectionSchema
    slot:       int = Field(..., ge=0, le=15)
    port:       int = Field(..., ge=0, le=15)
    onu_id:     int = Field(..., ge=1, le=128)
    vlan:       int = Field(..., ge=1, le=4094)
    mode:       str = Field('pppoe', description='pppoe | static | dhcp')
    username:   'str | None' = Field(None, max_length=64)
    password:   'str | None' = Field(None, max_length=128)
    ip_address: 'str | None' = Field(None, max_length=45)
    mask:       'str | None' = Field(None, max_length=45)
    gateway:    'str | None' = Field(None, max_length=45)
    pri_dns:    'str | None' = Field(None, max_length=45)


class FtthWanResponse(BaseModel):
    success: bool
    olt_ip:  str | None = None
    onu_id:  int | None = None
    error:   str | None = None


# ─── Cambio de velocidad en caliente ─────────────────────────

class ChangeLineprofileRequest(BaseModel):
    """Cambia el traffic-table del service-port para modificar velocidad sin re-aprovisionar."""
    connection:         OltConnectionSchema
    slot:               int = Field(..., ge=0, le=15)
    port:               int = Field(..., ge=0, le=15)
    onu_id:             int = Field(..., ge=1, le=128)
    service_port_id:    int = Field(..., ge=1)
    traffic_index_down: int = Field(..., ge=0,
                                    description='Traffic-table outbound (downstream).')
    traffic_index_up:   int = Field(..., ge=0,
                                    description='Traffic-table inbound (upstream).')


class ChangeLineprofileResponse(BaseModel):
    success:            bool
    message:            str
    traffic_index_down: int | None = None
    traffic_index_up:   int | None = None
    error:              str | None = None


# ─── Suspensión / Rehabilitación por service-port ─────────────

class OntSuspendRequest(BaseModel):
    """Desactiva (suspende) una ONU bloqueando su service-port."""
    connection:      OltConnectionSchema
    slot:            int = Field(..., ge=0, le=15)
    port:            int = Field(..., ge=0, le=15)
    onu_id:          int = Field(..., ge=1, le=128)
    service_port_id: int = Field(..., ge=1,
                                 description='ID del service-port a desactivar en la OLT Huawei.')


class OntRehabilitateRequest(BaseModel):
    """Reactiva una ONU previamente suspendida (rehabilita su service-port)."""
    connection:      OltConnectionSchema
    slot:            int = Field(..., ge=0, le=15)
    port:            int = Field(..., ge=0, le=15)
    onu_id:          int = Field(..., ge=1, le=128)
    service_port_id: int = Field(..., ge=1,
                                 description='ID del service-port a reactivar en la OLT Huawei.')


class OntSuspendResponse(BaseModel):
    success: bool
    message: str
    error:   str | None = None


# ─── Wizard: Topología completa ───────────────────────────────

class WizardVlanInfo(BaseModel):
    vlan_id: int
    name:    str
    # Compatibilidad de adopción (9c): tipo real y uso real de la VLAN.
    vlan_type:  str | None = None   # smart | mux | standard | super
    attribute:  str | None = None
    serv_ports: int | None = None   # service-ports activos en la OLT


class WizardBoardInfo(BaseModel):
    slot:         int
    board_type:   str
    state:        str
    onu_count:    int
    onu_capacity: int
    online_onus:  int = 0
    offline_onus: int = 0


# ─── Health snapshot ────────────────────────────────────────────

class HealthBoardInfo(BaseModel):
    slot:         int
    board_type:   str
    state:        str
    onu_count:    int
    onu_capacity: int
    online_onus:  int = 0
    offline_onus: int = 0

class HealthPomInfo(BaseModel):
    slot:             int
    port:             int
    temp_celsius:     float | None = None
    tx_dbm:           float | None = None
    rx_dbm:           float | None = None
    voltage_mv:       float | None = None
    laser_ma:         float | None = None
    state:            str   | None = None

class HealthSnapshotRequest(BaseModel):
    connection:  OltConnectionSchema
    include_pom: bool = True

class HealthSnapshotResponse(BaseModel):
    success: bool
    boards:  list[HealthBoardInfo] = []
    pom:     list[HealthPomInfo]   = []
    error:   str | None = None


# ─── PON Port status ────────────────────────────────────────────

class PonPortInfoSchema(BaseModel):
    slot:         int
    port:         int
    port_type:    str = 'GPON'
    admin_state:  str
    oper_state:   str
    autofind:     str = 'autofind'
    onus_total:   int = 0
    onus_online:  int = 0
    onus_offline: int = 0
    max_capacity: int = 128

class PonPortsRequest(BaseModel):
    connection: OltConnectionSchema
    slot:       int

class PonPortsResponse(BaseModel):
    success: bool
    slot:    int
    ports:   list[PonPortInfoSchema] = []
    error:   str | None = None


# ─── VLAN CLI Operations ────────────────────────────────────────

class VlanAddRequest(BaseModel):
    connection: OltConnectionSchema
    vlan_id:    int = Field(..., ge=1, le=4094)
    name:       str = Field(..., min_length=1, max_length=64)


class VlanAddResponse(BaseModel):
    success: bool
    vlan_id: int | None = None
    error:   str | None = None


class VlanDeleteRequest(BaseModel):
    connection: OltConnectionSchema
    vlan_id:    int = Field(..., ge=1, le=4094)


class VlanDeleteResponse(BaseModel):
    success: bool
    error:   str | None = None


class VersionInfoRequest(BaseModel):
    """Lee modelo (PRODUCT), firmware (VERSION) y patch reales de la OLT."""
    connection: OltConnectionSchema


class VersionInfoResponse(BaseModel):
    success:  bool
    model:    str | None = None
    firmware: str | None = None
    patch:    str | None = None
    error:    str | None = None


class SrvProfileAddRequest(BaseModel):
    """Crea un ONT service-profile ('tipo de ONU') en la OLT."""
    connection: OltConnectionSchema
    name: str = Field(..., min_length=1, max_length=32)
    eth:  int = Field(..., ge=1, le=24)
    pots: int = Field(default=0, ge=0, le=8)
    catv: int = Field(default=0, ge=0, le=4)


class SrvProfileAddResponse(BaseModel):
    success:    bool
    profile_id: int | None = None
    name:       str | None = None
    error:      str | None = None


class SrvProfileDeleteRequest(BaseModel):
    connection: OltConnectionSchema
    name: str = Field(..., min_length=1, max_length=32)


class SrvProfileDeleteResponse(BaseModel):
    success: bool
    error:   str | None = None


class LineProfileAddRequest(BaseModel):
    """Crea un ONT line-profile GPON canónico (mapping-mode priority + TR-069) con DBA propio."""
    connection:   OltConnectionSchema
    name:         str = Field(..., min_length=1, max_length=32)
    dba_name:     str = Field(..., min_length=1, max_length=32)
    dba_max_kbps: int = Field(..., ge=128, le=10_000_000)


class LineProfileAddResponse(BaseModel):
    success:        bool
    profile_id:     int | None = None
    name:           str | None = None
    dba_profile_id: int | None = None
    dba_name:       str | None = None
    error:          str | None = None


class LineProfileDeleteRequest(BaseModel):
    connection: OltConnectionSchema
    name:       str = Field(..., min_length=1, max_length=32)
    dba_name:   str | None = Field(default=None, min_length=1, max_length=32)


class LineProfileDeleteResponse(BaseModel):
    success:       bool
    dba_eliminado: bool | None = None
    error:         str | None = None


class LineProfileAddGemMgmtRequest(BaseModel):
    """Agrega GEM index 2 (tcont 0) a un line-profile existente para habilitar
    el carril de gestión TR-069 (fix estructural, ver add_gem_mgmt_to_lineprofile)."""
    connection: OltConnectionSchema
    profile_id: int = Field(..., ge=1)


class LineProfileAddGemMgmtResponse(BaseModel):
    success:    bool
    profile_id: int | None = None
    error:      str | None = None


class LineProfileAddGemPriorityRequest(BaseModel):
    """Agrega mapeo prioridad→GEM (802.1p Mapper) a un line-profile existente."""
    connection: OltConnectionSchema
    profile_id: int = Field(..., ge=1)
    gem_index:  int = Field(..., ge=1, le=15)
    priority:   int = Field(..., ge=0, le=7)


class LineProfileAddGemPriorityResponse(BaseModel):
    success:    bool
    profile_id: int | None = None
    error:      str | None = None


class LineProfileRemoveGemPriorityRequest(BaseModel):
    """Elimina mapeo prioridad->GEM (802.1p Mapper) de un line-profile existente."""
    connection:    OltConnectionSchema
    profile_id:    int = Field(..., ge=1)
    gem_index:     int = Field(..., ge=1, le=15)
    mapping_index: int = Field(..., ge=0, le=7)


class LineProfileRemoveGemPriorityResponse(BaseModel):
    success:    bool
    profile_id: int | None = None
    error:      str | None = None


class LineProfileRemoveGemRequest(BaseModel):
    """Elimina un GEM huérfano de un line-profile (diagnóstico/limpieza)."""
    connection: OltConnectionSchema
    profile_id: int = Field(..., ge=1)
    gem_index:  int = Field(..., ge=1, le=15)


class LineProfileRemoveGemResponse(BaseModel):
    success: bool
    intentos: list[dict] = []
    error:   str | None = None


class UplinkVlansRequest(BaseModel):
    """Lee las VLANs taggeadas en un puerto uplink (frame/slot/port)."""
    connection: OltConnectionSchema
    port_path:  str = Field(..., pattern=r'^\d+/\d+/\d+$')  # ej. '0/9/0'


class UplinkVlansResponse(BaseModel):
    success:  bool
    vlan_ids: list[int] = []
    error:    str | None = None


class UplinkTagRequest(BaseModel):
    """Taguea una VLAN en un puerto uplink. SOLO aditivo — el undo emite
    'Warning: may cause interruptions of many user services' y nunca se
    automatiza (validado manualmente contra MA5800-X7, 2026-07-14)."""
    connection: OltConnectionSchema
    vlan_id:    int = Field(..., ge=1, le=4094)
    port_path:  str = Field(..., pattern=r'^\d+/\d+/\d+$')  # ej. '0/9/0'


class UplinkTagResponse(BaseModel):
    success:  bool
    vlan_ids: list[int] = []   # estado real del puerto DESPUÉS del tag (releído)
    error:    str | None = None


# ─── Traffic Table CLI Operations ──────────────────────────────

class TrafficTableAddRequest(BaseModel):
    connection: OltConnectionSchema
    name:       str = Field(..., min_length=1, max_length=64)
    cir_kbps:   int = Field(..., ge=64, le=10_000_000)
    pir_kbps:   int = Field(..., ge=64, le=10_000_000)
    # Ráfagas en bytes (unidad nativa Huawei). Opcionales: si None, se omiten
    # del comando y la OLT usa sus defaults.
    cbs_bytes:  int | None = Field(default=None, ge=0)
    pbs_bytes:  int | None = Field(default=None, ge=0)


class TrafficTableAddResponse(BaseModel):
    success: bool
    index:   int | None = None
    name:    str | None = None
    error:   str | None = None


class TrafficTableDeleteRequest(BaseModel):
    connection: OltConnectionSchema
    index:      int = Field(..., ge=0)


class TrafficTableDeleteResponse(BaseModel):
    success: bool
    error:   str | None = None


class TrafficTableEditRequest(BaseModel):
    connection: OltConnectionSchema
    index:      int = Field(..., ge=0)
    name:       str = Field(..., min_length=1, max_length=64)
    cir_kbps:   int = Field(..., ge=64, le=10_000_000)
    pir_kbps:   int = Field(..., ge=64, le=10_000_000)
    cbs_bytes:  int | None = Field(default=None, ge=0)
    pbs_bytes:  int | None = Field(default=None, ge=0)


class TrafficTableEditResponse(BaseModel):
    success:   bool
    new_index: int | None = None
    error:     str | None = None


class WizardTopologyRequest(BaseModel):
    connection: OltConnectionSchema


class WizardTopologyResponse(BaseModel):
    success:          bool
    model:            str | None = None
    firmware_version: str | None = None
    boards:           list[WizardBoardInfo]       = []
    vlans:            list[WizardVlanInfo]         = []
    traffic_tables:   list[OltTrafficTableInfo]   = []
    line_profiles:    list[OltProfileInfo]         = []
    service_profiles: list[OltProfileInfo]         = []
    error:            str | None = None


# ── Config real SNMP/NTP (lectura, sin escritura) ─────────────

class SnmpCommunityInfo(BaseModel):
    name:   str
    access: str   # 'read' | 'write'


class NtpServerInfo(BaseModel):
    source:  str
    stratum: int | None = None
    reach:   int          # 0 = nunca sincronizó (RFC 5905)
    status:  str


class SnmpNtpConfigRequest(BaseModel):
    connection: OltConnectionSchema


class SnmpNtpConfigResponse(BaseModel):
    success:          bool
    snmp_communities: list[SnmpCommunityInfo] = []
    snmp_versions:    list[str]                = []
    ntp_servers:      list[NtpServerInfo]      = []
    error:            str | None = None


class ApplyNtpServersRequest(BaseModel):
    connection: OltConnectionSchema
    servers:    list[str]


class ApplyNtpServersResponse(BaseModel):
    success:     bool
    ntp_servers: list[NtpServerInfo] = []
    error:       str | None = None


class ServicePortInfoSchema(BaseModel):
    index:   int
    vlan_id: int
    state:   str


class ServicePortsRequest(BaseModel):
    connection: OltConnectionSchema


class ServicePortsResponse(BaseModel):
    success: bool
    ports:   list[ServicePortInfoSchema] = []
    error:   str | None = None


# ── Clasificación de estados de ONUs por puerto ───────────────

class ClassifyOnusRequest(BaseModel):
    connection: OltConnectionSchema
    slot:       int = Field(..., ge=0, le=16)
    port:       int = Field(..., ge=0, le=63)


class ClassifiedOnu(BaseModel):
    onu_id:           int
    sn:               str | None = None
    run_state:        str | None = None
    control_flag:     str | None = None
    config_state:     str | None = None
    estado_operativo: str              # online|apagada|ruptura_fibra|desactivada|offline
    down_cause:       str | None = None
    dying_gasp_time:  str | None = None
    rx_power_dbm:     float | None = None
    tx_power_dbm:     float | None = None


class AutofindOnu(BaseModel):
    slot:   int | None = None
    port:   int | None = None
    sn:     str | None = None
    model:  str | None = None


class ClassifyOnusResponse(BaseModel):
    success:  bool
    slot:     int
    port:     int
    onus:     list[ClassifiedOnu] = []
    autofind: list[AutofindOnu]   = []
    error:    str | None = None
