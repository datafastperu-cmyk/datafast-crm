"""
Control de concurrencia por OLT.

Garantía: cada OLT acepta exactamente 1 operación SSH simultánea.
Las peticiones adicionales se encolan y esperan al Lock — nunca se
rechazan por saturación del búfer de terminal o rechazo de conexión.

Si el lock no se libera en `settings.lock_acquire_timeout` segundos,
la petición en espera recibe HTTP 503 en lugar de bloquearse indefinidamente.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import HTTPException, status

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
        Context manager asíncrono con timeout configurable.

        Espera hasta `settings.lock_acquire_timeout` segundos para adquirir
        el lock. Si expira, lanza HTTP 503 en lugar de bloquear indefinidamente.
        Siempre libera el lock aunque el bloque interno lance una excepción.
        """
        from app.config import settings  # import local evita circular import en startup
        lock = await self._get_lock(olt_ip)
        logger.debug('Esperando lock para OLT %s (timeout=%ds)…', olt_ip, settings.lock_acquire_timeout)
        try:
            await asyncio.wait_for(lock.acquire(), timeout=settings.lock_acquire_timeout)
        except asyncio.TimeoutError:
            logger.warning(
                'Timeout (%ds) esperando lock para OLT %s — otra operación SSH en curso',
                settings.lock_acquire_timeout, olt_ip,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    f'OLT {olt_ip} ocupada: otra operación SSH está en curso. '
                    f'Reintenta en {settings.lock_acquire_timeout} segundos.'
                ),
            )
        logger.debug('Lock adquirido para OLT %s', olt_ip)
        try:
            yield
        finally:
            lock.release()
            logger.debug('Lock liberado para OLT %s', olt_ip)

    @property
    def active_locks(self) -> list[str]:
        """IPs con lock actualmente retenido (útil para healthcheck/debug)."""
        return [ip for ip, lk in self._locks.items() if lk.locked()]

    @property
    def waiting_count(self) -> dict[str, int]:
        """Número de coroutines esperando el lock por IP (útil para debug)."""
        result = {}
        for ip, lk in self._locks.items():
            waiters = getattr(lk, '_waiters', None)
            result[ip] = len(waiters) if waiters else 0
        return result

    def lock_count(self) -> int:
        return len(self._locks)


# Singleton — importar desde aquí en toda la app
connection_pool = OltConnectionPool()
