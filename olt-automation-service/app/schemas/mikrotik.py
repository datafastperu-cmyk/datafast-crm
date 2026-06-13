from pydantic import BaseModel, Field


class MikrotikConn(BaseModel):
    """Credenciales de conexión RouterOS API — base para todos los requests MikroTik."""
    host:     str = Field(..., examples=['192.168.88.1'])
    port:     int = Field(8728, ge=1, le=65535)
    username: str = Field(..., examples=['admin'])
    password: str = Field(..., examples=['secret'])


class PppoeProvisionarRequest(MikrotikConn):
    pppoe_user:     str = Field(..., examples=['cliente01'])
    pppoe_pass:     str = Field(..., examples=['pass123'])
    profile:        str = Field(..., examples=['10Mbps'])
    remote_address: str = Field('',  examples=['192.168.200.10'])


class PppoeProvisionarResponse(BaseModel):
    ok: bool
    id: str  # corresponde a .id de RouterOS (ej: "*1A")


class PppoeConnRequest(MikrotikConn):
    """Body para DELETE — solo credenciales."""
    pass


class PppoeEnableRequest(MikrotikConn):
    enabled: bool


class PppoeOkResponse(BaseModel):
    ok: bool


# ── Queue ─────────────────────────────────────────────────────────────────────

class QueueCreateRequest(MikrotikConn):
    name:           str = Field(..., examples=['cliente01'])
    target:         str = Field(..., examples=['192.168.100.1/32'])
    max_limit_down: str = Field(..., examples=['10M'])
    max_limit_up:   str = Field(..., examples=['5M'])


class QueueCreateResponse(BaseModel):
    ok: bool
    id: str  # .id RouterOS


# ── Firewall address-list ──────────────────────────────────────────────────────

class FirewallReglaRequest(MikrotikConn):
    list_name: str = Field(..., examples=['bloqueados'])
    address:   str = Field(..., examples=['192.168.100.50'])
    comment:   str = Field('',  examples=['Cliente moroso'])


class FirewallReglaDeleteRequest(MikrotikConn):
    list_name: str = Field(..., examples=['bloqueados'])
    address:   str = Field(..., examples=['192.168.100.50'])


# ── ARP ───────────────────────────────────────────────────────────────────────

class ArpEntry(BaseModel):
    ip:        str
    mac:       str
    interface: str
    status:    str  # dynamic | static | incomplete | invalid
