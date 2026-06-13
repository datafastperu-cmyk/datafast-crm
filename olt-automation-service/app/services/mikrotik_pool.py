"""
Pool de concurrencia y conexión RouterOS API para dispositivos MikroTik.

Un asyncio.Lock por host — misma garantía que OltConnectionPool:
exactamente 1 operación activa por router a la vez.

Funciones síncronas — invocar desde asyncio.to_thread() en los routers FastAPI.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

logger = logging.getLogger(__name__)

_ROS_CONNECT_TIMEOUT = 10  # segundos; RouterOS API es TCP, no requiere handshake SSH


class MikrotikAuthError(Exception):
    """Credenciales inválidas o acceso denegado por el router."""


class MikrotikConnectionError(Exception):
    """Router no alcanzable, puerto cerrado o timeout de red."""


class MikrotikNotFoundError(Exception):
    """El recurso solicitado no existe en el router (ej: secret PPPoE no encontrado)."""


class MikrotikPool:
    """
    Diccionario de asyncio.Lock indexado por host MikroTik.

    Uso:
        async with mikrotik_pool.acquire('192.168.88.1'):
            result = await asyncio.to_thread(fn_sync, ...)
    """

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        self._meta = asyncio.Lock()

    async def _get_lock(self, host: str) -> asyncio.Lock:
        async with self._meta:
            if host not in self._locks:
                self._locks[host] = asyncio.Lock()
                logger.debug('Nuevo lock creado para MikroTik %s', host)
            return self._locks[host]

    @asynccontextmanager
    async def acquire(self, host: str) -> AsyncIterator[None]:
        lock = await self._get_lock(host)
        logger.debug('Esperando lock para MikroTik %s …', host)
        async with lock:
            logger.debug('Lock adquirido para MikroTik %s', host)
            try:
                yield
            finally:
                logger.debug('Lock liberado para MikroTik %s', host)

    @property
    def active_locks(self) -> list[str]:
        return [h for h, lk in self._locks.items() if lk.locked()]

    def lock_count(self) -> int:
        return len(self._locks)


# Singleton — importar desde aquí en todos los routers MikroTik
mikrotik_pool = MikrotikPool()


def test_routeros_connection(host: str, port: int, username: str, password: str) -> str:
    """
    Abre una conexión RouterOS API, lee /system/resource y retorna la versión.

    Retorna: cadena con la versión, ej. 'RouterOS 7.14.3'.
    Lanza MikrotikAuthError o MikrotikConnectionError ante fallo.
    """
    try:
        import routeros_api
        from routeros_api import exceptions as ra_exc
    except ImportError as exc:
        raise MikrotikConnectionError(
            'routeros-api no instalado. Ejecutar: pip install routeros-api==0.17.0'
        ) from exc

    ros_pool = None
    try:
        ros_pool = routeros_api.RouterOsApiPool(
            host,
            username=username,
            password=password,
            port=port,
            plaintext_login=True,
            timeout=_ROS_CONNECT_TIMEOUT,
        )
        api = ros_pool.get_api()
    except ra_exc.RouterOsApiCommunicationError as exc:
        raise MikrotikAuthError(f'Credenciales inválidas: {exc}') from exc
    except (ra_exc.RouterOsApiConnectionError, OSError, TimeoutError) as exc:
        raise MikrotikConnectionError(f'Router no alcanzable: {exc}') from exc

    try:
        resource = api.get_resource('/system/resource')
        data = resource.get()
        version = data[0].get('version', 'unknown')
    except Exception as exc:
        raise MikrotikConnectionError(f'Error al leer /system/resource: {exc}') from exc
    finally:
        if ros_pool is not None:
            try:
                ros_pool.disconnect()
            except Exception:
                pass

    return f'RouterOS {version}'
