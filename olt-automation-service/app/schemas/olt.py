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
    rx_power_dbm:  float | None = None
    tx_power_dbm:  float | None = None
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
    slot_id:      int
    board_name:   str
    status:       str
    online_onus:  int
    offline_onus: int


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
