import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Rutas públicas — no requieren X-Internal-Key
_PUBLIC_PATHS = {'/api/v1/health', '/api/docs', '/openapi.json'}

from app.config import settings
from app.routers.mikrotik import router as mikrotik_router
from app.routers.monitoring import router as monitoring_router
from app.schemas.olt import (
    BatchStatusRequest,
    BatchStatusResponse,
    BoardTopologyRequest,
    BoardTopologyResponse,
    BoardSlotInfo,
    DeprovisionRequest,
    DeprovisionResponse,
    DiscoverRequest,
    DiscoverResponse,
    FirmwareJobProgress,
    FirmwareJobStatus,
    FirmwareUpgradeRequest,
    FtthBootstrapRequest,
    FtthBootstrapResponse,
    FtthGponRequest,
    FtthGponResponse,
    FtthOntIdsRequest,
    FtthOntIdsResponse,
    FtthPollRequest,
    FtthPollResponse,
    FtthRollbackRequest,
    FtthRollbackResponse,
    FtthWanPppoeRequest,
    FtthWanResponse,
    ListProfilesRequest,
    ListProfilesResponse,
    MetricsResponse,
    OnuStatusInfo,
    OntFoundInfo,
    OntResetRequest,
    OntResetResponse,
    OntVersionRequest,
    OntVersionResponse,
    ProvisionRequest,
    ProvisionResponse,
    TestConnectionRequest,
    TestConnectionResponse,
    VerifyOnuRequest,
    VerifyOnuResponse,
    OntSuspendRequest,
    OntRehabilitateRequest,
    OntSuspendResponse,
    ChangeLineprofileRequest,
    ChangeLineprofileResponse,
    WizardTopologyRequest,
    WizardTopologyResponse,
    WizardBoardInfo,
    WizardVlanInfo,
    OltProfileInfo,
    OltTrafficTableInfo,
    HealthSnapshotRequest,
    HealthSnapshotResponse,
    HealthBoardInfo,
    HealthPomInfo,
    PonPortsRequest,
    PonPortsResponse,
    ClassifyOnusRequest,
    ClassifyOnusResponse,
    ClassifiedOnu,
    AutofindOnu,
    PonPortInfoSchema,
    VlanAddRequest,
    VlanAddResponse,
    VlanDeleteRequest,
    VlanDeleteResponse,
    TrafficTableAddRequest,
    TrafficTableAddResponse,
    TrafficTableDeleteRequest,
    TrafficTableDeleteResponse,
    TrafficTableEditRequest,
    TrafficTableEditResponse,
)
from app.drivers import get_driver
from app.drivers.base import UnsupportedBrandError, DriverNotImplementedError
from app.services.connection_pool import connection_pool
from app.services.provisioning import (
    CommandError,
    ConnectionError,
    ProvisioningError,
    classify_port_onus_huawei,
    deprovision_onu,
    discover_onus,
    display_huawei_board,
    get_batch_status,
    get_huawei_ont_version,
    get_onu_metrics,
    inject_wan_pppoe,
    list_configured_ont_ids,
    list_huawei_profiles,
    poll_onu_online,
    single_poll_check,
    provision_gpon_ftth,
    provision_mgmt_bootstrap,
    provision_onu,
    reset_huawei_onu,
    rollback_gpon,
    change_lineprofile,
    suspend_onu,
    rehabilitate_onu,
    test_olt_connection,
    upgrade_firmware_onu,
    verify_onu,
    add_vlan,
    delete_vlan,
    add_traffic_table,
    delete_traffic_table,
    edit_traffic_table,
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


@app.middleware('http')
async def api_key_middleware(request: Request, call_next):
    """Valida X-Internal-Key en todos los endpoints excepto salud y docs."""
    if request.url.path in _PUBLIC_PATHS:
        return await call_next(request)
    key = request.headers.get('x-internal-key', '')
    if key != settings.internal_api_key:
        logger.warning('Llamada no autorizada desde %s a %s', request.client, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={'error': 'Unauthorized — X-Internal-Key requerida'},
        )
    return await call_next(request)

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

    onus = [
        OntFoundInfo(sn=o['sn'], slot=o['slot'], port=o['port'], ont_model=o.get('ont_model'))
        for o in raw_onus
    ]
    return DiscoverResponse(success=True, total=len(onus), onus=onus)


@app.post(
    '/api/v1/olt/test-connection',
    response_model=TestConnectionResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Prueba de conectividad SSH liviana a una OLT (sin ejecutar comandos)',
    description=(
        'Abre una sesión SSH con Netmiko, verifica que el prompt sea reconocido '
        'y cierra inmediatamente.  Nunca ejecuta comandos en la OLT.  '
        'Siempre responde 200 — si hay fallo devuelve success=False con campo error.'
    ),
)
async def test_connection_endpoint(body: TestConnectionRequest) -> TestConnectionResponse:
    result = await asyncio.to_thread(test_olt_connection, body.connection)
    return TestConnectionResponse(**result)


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


@app.post(
    '/api/v1/olt/profiles',
    response_model=ListProfilesResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Listar perfiles de la OLT Huawei MA5800 (lineprofile, srvprofile, traffic-table)',
    description=(
        'Abre UNA sesión SSH y ejecuta tres comandos de display para obtener los perfiles '
        'disponibles en la OLT. Siempre responde 200 — si hay fallo SSH retorna success=False.'
    ),
)
async def list_profiles_endpoint(body: ListProfilesRequest) -> ListProfilesResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        result = await asyncio.to_thread(list_huawei_profiles, body.connection)
    if not result['success']:
        return ListProfilesResponse(success=False, error=result.get('error'))
    return ListProfilesResponse(
        success=True,
        lineprofiles=[{'profile_id': p['profile_id'], 'name': p['name']} for p in result['lineprofiles']],
        srvprofiles=[{'profile_id': p['profile_id'], 'name': p['name']} for p in result['srvprofiles']],
        traffic_tables=[
            {'index': t['index'], 'name': t['name'], 'cir_kbps': t['cir_kbps'], 'pir_kbps': t['pir_kbps'],
             'cbs_bytes': t.get('cbs_bytes'), 'pbs_bytes': t.get('pbs_bytes')}
            for t in result['traffic_tables']
        ],
    )


@app.post(
    '/api/v1/olt/ont-reset',
    response_model=OntResetResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Reiniciar una ONU Huawei MA5800 (ont reset)',
)
async def ont_reset_endpoint(body: OntResetRequest) -> OntResetResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                reset_huawei_onu, body.connection, body.slot, body.port, body.onu_id,
            )
        except (ConnectionError, CommandError, ProvisioningError) as exc:
            return OntResetResponse(success=False, message='Fallo al reiniciar ONU', error=str(exc))
    return OntResetResponse(success=result['success'], message=result['message'])


@app.post(
    '/api/v1/olt/board-topology',
    response_model=BoardTopologyResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Topología física de la OLT Huawei (slots y tarjetas instaladas)',
    description='Ejecuta display board 0 y retorna los slots activos con contadores de ONUs.',
)
async def board_topology_endpoint(body: BoardTopologyRequest) -> BoardTopologyResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        result = await asyncio.to_thread(display_huawei_board, body.connection)
    if not result['success']:
        return BoardTopologyResponse(success=False, error=result.get('error'))
    slots = [BoardSlotInfo(**s) for s in result['slots']]
    return BoardTopologyResponse(success=True, slots=slots)


@app.post(
    '/api/v1/olt/ont-version',
    response_model=OntVersionResponse,
    status_code=status.HTTP_200_OK,
    tags=['olt'],
    summary='Versión de firmware de una ONU Huawei (display ont version)',
)
async def ont_version_endpoint(body: OntVersionRequest) -> OntVersionResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        result = await asyncio.to_thread(
            get_huawei_ont_version, body.connection, body.slot, body.port, body.onu_id,
        )
    if not result['success']:
        return OntVersionResponse(success=False, error=result.get('error'))
    return OntVersionResponse(
        success=True,
        ont_version=result.get('ont_version'),
        software_version=result.get('software_version'),
        equipment_id=result.get('equipment_id'),
    )


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


# ── FTTH Two-Phase Provisioning ───────────────────────────────

@app.post(
    '/api/v1/olt/ftth/provision-gpon',
    response_model=FtthGponResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Fase 1 FTTH: registrar ONU en la OLT (ont add + service-port)',
)
async def ftth_provision_gpon(body: FtthGponRequest) -> FtthGponResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                provision_gpon_ftth,
                body.connection,
                body.frame, body.slot, body.port, body.onu_id,
                body.sn, body.service_port_id, body.vlan,
                body.lineprofile_id, body.srvprofile_id,
                body.traffic_index_down,
                body.traffic_index_up,
                body.description,
            )
        except ProvisioningError as exc:
            # Loguear el error CLI real: sin esto el fallo de Fase 1 se devolvia en
            # el body sin quedar en el log, imposibilitando el diagnostico.
            logger.warning(
                'ftth_provision_gpon FALLO | OLT=%s slot=%d port=%d onu_id=%d sn=%s: %s',
                olt_ip, body.slot, body.port, body.onu_id, body.sn, exc,
            )
            return FtthGponResponse(success=False, error=str(exc))
    return FtthGponResponse(success=True, sn=result['sn'], olt_ip=result['olt_ip'])


@app.post(
    '/api/v1/olt/ftth/bootstrap-tr069',
    response_model=FtthBootstrapResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Carril bootstrap TR-069 (ZTP): mgmt WAN DHCP + Option 43 → ONU aparece en el ACS',
)
async def ftth_bootstrap_tr069(body: FtthBootstrapRequest) -> FtthBootstrapResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                provision_mgmt_bootstrap,
                body.connection,
                body.slot, body.port, body.onu_id,
                body.mgmt_vlan, body.mgmt_service_port_id,
                body.traffic_index, body.priority,
            )
        except ProvisioningError as exc:
            logger.warning(
                'ftth_bootstrap_tr069 FALLO | OLT=%s slot=%d port=%d onu_id=%d mgmt_vlan=%d: %s',
                olt_ip, body.slot, body.port, body.onu_id, body.mgmt_vlan, exc,
            )
            return FtthBootstrapResponse(success=False, error=str(exc))
    return FtthBootstrapResponse(success=True, olt_ip=result['olt_ip'])


@app.post(
    '/api/v1/olt/ftth/rollback-gpon',
    response_model=FtthRollbackResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Rollback Fase 1 FTTH: eliminar ont add + service-port de la OLT',
)
async def ftth_rollback_gpon(body: FtthRollbackRequest) -> FtthRollbackResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        result = await asyncio.to_thread(
            rollback_gpon,
            body.connection,
            body.slot, body.port, body.onu_id, body.service_port_id,
        )
    return FtthRollbackResponse(success=result['success'], error=result.get('error'))


@app.post(
    '/api/v1/olt/ftth/ont-ids',
    response_model=FtthOntIdsResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Listar ONT-IDs configurados en un puerto (incl. SmartOLT) para evitar colisiones',
)
async def ftth_ont_ids(body: FtthOntIdsRequest) -> FtthOntIdsResponse:
    async with connection_pool.acquire(body.connection.ip):
        try:
            ids = await asyncio.to_thread(
                list_configured_ont_ids, body.connection, body.slot, body.port,
            )
        except ProvisioningError as exc:
            logger.warning('ftth_ont_ids FALLO | OLT=%s %d/%d: %s', body.connection.ip, body.slot, body.port, exc)
            return FtthOntIdsResponse(ont_ids=[])
    return FtthOntIdsResponse(ont_ids=ids)


@app.post(
    '/api/v1/olt/ftth/poll-online',
    response_model=FtthPollResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Fase 1b FTTH: esperar que la ONU aparezca online',
)
async def ftth_poll_online(body: FtthPollRequest) -> FtthPollResponse:
    """
    Adquiere el lock de OLT SOLO durante cada verificación SSH individual (< 2 s),
    liberándolo entre intentos (sleep de 5 s sin lock).
    Esto evita bloquear la OLT completa durante los 90 s del poll.
    """
    import time as _t
    olt_ip   = body.connection.ip
    interval = 5
    t_end    = _t.monotonic() + body.max_wait

    while _t.monotonic() < t_end:
        async with connection_pool.acquire(olt_ip):
            result = await asyncio.to_thread(
                single_poll_check,
                body.connection,
                body.slot, body.port, body.onu_id,
            )
        if result.get('online'):
            logger.info('poll_onu_online OK | OLT=%s onu_id=%d', olt_ip, body.onu_id)
            return FtthPollResponse(success=True, run_state='online', timeout=False)
        await asyncio.sleep(interval)

    logger.warning('poll_onu_online timeout | OLT=%s onu_id=%d', olt_ip, body.onu_id)
    return FtthPollResponse(success=False, run_state='unknown', timeout=True)


@app.post(
    '/api/v1/olt/ftth/inject-wan-pppoe',
    response_model=FtthWanResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Fase 2 FTTH: inyectar config PPPoE en la ONU vía OMCI',
)
async def ftth_inject_wan_pppoe(body: FtthWanPppoeRequest) -> FtthWanResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                inject_wan_pppoe,
                body.connection,
                body.slot, body.port, body.onu_id, body.vlan,
                body.username, body.password, body.mode,
                body.ip_address, body.mask, body.gateway, body.pri_dns,
            )
        except ProvisioningError as exc:
            logger.warning(
                'ftth_inject_wan FALLO | OLT=%s slot=%d port=%d onu_id=%d: %s',
                olt_ip, body.slot, body.port, body.onu_id, exc,
            )
            return FtthWanResponse(success=False, error=str(exc))
    return FtthWanResponse(
        success = True,
        olt_ip  = result['olt_ip'],
        onu_id  = result['onu_id'],
    )


# ── Suspensión / Rehabilitación ──────────────────────────────────

@app.post(
    '/api/v1/olt/ftth/suspend',
    response_model=OntSuspendResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Suspender ONU: desactiva ONT en la OLT Huawei sin eliminar config',
)
async def ftth_suspend_onu(body: OntSuspendRequest) -> OntSuspendResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                suspend_onu,
                body.connection,
                body.slot, body.port, body.onu_id, body.service_port_id,
            )
        except ProvisioningError as exc:
            return OntSuspendResponse(success=False, message='Error al suspender ONU', error=str(exc))
    return OntSuspendResponse(success=True, message=result['message'])


@app.post(
    '/api/v1/olt/ftth/rehabilitate',
    response_model=OntSuspendResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Rehabilitar ONU: reactiva ONT en la OLT Huawei previamente suspendida',
)
async def ftth_rehabilitate_onu(body: OntRehabilitateRequest) -> OntSuspendResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                rehabilitate_onu,
                body.connection,
                body.slot, body.port, body.onu_id, body.service_port_id,
            )
        except ProvisioningError as exc:
            return OntSuspendResponse(success=False, message='Error al rehabilitar ONU', error=str(exc))
    return OntSuspendResponse(success=True, message=result['message'])


@app.post(
    '/api/v1/olt/ftth/change-lineprofile',
    response_model=ChangeLineprofileResponse,
    status_code=status.HTTP_200_OK,
    tags=['ftth'],
    summary='Cambiar velocidad en caliente: actualiza traffic-table del service-port sin re-aprovisionar',
)
async def ftth_change_lineprofile(body: ChangeLineprofileRequest) -> ChangeLineprofileResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                change_lineprofile,
                body.connection,
                body.slot, body.port, body.onu_id, body.service_port_id,
                body.traffic_index_down, body.traffic_index_up,
            )
        except ProvisioningError as exc:
            return ChangeLineprofileResponse(success=False, message='Error al cambiar velocidad', error=str(exc))
    return ChangeLineprofileResponse(
        success            = True,
        message            = result['message'],
        traffic_index_down = result['traffic_index_down'],
        traffic_index_up   = result['traffic_index_up'],
    )


# ── Health snapshot (boards + POM) ─────────────────────────────

@app.post(
    '/api/v1/olt/health/snapshot',
    response_model=HealthSnapshotResponse,
    status_code=status.HTTP_200_OK,
    tags=['health'],
    summary='Snapshot de salud de la OLT: boards + POM opcional (multi-marca via driver)',
    description=(
        'Llama get_board_status() del driver correspondiente y opcionalmente get_all_pom(). '
        'La falla de POM es no-fatal: si falla, retorna success=True con pom=[]. '
        'Siempre responde 200 — si falla el board poll retorna success=False.'
    ),
)
async def health_snapshot(body: HealthSnapshotRequest) -> HealthSnapshotResponse:
    try:
        driver = get_driver(body.connection.brand.value, body.connection)
    except UnsupportedBrandError as exc:
        return HealthSnapshotResponse(success=False, error=str(exc))

    olt_ip = body.connection.ip

    async with connection_pool.acquire(olt_ip):
        try:
            raw_boards = await asyncio.to_thread(driver.get_board_status)
        except Exception as exc:  # noqa: BLE001
            logger.error('health_snapshot boards en %s: %s', olt_ip, exc)
            return HealthSnapshotResponse(success=False, error=str(exc))

        raw_pom: list = []
        if body.include_pom:
            try:
                raw_pom = await asyncio.to_thread(driver.get_all_pom)
            except Exception as exc:  # noqa: BLE001
                logger.warning('health_snapshot POM en %s (no-fatal): %s', olt_ip, exc)

    boards = [
        HealthBoardInfo(
            slot=b.slot, board_type=b.board_type, state=b.state,
            onu_count=b.onu_count, onu_capacity=b.onu_capacity,
            online_onus=b.online_onus, offline_onus=b.offline_onus,
        )
        for b in raw_boards
    ]

    pom = [
        HealthPomInfo(
            slot=p.slot, port=p.port,
            temp_celsius=p.temperature_celsius,
            tx_dbm=p.tx_power_dbm,
            rx_dbm=p.rx_power_dbm,
            voltage_mv=p.voltage_mv,
            laser_ma=p.laser_current_ma,
            state=p.state,
        )
        for p in raw_pom
    ]

    return HealthSnapshotResponse(success=True, boards=boards, pom=pom)


# ── Health PON ports (estado por puerto PON) ───────────────────

@app.post(
    '/api/v1/olt/health/pon-ports',
    response_model=PonPortsResponse,
    status_code=status.HTTP_200_OK,
    tags=['health'],
    summary='Estado operativo de los puertos PON en un slot (admin, oper, ONUs)',
    description=(
        'Llama get_pon_port_status(slot) del driver. '
        'Una sola sesión SSH: display port state + display ont info summary por puerto. '
        'Siempre responde 200 — si falla SSH retorna success=False con campo error.'
    ),
)
async def health_pon_ports(body: PonPortsRequest) -> PonPortsResponse:
    olt_ip = body.connection.ip

    try:
        driver = get_driver(body.connection.brand.value, body.connection)
    except UnsupportedBrandError as exc:
        return PonPortsResponse(success=False, slot=body.slot, error=str(exc))

    async with connection_pool.acquire(olt_ip):
        try:
            raw_ports = await asyncio.to_thread(driver.get_pon_port_status, body.slot)
        except Exception as exc:  # noqa: BLE001
            logger.error('health_pon_ports slot %d en %s: %s', body.slot, olt_ip, exc)
            return PonPortsResponse(success=False, slot=body.slot, error=str(exc))

    ports = [
        PonPortInfoSchema(
            slot         = p.slot,
            port         = p.port,
            port_type    = p.port_type,
            admin_state  = p.admin_state,
            oper_state   = p.oper_state,
            autofind     = p.autofind,
            onus_total   = p.onus_total,
            onus_online  = p.onus_online,
            onus_offline = p.onus_offline,
            max_capacity = p.max_capacity,
        )
        for p in raw_ports
    ]

    return PonPortsResponse(success=True, slot=body.slot, ports=ports)


@app.post(
    '/api/v1/olt/onus/classify',
    response_model=ClassifyOnusResponse,
    status_code=status.HTTP_200_OK,
    tags=['health'],
    summary='Clasifica el estado de todas las ONUs de un puerto PON',
    description=(
        'Combina display ont info all + detalle de las offline (down cause) + '
        'autofind. Devuelve el estado operativo resuelto por ONU: '
        'online | apagada | ruptura_fibra | desactivada | offline, más las ONUs '
        'físicas sin aprovisionar (autofind). Solo Huawei por ahora. '
        'Siempre responde 200 — si falla SSH retorna success=False con error.'
    ),
)
async def classify_onus(body: ClassifyOnusRequest) -> ClassifyOnusResponse:
    olt_ip = body.connection.ip
    if body.connection.brand.value != 'huawei':
        return ClassifyOnusResponse(
            success=False, slot=body.slot, port=body.port,
            error=f'Clasificación de ONUs no implementada para marca: {body.connection.brand.value}',
        )
    async with connection_pool.acquire(olt_ip):
        try:
            data = await asyncio.to_thread(
                classify_port_onus_huawei, body.connection, body.slot, body.port,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error('classify_onus %d/%d en %s: %s', body.slot, body.port, olt_ip, exc)
            return ClassifyOnusResponse(
                success=False, slot=body.slot, port=body.port, error=str(exc),
            )

    onus = [
        ClassifiedOnu(
            onu_id           = o['onu_id'],
            sn               = o.get('sn'),
            run_state        = o.get('run_state'),
            control_flag     = o.get('control_flag'),
            config_state     = o.get('config_state'),
            estado_operativo = o.get('estado_operativo', 'offline'),
            down_cause       = o.get('down_cause'),
            dying_gasp_time  = o.get('dying_gasp_time'),
            rx_power_dbm     = o.get('rx_power_dbm'),
            tx_power_dbm     = o.get('tx_power_dbm'),
        )
        for o in data.get('onus', [])
    ]
    autofind = [
        AutofindOnu(sn=a.get('sn'), slot=a.get('slot'), port=a.get('port'), model=a.get('ont_model'))
        for a in data.get('autofind', [])
    ]
    return ClassifyOnusResponse(
        success=True, slot=body.slot, port=body.port, onus=onus, autofind=autofind,
    )


# ── Wizard: topología completa ─────────────────────────────────

@app.post(
    '/api/v1/olt/wizard/topology',
    response_model=WizardTopologyResponse,
    status_code=status.HTTP_200_OK,
    tags=['wizard'],
    summary='Obtener topología completa de la OLT (boards, VLANs, perfiles, traffic tables)',
    description=(
        'Usa el driver correspondiente a la marca para obtener en UNA sesión SSH '
        'todos los datos de configuración de la OLT necesarios para el wizard. '
        'Siempre responde 200 — si hay fallo SSH retorna success=False con campo error.'
    ),
)
async def wizard_topology(body: WizardTopologyRequest) -> WizardTopologyResponse:
    olt_ip = body.connection.ip

    try:
        driver = get_driver(body.connection.brand.value, body.connection)
    except UnsupportedBrandError as exc:
        return WizardTopologyResponse(success=False, error=str(exc))

    async with connection_pool.acquire(olt_ip):
        try:
            topology = await asyncio.to_thread(driver.get_topology)
        except Exception as exc:  # noqa: BLE001
            logger.error('wizard_topology en %s: %s', olt_ip, exc)
            return WizardTopologyResponse(success=False, error=str(exc))

    boards = [
        WizardBoardInfo(
            slot         = b.slot,
            board_type   = b.board_type,
            state        = b.state,
            onu_count    = b.onu_count,
            onu_capacity = b.onu_capacity,
            online_onus  = b.online_onus,
            offline_onus = b.offline_onus,
        )
        for b in topology.boards
    ]

    vlans = [WizardVlanInfo(vlan_id=v.vlan_id, name=v.name) for v in topology.vlans]

    traffic_tables = [
        OltTrafficTableInfo(index=t.index, name=t.name, cir_kbps=t.cir_kbps, pir_kbps=t.pir_kbps,
                            cbs_bytes=t.cbs_bytes, pbs_bytes=t.pbs_bytes)
        for t in topology.traffic_tables
    ]
    line_profiles = [
        OltProfileInfo(profile_id=p.get('profile_id', 0), name=p.get('name', ''))
        for p in topology.line_profiles
    ]
    service_profiles = [
        OltProfileInfo(profile_id=p.get('profile_id', 0), name=p.get('name', ''))
        for p in topology.service_profiles
    ]

    return WizardTopologyResponse(
        success          = True,
        model            = topology.model,
        firmware_version = topology.firmware_version,
        boards           = boards,
        vlans            = vlans,
        traffic_tables   = traffic_tables,
        line_profiles    = line_profiles,
        service_profiles = service_profiles,
    )


# ── VLAN CLI ──────────────────────────────────────────────────

@app.post(
    '/api/v1/olt/vlan/add',
    response_model=VlanAddResponse,
    status_code=status.HTTP_200_OK,
    tags=['vlan'],
    summary='Crear una VLAN en la OLT Huawei MA5800 vía SSH CLI',
)
async def vlan_add(body: VlanAddRequest) -> VlanAddResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(add_vlan, body.connection, body.vlan_id, body.name)
        except ProvisioningError as exc:
            return VlanAddResponse(success=False, error=str(exc))
    return VlanAddResponse(success=result['success'], vlan_id=result.get('vlan_id'), error=result.get('error'))


@app.post(
    '/api/v1/olt/vlan/delete',
    response_model=VlanDeleteResponse,
    status_code=status.HTTP_200_OK,
    tags=['vlan'],
    summary='Eliminar una VLAN de la OLT Huawei MA5800 vía SSH CLI',
)
async def vlan_delete(body: VlanDeleteRequest) -> VlanDeleteResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(delete_vlan, body.connection, body.vlan_id)
        except ProvisioningError as exc:
            return VlanDeleteResponse(success=False, error=str(exc))
    return VlanDeleteResponse(success=result['success'], error=result.get('error'))


# ── Traffic Table CLI ─────────────────────────────────────────

@app.post(
    '/api/v1/olt/traffic-table/add',
    response_model=TrafficTableAddResponse,
    status_code=status.HTTP_200_OK,
    tags=['traffic-table'],
    summary='Crear un traffic table en la OLT Huawei MA5800 vía SSH CLI',
)
async def traffic_table_add(body: TrafficTableAddRequest) -> TrafficTableAddResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                add_traffic_table, body.connection, body.name, body.cir_kbps, body.pir_kbps,
                body.cbs_bytes, body.pbs_bytes,
            )
        except ProvisioningError as exc:
            return TrafficTableAddResponse(success=False, error=str(exc))
    return TrafficTableAddResponse(
        success = result['success'],
        index   = result.get('index'),
        name    = result.get('name'),
        error   = result.get('error'),
    )


@app.post(
    '/api/v1/olt/traffic-table/delete',
    response_model=TrafficTableDeleteResponse,
    status_code=status.HTTP_200_OK,
    tags=['traffic-table'],
    summary='Eliminar un traffic table de la OLT Huawei MA5800 vía SSH CLI',
)
async def traffic_table_delete(body: TrafficTableDeleteRequest) -> TrafficTableDeleteResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(delete_traffic_table, body.connection, body.index)
        except ProvisioningError as exc:
            return TrafficTableDeleteResponse(success=False, error=str(exc))
    return TrafficTableDeleteResponse(success=result['success'], error=result.get('error'))


@app.post(
    '/api/v1/olt/traffic-table/edit',
    response_model=TrafficTableEditResponse,
    status_code=status.HTTP_200_OK,
    tags=['traffic-table'],
    summary='Editar un traffic table en la OLT Huawei MA5800 (delete + recreate)',
    description=(
        'Elimina el traffic table por índice y lo recrea con los nuevos parámetros. '
        'Retorna new_index con el índice asignado tras la recreación. '
        'El caller debe haber verificado que no hay ONUs en uso antes de llamar.'
    ),
)
async def traffic_table_edit(body: TrafficTableEditRequest) -> TrafficTableEditResponse:
    olt_ip = body.connection.ip
    async with connection_pool.acquire(olt_ip):
        try:
            result = await asyncio.to_thread(
                edit_traffic_table, body.connection, body.index, body.name, body.cir_kbps, body.pir_kbps,
                body.cbs_bytes, body.pbs_bytes,
            )
        except ProvisioningError as exc:
            return TrafficTableEditResponse(success=False, error=str(exc))
    return TrafficTableEditResponse(
        success   = result['success'],
        new_index = result.get('new_index'),
        error     = result.get('error'),
    )
