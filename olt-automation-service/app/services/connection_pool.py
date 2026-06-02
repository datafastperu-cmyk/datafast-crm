"""
Control de concurrencia por OLT.

Garantía: cada OLT acepta exactamente 1 operación SSH simultánea.
Las peticiones adicionales se encolan y esperan al Lock — nunca se
rechazan por saturación del búfer de terminal o rechazo de conexión.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

logger = logging.getLogger(__name__)


class OltConnectionPool:
    """
    Diccionario de asyncio.Lock indexado por IP de OLT.

    Uso:
        async with pool.acquire('10.0.50.2'):
            # solo un coroutine ejecuta este bloque por OLT a la vez
    """

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        # Meta-lock: protege el dict durante la creación de nuevos locks.
        # Sin esto, dos coroutines simultáneos en una IP nueva crearían
        # dos Lock distintos, rompiendo la garantía de exclusión mutua.
        self._meta: asyncio.Lock = asyncio.Lock()

    async def _get_lock(self, olt_ip: str) -> asyncio.Lock:
        async with self._meta:
            if olt_ip not in self._locks:
                self._locks[olt_ip] = asyncio.Lock()
                logger.debug('Nuevo lock creado para OLT %s', olt_ip)
            return self._locks[olt_ip]

    @asynccontextmanager
    async def acquire(self, olt_ip: str) -> AsyncIterator[None]:
        """
        Context manager asíncrono.  Bloquea hasta que la OLT esté libre.
        Siempre libera el lock aunque el bloque interno lance una excepción.
        """
        lock = await self._get_lock(olt_ip)
        logger.debug('Esperando lock para OLT %s …', olt_ip)
        async with lock:
            logger.debug('Lock adquirido para OLT %s', olt_ip)
            try:
                yield
            finally:
                logger.debug('Lock liberado para OLT %s', olt_ip)

    @property
    def active_locks(self) -> list[str]:
        """IPs con lock actualmente retenido (útil para healthcheck/debug)."""
        return [ip for ip, lk in self._locks.items() if lk.locked()]

    def lock_count(self) -> int:
        return len(self._locks)


# Singleton — importar desde aquí en toda la app
connection_pool = OltConnectionPool()
