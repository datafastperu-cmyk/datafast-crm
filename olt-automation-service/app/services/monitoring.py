"""
Servicio de monitoreo: ping ICMP masivo y consulta SNMP de tráfico/recursos.

REQUISITOS DE SISTEMA:
- icmplib: cap_net_raw (Docker: --cap-add=NET_RAW)
- easysnmp: libsnmp de Net-SNMP (Docker: apt-get install -y snmp libsnmp-dev)
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _host_to_dict(h, detail: bool = False) -> dict:
    return {
        'host':             h.address,
        'alive':            h.is_alive,
        'latency_ms':       round(h.avg_rtt, 2) if h.is_alive else None,
        'loss_pct':         round(h.packet_loss * 100, 1),
        **(
            {
                'packets_sent':     h.packets_sent,
                'packets_received': h.packets_received,
            }
            if detail else {}
        ),
    }


async def ping_batch(hosts: list[str], count: int, timeout: int) -> list[dict]:
    """
    Ping masivo usando icmplib.async_multiping — todos los hosts en paralelo.
    Requiere cap_net_raw o root.
    """
    from icmplib import async_multiping  # noqa: PLC0415 — deferred para no romper si no está instalado

    results = await async_multiping(
        addresses=hosts,
        count=count,
        timeout=timeout,
        privileged=True,
    )
    logger.debug('ping_batch: %d hosts, %d alive',
                 len(results), sum(1 for h in results if h.is_alive))
    return [_host_to_dict(h) for h in results]


async def ping_single(ip: str, count: int, timeout: int) -> dict:
    """Ping a un solo host con detalle de paquetes enviados/recibidos."""
    from icmplib import async_ping  # noqa: PLC0415

    h = await async_ping(ip, count=count, timeout=timeout, privileged=True)
    return _host_to_dict(h, detail=True)


# ── SNMP Tráfico y Recursos ────────────────────────────────────────────────────

class SnmpMonitoringError(Exception):
    pass


def _counter32_diff(v2: int, v1: int) -> int:
    """Diferencia entre dos lecturas de contador de 32 bits manejando wrap-around."""
    return v2 - v1 if v2 >= v1 else (2 ** 32 + v2 - v1)


def _snmp_get_traffic_sync(ip: str, community: str, interface_index: int) -> tuple[int, int]:
    """Devuelve (in_octets, out_octets) via SNMP. Sync — usar con asyncio.to_thread."""
    try:
        from easysnmp import EasySNMPError, Session  # noqa: PLC0415
    except ImportError as exc:
        raise SnmpMonitoringError(
            'easysnmp no instalado. Requiere además: apt-get install -y snmp libsnmp-dev'
        ) from exc
    try:
        session = Session(hostname=ip, community=community, version=2, timeout=2, retries=1)
        results = session.get([
            f'1.3.6.1.2.1.2.2.1.10.{interface_index}',
            f'1.3.6.1.2.1.2.2.1.16.{interface_index}',
        ])
        return int(results[0].value), int(results[1].value)
    except EasySNMPError as exc:
        raise SnmpMonitoringError(f'SNMP tráfico {ip}: {exc}') from exc


async def _traffic_for_host(ip: str, community: str, interface_index: int) -> dict:
    """
    Dos lecturas de contador con 1 s de intervalo para calcular tasa real.
    Todos los hosts del batch ejecutan esta función en paralelo via asyncio.gather,
    por lo que el asyncio.sleep(1) es concurrente — el batch entero tarda ~1 s.
    """
    ts = datetime.now(timezone.utc).isoformat()
    try:
        t1 = time.monotonic()
        in1, out1 = await asyncio.to_thread(
            _snmp_get_traffic_sync, ip, community, interface_index,
        )
        await asyncio.sleep(1)
        t2 = time.monotonic()
        in2, out2 = await asyncio.to_thread(
            _snmp_get_traffic_sync, ip, community, interface_index,
        )
        delta = t2 - t1
        return {
            'ip':        ip,
            'down_bps':  max(0, int(_counter32_diff(in2, in1) / delta * 8)),
            'up_bps':    max(0, int(_counter32_diff(out2, out1) / delta * 8)),
            'timestamp': ts,
            'error':     None,
        }
    except SnmpMonitoringError as exc:
        logger.warning('SNMP tráfico %s: %s', ip, exc)
        return {'ip': ip, 'down_bps': None, 'up_bps': None, 'timestamp': ts, 'error': str(exc)}


async def snmp_traffic_batch(hosts: list[dict]) -> list[dict]:
    """Consulta tráfico de múltiples interfaces en paralelo."""
    return list(await asyncio.gather(*[
        _traffic_for_host(h['ip'], h['community'], h['interface_index'])
        for h in hosts
    ]))


def _snmp_get_resources_sync(ip: str, community: str) -> dict:
    """Devuelve CPU% y RAM en bytes via SNMP. Sync — usar con asyncio.to_thread."""
    try:
        from easysnmp import EasySNMPError, Session  # noqa: PLC0415
    except ImportError as exc:
        raise SnmpMonitoringError(
            'easysnmp no instalado. Requiere además: apt-get install -y snmp libsnmp-dev'
        ) from exc
    try:
        session = Session(hostname=ip, community=community, version=2, timeout=2, retries=1)
        results = session.get([
            '1.3.6.1.2.1.25.3.3.1.2.1',    # hrProcessorLoad — CPU %
            '1.3.6.1.2.1.25.2.3.1.4.65536', # hrStorageAllocationUnits — bytes/unidad
            '1.3.6.1.2.1.25.2.3.1.5.65536', # hrStorageSize — unidades totales
            '1.3.6.1.2.1.25.2.3.1.6.65536', # hrStorageUsed — unidades usadas
        ])
        cpu_pct     = float(results[0].value)
        alloc_unit  = int(results[1].value)
        ram_total   = int(results[2].value) * alloc_unit
        ram_used    = int(results[3].value) * alloc_unit
        ram_pct     = round(ram_used / ram_total * 100, 1) if ram_total > 0 else 0.0
        return {
            'cpu_pct':         cpu_pct,
            'ram_total_bytes': ram_total,
            'ram_used_bytes':  ram_used,
            'ram_pct':         ram_pct,
        }
    except EasySNMPError as exc:
        raise SnmpMonitoringError(f'SNMP recursos {ip}: {exc}') from exc


async def snmp_resources(ip: str, community: str) -> dict:
    """Consulta CPU y RAM del router via SNMP."""
    data = await asyncio.to_thread(_snmp_get_resources_sync, ip, community)
    return {'ip': ip, **data}
