"""
Factory de drivers OLT.

Uso:
    from app.drivers import get_driver
    driver = get_driver('huawei', conn)
    result = driver.test_connection()

Las marcas disponibles son las que aparecen en _DRIVERS.
Cualquier nueva marca se registra aquí; los drivers existentes no cambian.
"""
from __future__ import annotations

from app.drivers.base import OltDriver, UnsupportedBrandError
from app.drivers.huawei import HuaweiDriver
from app.drivers.vsol import VSolDriver

_DRIVERS: dict[str, type[OltDriver]] = {
    'huawei': HuaweiDriver,
    'vsol':   VSolDriver,
}


def get_driver(brand: str, conn) -> OltDriver:
    """
    Retorna el driver concreto para la marca dada.

    Args:
        brand: 'huawei' | 'vsol'  (case-insensitive)
        conn:  OltConnectionSchema — credenciales de la OLT

    Raises:
        UnsupportedBrandError: si la marca no está registrada
    """
    key = brand.lower().strip()
    if key not in _DRIVERS:
        raise UnsupportedBrandError(
            f"Marca '{brand}' no soportada. Disponibles: {sorted(_DRIVERS)}"
        )
    return _DRIVERS[key](conn)


__all__ = ['get_driver', 'OltDriver', 'UnsupportedBrandError']
