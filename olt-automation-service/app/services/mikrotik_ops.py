"""
Operaciones MikroTik sobre RouterOS API: PPPoE, Queue y Firewall.
Funciones síncronas — invocar desde asyncio.to_thread() en los routers FastAPI.
"""
import logging
from contextlib import contextmanager
from typing import Generator

from app.services.mikrotik_pool import (
    MikrotikAuthError,
    MikrotikConnectionError,
    MikrotikNotFoundError,
)

logger = logging.getLogger(__name__)

_ROS_CONNECT_TIMEOUT = 10


@contextmanager
def _ros_api(host: str, port: int, username: str, password: str) -> Generator:
    """
    Abre la conexión RouterOS API y la cierra al salir del bloque.
    Convierte excepciones de la librería a MikrotikAuthError / MikrotikConnectionError
    solo durante la fase de conexión — los errores del bloque caller se propagan normalmente.
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
        yield api
    finally:
        try:
            ros_pool.disconnect()
        except Exception:
            pass


def _get_secret_id(secrets, pppoe_user: str) -> str:
    """Retorna el .id del secret o lanza MikrotikNotFoundError."""
    items = secrets.get(name=pppoe_user)
    if not items:
        raise MikrotikNotFoundError(f'Secret PPPoE "{pppoe_user}" no encontrado')
    return items[0]['.id']


def pppoe_provisionar(
    host: str, port: int, username: str, password: str,
    pppoe_user: str, pppoe_pass: str, profile: str, remote_address: str,
) -> str:
    """Crea un secret PPPoE. Retorna el .id asignado por RouterOS (ej: '*1A')."""
    with _ros_api(host, port, username, password) as api:
        secrets = api.get_resource('/ppp/secret')
        kwargs: dict = {
            'name':     pppoe_user,
            'password': pppoe_pass,
            'profile':  profile,
        }
        if remote_address:
            kwargs['remote-address'] = remote_address
        item_id: str = secrets.add(**kwargs)
        logger.info('PPPoE secret creado: %s (.id=%s) en %s', pppoe_user, item_id, host)
        return item_id


def pppoe_eliminar(
    host: str, port: int, username: str, password: str,
    pppoe_user: str,
) -> None:
    """Elimina el secret PPPoE. Lanza MikrotikNotFoundError si no existe."""
    with _ros_api(host, port, username, password) as api:
        secrets = api.get_resource('/ppp/secret')
        item_id = _get_secret_id(secrets, pppoe_user)
        secrets.remove(id=item_id)
        logger.info('PPPoE secret eliminado: %s en %s', pppoe_user, host)


def pppoe_set_enabled(
    host: str, port: int, username: str, password: str,
    pppoe_user: str, enabled: bool,
) -> None:
    """Habilita (enabled=True) o deshabilita (enabled=False) el secret PPPoE."""
    with _ros_api(host, port, username, password) as api:
        secrets = api.get_resource('/ppp/secret')
        item_id = _get_secret_id(secrets, pppoe_user)
        secrets.set(id=item_id, disabled='no' if enabled else 'yes')
        state = 'habilitado' if enabled else 'deshabilitado'
        logger.info('PPPoE secret %s %s en %s', pppoe_user, state, host)


# ── Queue Simple ──────────────────────────────────────────────────────────────

def queue_crear(
    host: str, port: int, username: str, password: str,
    name: str, target: str, max_limit_down: str, max_limit_up: str,
) -> str:
    """
    Crea una Simple Queue. Retorna el .id asignado por RouterOS.
    max-limit RouterOS = 'upload/download' → f'{max_limit_up}/{max_limit_down}'.
    """
    with _ros_api(host, port, username, password) as api:
        queues = api.get_resource('/queue/simple')
        item_id: str = queues.add(
            name=name,
            target=target,
            **{'max-limit': f'{max_limit_up}/{max_limit_down}'},
        )
        logger.info('Queue creada: %s target=%s limit=%s/%s en %s',
                    name, target, max_limit_up, max_limit_down, host)
        return item_id


def queue_eliminar(
    host: str, port: int, username: str, password: str,
    name: str,
) -> None:
    """Elimina la Simple Queue por nombre. Lanza MikrotikNotFoundError si no existe."""
    with _ros_api(host, port, username, password) as api:
        queues = api.get_resource('/queue/simple')
        items = queues.get(name=name)
        if not items:
            raise MikrotikNotFoundError(f'Queue "{name}" no encontrada')
        queues.remove(id=items[0]['.id'])
        logger.info('Queue eliminada: %s en %s', name, host)


# ── Firewall address-list ─────────────────────────────────────────────────────

def firewall_agregar_address(
    host: str, port: int, username: str, password: str,
    list_name: str, address: str, comment: str = '',
) -> None:
    """Agrega una entrada a un address-list de firewall."""
    with _ros_api(host, port, username, password) as api:
        addrlist = api.get_resource('/ip/firewall/address-list')
        kwargs: dict = {'list': list_name, 'address': address}
        if comment:
            kwargs['comment'] = comment
        addrlist.add(**kwargs)
        logger.info('Firewall address-list: %s + %s en %s', list_name, address, host)


def firewall_eliminar_address(
    host: str, port: int, username: str, password: str,
    list_name: str, address: str,
) -> None:
    """Elimina una entrada del address-list. Lanza MikrotikNotFoundError si no existe."""
    with _ros_api(host, port, username, password) as api:
        addrlist = api.get_resource('/ip/firewall/address-list')
        items = addrlist.get(**{'list': list_name, 'address': address})
        if not items:
            raise MikrotikNotFoundError(
                f'Dirección "{address}" en lista "{list_name}" no encontrada'
            )
        for item in items:
            addrlist.remove(id=item['.id'])
        logger.info('Firewall address-list: %s - %s en %s', list_name, address, host)


# ── ARP lookup ────────────────────────────────────────────────────────────────

def _ros_bool(val: object) -> bool:
    """Convierte valores RouterOS (bool Python o 'true'/'yes' como str) a bool."""
    if isinstance(val, bool):
        return val
    return str(val).lower() in ('true', 'yes')


def _arp_status(item: dict) -> str:
    if _ros_bool(item.get('invalid', False)):
        return 'invalid'
    if _ros_bool(item.get('complete', False)):
        return 'static' if not _ros_bool(item.get('dynamic', True)) else 'dynamic'
    return 'incomplete'


def arp_lookup(
    host: str, port: int, username: str, password: str,
    ip_address: str,
) -> dict:
    """
    Busca una IP en la tabla ARP del router.
    Retorna dict con ip, mac, interface, status.
    Lanza MikrotikNotFoundError si la IP no está en la tabla.
    """
    with _ros_api(host, port, username, password) as api:
        arp = api.get_resource('/ip/arp')
        items = arp.get(address=ip_address)
        if not items:
            raise MikrotikNotFoundError(f'IP "{ip_address}" no encontrada en tabla ARP')
        item = items[0]
        return {
            'ip':        item.get('address', ip_address),
            'mac':       item.get('mac-address', ''),
            'interface': item.get('interface', ''),
            'status':    _arp_status(item),
        }
