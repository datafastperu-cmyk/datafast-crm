import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers.mikrotik import router as mikrotik_router
from app.routers.monitoring import router as monitoring_router
from app.schemas.olt import (
    BatchStatusRequest,
    BatchStatusResponse,
    DeprovisionRequest,
    DeprovisionResponse,
    DiscoverRequest,
    DiscoverResponse,
    FirmwareJobProgress,
    FirmwareJobStatus,
    FirmwareUpgradeRequest,
    MetricsResponse,
    OnuStatusInfo,
    OntFoundInfo,
    ProvisionRequest,
    ProvisionResponse,
    VerifyOnuRequest,
    VerifyOnuResponse,
)
from app.services.connection_pool import connection_pool
from app.services.provisioning import (
    CommandError,
    ConnectionError,
    ProvisioningError,
    deprovision_onu,
    discover_onus,
    get_batch_status,
    get_onu_metrics,
    provision_onu,
    upgrade_firmware_onu,
    verify_onu,
)

# ── Job store en memoria (proceso único) ──────────────────────────
# Cada entry: {job_id, olt_ip, status, message, progress, started_at, updated_at}
_firmware_jobs: dict[str, dict] = {}

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s — %(message)s',
)
logger = logging.getLogger(__name__)


# ── Lifespan ──────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info('%s v%s iniciando…', settings.app_name, settings.app_version)
    yield
    logger.info('%s apagando.', settings.app_name)


# ── App ───────────────────────────────────────────────────────

app = FastAPI(
    title='OLT Automation Service',
    version=settings.app_version,
    description='Microservicio Python para comunicación SSH/SNMP directa con OLTs multimarca.',
    docs_url='/api/docs',
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=['GET', 'POST'],
    allow_headers=['*'],
)

app.include_router(mikrotik_router)
app.include_router(monitoring_router)


# ── Manejadores de excepción globales ─────────────────────────

@app.exception_handler(ProvisioningError)
async def provisioning_error_handler(request: Request, exc: ProvisioningError) -> JSONResponse:
    logger.error('ProvisioningError: %s', exc)
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={'success': False, 'error': str(exc)},
    )

@app.exception_handler(ConnectionError)
async def connection_error_handler(request: Request, exc: ConnectionError) -> JSONResponse:
    logger.error('ConnectionError: %s', exc)
    return JSONResponse(
        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
        content={'success': False, 'error': str(exc)},
    )


# ── Endpoints ─────────────────────────────────────────────────

@app.get('/api/v1/health', tags=['infra'])
async def health() -> dict:
    return {
        'status':         'healthy',
        'service':        settings.app_name,
        'version':        settings.app_version,
        'active_locks':   connection_pool.active_locks,
        'waiting_counts': connection_pool.waiting_count,
        'total_olts':     connection_pool.lock_count(),
    }


@app.post(
    '/api/v1/olt/provision',
    response_model=ProvisionResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Aprovisionar ONU en una OLT',
)
async def provision(body: ProvisionRequest) -> ProvisionResponse:
    """
    Envía los comandos de aprovisionamiento a la OLT vía SSH.

    El lock por IP garantiza que solo un aprovisionamiento corra por OLT
    a la vez.  Las peticiones adicionales esperan en cola — no se rechazan.
    """
    olt_ip = body.connection.ip

    async with connection_pool.acquire(olt_ip):
        # provision_onu usa Netmiko (sockets bloqueantes).
        # asyncio.to_thread() lo ejecuta en el thread pool sin bloquear el event loop.
        try:
            result = await asyncio.to_thread(provision_onu, body.connection, body.onu)
        except (ConnectionError, CommandError) as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

    return ProvisionResponse(
        success=result['success'],
        message='ONU aprovisionada correctamente',
        olt_ip=olt_ip,
        onu_sn=body.onu.sn,
        details={'parsed': result.get('parsed')},
    )


@app.post(
    '/api/v1/olt/metrics',
    response_model=MetricsResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Obtener métricas ópticas de una ONU (RxPower, TxPower, Temperatura)',
    description=(
        'Consulta en tiempo real vía SSH.  Siempre responde 200 — '
        'si hay fallo de red devuelve success=False con alarm en lugar de un 5xx.'
    ),
)
async def optical_metrics(body: ProvisionRequest) -> MetricsResponse:
    """
    Mantiene el lock por OLT igual que el endpoint de provisión: una sola
    sesión SSH activa por equipo en cualquier momento.
    """
    olt_ip = body.connection.ip

    async with connection_pool.acquire(olt_ip):
        result = await asyncio.to_thread(get_onu_metrics, body.connection, body.onu)

    return MetricsResponse(**result)


@app.post(
    '/api/v1/olt/discover-onus',
    response_model=DiscoverResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Descubrir ONUs no autorizadas / no configuradas en un puerto PON',
    description=(
        'Ejecuta el comando de autofind/unconfigured en la OLT y devuelve la lista '
        'de seriales detectados.  Siempre responde 200 — si hay fallo SSH devuelve '
        'success=False con campo error.  Respeta el lock de concurrencia por OLT.'
    ),
)
async def discover_onus_endpoint(body: DiscoverRequest) -> DiscoverResponse:
    """
    Mantiene el lock por OLT para no interferir con una sesión de aprovisionamiento
    en curso.  Las peticiones de descubrimiento esperan en cola — no se rechazan.
    """
    olt_ip = body.connection.ip

    async with connection_pool.acquire(olt_ip):
        try:
            raw_onus = await asyncio.to_thread(
                discover_onus, body.connection, body.slot, body.port,
            )
        except ProvisioningError as exc:
            logger.warning('discover_onus: fallo en %s — %s', olt_ip, exc)
            return DiscoverResponse(success=False, total=0, onus=[], error=str(exc))

    onus = [OntFoundInfo(sn=o['sn'], slot=o['slot'], port=o['port']) for o in raw_onus]
    return DiscoverResponse(success=True, total=len(onus), onus=onus)


@app.post(
    '/api/v1/olt/batch-status',
    response_model=BatchStatusResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Estado y métricas masivos de ONUs (una sesión SSH por puerto PON)',
    description=(
        'Consulta el estado y métricas de múltiples ONUs agrupando la comunicación '
        'por puerto PON.  Para Huawei/ZTE abre UNA sesión SSH por puerto; para '
        'VSOL/CDATA usa SNMP UDP individual.  Siempre responde 200 — si hay fallo '
        'global devuelve success=False con campo error.'
    ),
)
async def batch_status_endpoint(body: BatchStatusRequest) -> BatchStatusResponse:
    olt_ip  = body.connection.ip
    onus_in = [o.model_dump() for o in body.onus]

    async with connection_pool.acquire(olt_ip):
        try:
            raw = await asyncio.to_thread(get_batch_status, body.connection, onus_in)
        except ProvisioningError as exc:
            logger.warning('batch_status: fallo en %s — %s', olt_ip, exc)
            return BatchStatusResponse(success=False, total=0, onus=[], error=str(exc))

    onus_out = [OnuStatusInfo(**o) for o in raw]
    return BatchStatusResponse(success=True, total=len(onus_out), onus=onus_out)


@app.post(
    '/api/v1/olt/deprovision',
    response_model=DeprovisionResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Desaprovisionar ONU de una OLT (eliminar configuración)',
)
async def deprovision(body: DeprovisionRequest) -> DeprovisionResponse:
    """
    Envía los comandos de desaprovisionamiento a la OLT vía SSH.
    Respeta el lock de concurrencia por OLT — las peticiones simultáneas se encolan.
    """
    olt_ip = body.connection.ip

    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                deprovision_onu,
                body.connection,
                body.onu.slot,
                body.onu.port,
                body.onu.onu_id,
                body.onu.service_port_id,
                body.onu.rack,
            )
        except (ConnectionError, CommandError, ProvisioningError) as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

    return DeprovisionResponse(
        success=result['success'],
        message='ONU desaprovisionada correctamente',
        olt_ip=olt_ip,
        onu_id=body.onu.onu_id,
        details={k: v for k, v in result.items() if k != 'output'},
    )


@app.post(
    '/api/v1/olt/verify-onu',
    response_model=VerifyOnuResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Verificar estado de una ONU en la OLT (post-aprovisionamiento)',
    description=(
        'Consulta el estado de la ONU en la OLT vía SSH para confirmar que quedó online '
        'tras el aprovisionamiento.  Siempre responde 200 — si hay fallo SSH retorna '
        'success=False con campo error.'
    ),
)
async def verify_onu_endpoint(body: VerifyOnuRequest) -> VerifyOnuResponse:
    olt_ip = body.connection.ip

    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                verify_onu,
                body.connection,
                body.slot,
                body.port,
                body.onu_id,
            )
        except (ConnectionError, CommandError) as exc:
            return VerifyOnuResponse(
                success=False,
                error=str(exc),
            )

    return VerifyOnuResponse(**result)


# ── Helpers de firmware ───────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _delete_file_after_delay(path: str, delay: int = 1800) -> None:
    """Limpia el archivo de firmware del disco 30 min después de finalizar el job."""
    await asyncio.sleep(delay)
    try:
        os.unlink(path)
        parent = os.path.dirname(path)
        if '/tmp/firmware/' in parent:
            os.rmdir(parent)
    except OSError:
        pass


async def _run_firmware_upgrade(job_id: str, body: FirmwareUpgradeRequest) -> None:
    """Tarea de fondo: ejecuta la actualización OMCI y actualiza el job store."""
    def _set(status: str, message: str, progress: list[dict] | None = None) -> None:
        _firmware_jobs[job_id]['status']     = status
        _firmware_jobs[job_id]['message']    = message
        _firmware_jobs[job_id]['updated_at'] = _now_iso()
        if progress is not None:
            _firmware_jobs[job_id]['progress'] = progress

    async with connection_pool.acquire(body.connection.ip):
        try:
            results = await asyncio.to_thread(
                upgrade_firmware_onu,
                body.connection,
                body.slot,
                body.port,
                body.onu_ids,
                body.firmware_file,
            )
        except (ProvisioningError, ConnectionError, CommandError) as exc:
            _set('failed', str(exc))
            asyncio.create_task(_delete_file_after_delay(body.firmware_file))
            return

    statuses = {r['status'] for r in results}
    if statuses <= {'success'}:
        overall, msg = 'success', f'Actualización completada para {len(results)} ONU(s).'
    elif 'success' not in statuses:
        overall, msg = 'failed', 'Actualización fallida en todas las ONU(s).'
    else:
        ok = sum(1 for r in results if r['status'] == 'success')
        overall, msg = 'partial', f'Actualización parcial: {ok}/{len(results)} ONU(s) exitosas.'

    _set(overall, msg, results)
    asyncio.create_task(_delete_file_after_delay(body.firmware_file))


@app.post(
    '/api/v1/olt/firmware-upgrade',
    status_code=status.HTTP_202_ACCEPTED,
    tags=['olt'],
    summary='Iniciar actualización de firmware OMCI en ONUs (background task)',
    description=(
        'Transfiere el archivo .bin al flash de la OLT vía SFTP y luego ejecuta '
        'la actualización OMCI por cada ONU de la lista.  Responde de inmediato '
        'con job_id — el progreso se consulta en /firmware-job/{job_id}.  '
        'Solo soportado para marcas Huawei y ZTE (OMCI vía CLI).'
    ),
)
async def firmware_upgrade_endpoint(
    body:       FirmwareUpgradeRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    job_id = str(uuid.uuid4())
    now    = _now_iso()
    _firmware_jobs[job_id] = {
        'job_id':     job_id,
        'olt_ip':     body.connection.ip,
        'status':     'upgrading',
        'message':    f'Transfiriendo firmware "{body.firmware_filename}" a {len(body.onu_ids)} ONU(s)...',
        'progress':   [{'onu_id': i, 'status': 'pending', 'message': None} for i in body.onu_ids],
        'started_at': now,
        'updated_at': now,
    }
    background_tasks.add_task(_run_firmware_upgrade, job_id, body)
    return {
        'status':  'upgrade_in_progress',
        'job_id':  job_id,
        'message': f'Proceso de transferencia iniciado en segundo plano para {len(body.onu_ids)} ONU(s).',
    }


@app.get(
    '/api/v1/olt/firmware-job/{job_id}',
    response_model=FirmwareJobStatus,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Consultar estado de un job de firmware upgrade',
)
async def firmware_job_status(job_id: str) -> FirmwareJobStatus:
    job = _firmware_jobs.get(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'Job "{job_id}" no encontrado o expirado.',
        )
    return FirmwareJobStatus(
        job_id     = job['job_id'],
        olt_ip     = job['olt_ip'],
        status     = job['status'],
        message    = job['message'],
        progress   = [FirmwareJobProgress(**p) for p in job['progress']],
        started_at = job['started_at'],
        updated_at = job['updated_at'],
    )
