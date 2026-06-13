from pydantic import BaseModel, Field


class PingBatchRequest(BaseModel):
    hosts:   list[str] = Field(..., min_length=1, max_length=100, examples=[['192.168.1.1', '10.0.0.1']])
    count:   int       = Field(3, ge=1, le=10)
    timeout: int       = Field(2, ge=1, le=10)


class PingResult(BaseModel):
    host:       str
    alive:      bool
    latency_ms: float | None  # None si el host no responde
    loss_pct:   float


class PingDetailResult(PingResult):
    packets_sent:     int
    packets_received: int


class PingBatchResponse(BaseModel):
    results: list[PingResult]


# ── SNMP Tráfico ──────────────────────────────────────────────────────────────

class TrafficHostRequest(BaseModel):
    ip:              str = Field(..., examples=['192.168.88.1'])
    community:       str = Field('public', examples=['public'])
    interface_index: int = Field(..., ge=1, examples=[1])


class TrafficBatchRequest(BaseModel):
    hosts: list[TrafficHostRequest] = Field(..., min_length=1, max_length=50)


class TrafficResult(BaseModel):
    ip:        str
    down_bps:  int | None  # None si falla el SNMP para este host
    up_bps:    int | None
    timestamp: str
    error:     str | None = None


class TrafficBatchResponse(BaseModel):
    results: list[TrafficResult]


# ── SNMP Recursos ─────────────────────────────────────────────────────────────

class SnmpResourcesRequest(BaseModel):
    ip:        str = Field(..., examples=['192.168.88.1'])
    community: str = Field('public', examples=['public'])


class SnmpResourcesResponse(BaseModel):
    ip:              str
    cpu_pct:         float
    ram_total_bytes: int
    ram_used_bytes:  int
    ram_pct:         float
