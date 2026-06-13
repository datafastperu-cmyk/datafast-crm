import logging

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.monitoring import (
    PingBatchRequest,
    PingBatchResponse,
    PingDetailResult,
    PingResult,
    SnmpResourcesRequest,
    SnmpResourcesResponse,
    TrafficBatchRequest,
    TrafficBatchResponse,
    TrafficResult,
)
from app.services import monitoring as mon_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/v1/monitoring', tags=['monitoring'])


@router.post(
    '/ping/batch',
    response_model=PingBatchResponse,
    status_code=status.HTTP_200_OK,
    summary='Ping masivo a múltiples IPs en paralelo (icmplib async_multiping)',
    description=(
        'Requiere cap_net_raw en el contenedor Docker (--cap-add=NET_RAW). '
        'Todos los hosts se pingan simultáneamente — el tiempo total es el del host más lento, no la suma.'
    ),
)
async def ping_batch(body: PingBatchRequest) -> PingBatchResponse:
    try:
        raw = await mon_svc.ping_batch(body.hosts, body.count, body.timeout)
    except Exception as exc:
        logger.error('ping_batch error: %s', exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Error en ping: {exc}',
        ) from exc
    return PingBatchResponse(results=[PingResult(**r) for r in raw])


@router.get(
    '/ping/{ip}',
    response_model=PingDetailResult,
    status_code=status.HTTP_200_OK,
    summary='Ping a un host individual con detalle de paquetes',
)
async def ping_single(
    ip:      str,
    count:   int = Query(3, ge=1, le=10),
    timeout: int = Query(2, ge=1, le=10),
) -> PingDetailResult:
    try:
        data = await mon_svc.ping_single(ip, count, timeout)
    except Exception as exc:
        logger.error('ping_single %s error: %s', ip, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f'Error en ping: {exc}',
        ) from exc
    return PingDetailResult(**data)


# ── SNMP ──────────────────────────────────────────────────────────────────────

@router.post(
    '/snmp/traffic/batch',
    response_model=TrafficBatchResponse,
    status_code=status.HTTP_200_OK,
    summary='Tráfico de múltiples interfaces via SNMP (dos lecturas con delta 1s)',
    description=(
        'Requiere libsnmp en el contenedor (apt-get install -y snmp libsnmp-dev). '
        'Todos los hosts se consultan en paralelo — el tiempo total es ~1s independiente '
        'del número de hosts.'
    ),
)
async def snmp_traffic_batch(body: TrafficBatchRequest) -> TrafficBatchResponse:
    hosts = [h.model_dump() for h in body.hosts]
    raw = await mon_svc.snmp_traffic_batch(hosts)
    return TrafficBatchResponse(results=[TrafficResult(**r) for r in raw])


@router.post(
    '/snmp/resources',
    response_model=SnmpResourcesResponse,
    status_code=status.HTTP_200_OK,
    summary='CPU y RAM del router via SNMP (hrProcessorLoad + hrStorage)',
)
async def snmp_resources(body: SnmpResourcesRequest) -> SnmpResourcesResponse:
    from app.services.monitoring import SnmpMonitoringError  # noqa: PLC0415
    try:
        data = await mon_svc.snmp_resources(body.ip, body.community)
    except SnmpMonitoringError as exc:
        logger.error('snmp_resources %s: %s', body.ip, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return SnmpResourcesResponse(**data)
