import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.schemas.mikrotik import (
    ArpEntry,
    FirewallReglaDeleteRequest,
    FirewallReglaRequest,
    PppoeConnRequest,
    PppoeEnableRequest,
    PppoeOkResponse,
    PppoeProvisionarRequest,
    PppoeProvisionarResponse,
    QueueCreateRequest,
    QueueCreateResponse,
)
from app.services import mikrotik_ops as ops
from app.services.mikrotik_pool import (
    MikrotikAuthError,
    MikrotikConnectionError,
    MikrotikNotFoundError,
    mikrotik_pool,
    test_routeros_connection,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/v1/mikrotik', tags=['mikrotik'])


class MikrotikConnRequest(BaseModel):
    host:     str = Field(..., examples=['192.168.88.1'])
    port:     int = Field(8728, ge=1, le=65535)
    username: str = Field(..., examples=['admin'])
    password: str = Field(..., examples=['secret'])


class MikrotikTestResponse(BaseModel):
    ok:      bool
    version: str


@router.post(
    '/test-conexion',
    response_model=MikrotikTestResponse,
    status_code=status.HTTP_200_OK,
    summary='Verificar conectividad y credenciales con un router MikroTik',
)
async def test_conexion(body: MikrotikConnRequest) -> MikrotikTestResponse:
    async with mikrotik_pool.acquire(body.host):
        try:
            version = await asyncio.to_thread(
                test_routeros_connection,
                body.host, body.port, body.username, body.password,
            )
        except MikrotikAuthError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(exc),
            ) from exc
        except MikrotikConnectionError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc

    return MikrotikTestResponse(ok=True, version=version)


def _http_from_mikrotik(exc: Exception) -> HTTPException:
    """Convierte excepciones MikroTik a HTTPException."""
    if isinstance(exc, MikrotikAuthError):
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))
    if isinstance(exc, MikrotikNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))


@router.post(
    '/pppoe/provisionar',
    response_model=PppoeProvisionarResponse,
    status_code=status.HTTP_201_CREATED,
    summary='Crear secret PPPoE en el router MikroTik',
)
async def pppoe_provisionar(body: PppoeProvisionarRequest) -> PppoeProvisionarResponse:
    async with mikrotik_pool.acquire(body.host):
        try:
            item_id = await asyncio.to_thread(
                ops.pppoe_provisionar,
                body.host, body.port, body.username, body.password,
                body.pppoe_user, body.pppoe_pass, body.profile, body.remote_address,
            )
        except (MikrotikAuthError, MikrotikConnectionError) as exc:
            raise _http_from_mikrotik(exc) from exc
    return PppoeProvisionarResponse(ok=True, id=item_id)


@router.delete(
    '/pppoe/{pppoe_user}',
    response_model=PppoeOkResponse,
    status_code=status.HTTP_200_OK,
    summary='Eliminar secret PPPoE del router MikroTik',
)
async def pppoe_eliminar(pppoe_user: str, body: PppoeConnRequest) -> PppoeOkResponse:
    async with mikrotik_pool.acquire(body.host):
        try:
            await asyncio.to_thread(
                ops.pppoe_eliminar,
                body.host, body.port, body.username, body.password, pppoe_user,
            )
        except (MikrotikAuthError, MikrotikNotFoundError, MikrotikConnectionError) as exc:
            raise _http_from_mikrotik(exc) from exc
    return PppoeOkResponse(ok=True)


@router.patch(
    '/pppoe/{pppoe_user}/enable',
    response_model=PppoeOkResponse,
    status_code=status.HTTP_200_OK,
    summary='Habilitar o deshabilitar un secret PPPoE',
)
async def pppoe_enable(pppoe_user: str, body: PppoeEnableRequest) -> PppoeOkResponse:
    async with mikrotik_pool.acquire(body.host):
        try:
            await asyncio.to_thread(
                ops.pppoe_set_enabled,
                body.host, body.port, body.username, body.password,
                pppoe_user, body.enabled,
            )
        except (MikrotikAuthError, MikrotikNotFoundError, MikrotikConnectionError) as exc:
            raise _http_from_mikrotik(exc) from exc
    return PppoeOkResponse(ok=True)


# ── Queue Simple ──────────────────────────────────────────────────────────────

@router.post(
    '/queue',
    response_model=QueueCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary='Crear Simple Queue con límite de velocidad',
)
async def queue_crear(body: QueueCreateRequest) -> QueueCreateResponse:
    async with mikrotik_pool.acquire(body.host):
        try:
            item_id = await asyncio.to_thread(
                ops.queue_crear,
                body.host, body.port, body.username, body.password,
                body.name, body.target, body.max_limit_down, body.max_limit_up,
            )
        except (MikrotikAuthError, MikrotikConnectionError) as exc:
            raise _http_from_mikrotik(exc) from exc
    return QueueCreateResponse(ok=True, id=item_id)


@router.delete(
    '/queue/{name}',
    response_model=PppoeOkResponse,
    status_code=status.HTTP_200_OK,
    summary='Eliminar Simple Queue por nombre',
)
async def queue_eliminar(name: str, body: PppoeConnRequest) -> PppoeOkResponse:
    async with mikrotik_pool.acquire(body.host):
        try:
            await asyncio.to_thread(
                ops.queue_eliminar,
                body.host, body.port, body.username, body.password, name,
            )
        except (MikrotikAuthError, MikrotikNotFoundError, MikrotikConnectionError) as exc:
            raise _http_from_mikrotik(exc) from exc
    return PppoeOkResponse(ok=True)


# ── Firewall address-list ─────────────────────────────────────────────────────

@router.post(
    '/firewall/regla',
    response_model=PppoeOkResponse,
    status_code=status.HTTP_201_CREATED,
    summary='Agregar dirección IP a un address-list de firewall',
)
async def firewall_agregar(body: FirewallReglaRequest) -> PppoeOkResponse:
    async with mikrotik_pool.acquire(body.host):
        try:
            await asyncio.to_thread(
                ops.firewall_agregar_address,
                body.host, body.port, body.username, body.password,
                body.list_name, body.address, body.comment,
            )
        except (MikrotikAuthError, MikrotikConnectionError) as exc:
            raise _http_from_mikrotik(exc) from exc
    return PppoeOkResponse(ok=True)


@router.delete(
    '/firewall/regla',
    response_model=PppoeOkResponse,
    status_code=status.HTTP_200_OK,
    summary='Eliminar dirección IP de un address-list de firewall',
)
async def firewall_eliminar(body: FirewallReglaDeleteRequest) -> PppoeOkResponse:
    async with mikrotik_pool.acquire(body.host):
        try:
            await asyncio.to_thread(
                ops.firewall_eliminar_address,
                body.host, body.port, body.username, body.password,
                body.list_name, body.address,
            )
        except (MikrotikAuthError, MikrotikNotFoundError, MikrotikConnectionError) as exc:
            raise _http_from_mikrotik(exc) from exc
    return PppoeOkResponse(ok=True)


# ── ARP lookup ────────────────────────────────────────────────────────────────

@router.get(
    '/arp/{ip}',
    response_model=ArpEntry,
    status_code=status.HTTP_200_OK,
    summary='Consultar tabla ARP del MikroTik para obtener MAC por IP',
)
async def arp_lookup(
    ip:       str,
    host:     str = Query(..., examples=['192.168.88.1']),
    port:     int = Query(8728),
    username: str = Query(..., examples=['admin']),
    password: str = Query(..., examples=['secret']),
) -> ArpEntry:
    async with mikrotik_pool.acquire(host):
        try:
            data = await asyncio.to_thread(
                ops.arp_lookup, host, port, username, password, ip,
            )
        except (MikrotikAuthError, MikrotikNotFoundError, MikrotikConnectionError) as exc:
            raise _http_from_mikrotik(exc) from exc
    return ArpEntry(**data)
