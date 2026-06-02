"""
Conector SNMP v2c (pysnmp hlapi) para OLTs VSOL y CData.

Funciones síncronas — invocar desde asyncio.to_thread() en main.py.
No importa Netmiko ni textfsm; completamente aislado del flujo SSH.

pysnmp se importa de forma diferida dentro de cada función para que
una instalación sin pysnmp no rompa los flujos Huawei/ZTE.
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)

_SNMP_TIMEOUT = 2   # segundos por intento — UDP no requiere handshake
_SNMP_RETRIES = 2   # reintentos ante pérdida de paquete en la VPN


class SnmpError(Exception):
    """Error controlado en operación SNMP — se convierte en ProvisioningError en provisioning.py."""


def get_snmp_value(
    ip:        str,
    community: str,
    oid:       str,
    port:      int = 161,
) -> Any:
    """
    SNMP GET v2c — retorna el objeto pysnmp del OID solicitado.
    Lanza SnmpError ante error de importación, red o respuesta SNMP con error.
    """
    try:
        from pysnmp.hlapi import (                      # noqa: PLC0415
            CommunityData, ContextData, ObjectIdentity,
            ObjectType, SnmpEngine, UdpTransportTarget, getCmd,
        )
    except ImportError as exc:
        raise SnmpError(
            'pysnmp no está instalado. Ejecutar: pip install "pysnmp>=4.4.12"'
        ) from exc

    try:
        err_ind, err_status, err_index, var_binds = next(
            getCmd(
                SnmpEngine(),
                CommunityData(community, mpModel=1),   # mpModel=1 → SNMPv2c
                UdpTransportTarget((ip, port), timeout=_SNMP_TIMEOUT, retries=_SNMP_RETRIES),
                ContextData(),
                ObjectType(ObjectIdentity(oid)),
            )
        )
    except Exception as exc:
        raise SnmpError(f'SNMP GET {ip}/{oid}: {exc}') from exc

    if err_ind:
        raise SnmpError(f'SNMP GET {ip}/{oid}: {err_ind}')
    if err_status:
        at = var_binds[int(err_index) - 1][0] if err_index else '?'
        raise SnmpError(f'SNMP GET {ip}/{oid}: {err_status.prettyPrint()} en {at}')

    return var_binds[0][1]


def set_snmp_octet_string(
    ip:        str,
    community: str,
    oid:       str,
    value:     str,
    port:      int = 161,
) -> None:
    """
    SNMP SET de tipo OctetString.

    `value` es una cadena ASCII (ej: SN de 16 chars de la ONU).
    Lanza SnmpError ante error de importación, red, permiso o respuesta SNMP con error.
    """
    try:
        from pysnmp.hlapi import (                      # noqa: PLC0415
            CommunityData, ContextData, ObjectIdentity,
            ObjectType, OctetString, SnmpEngine, UdpTransportTarget, setCmd,
        )
    except ImportError as exc:
        raise SnmpError(
            'pysnmp no está instalado. Ejecutar: pip install "pysnmp>=4.4.12"'
        ) from exc

    try:
        err_ind, err_status, err_index, var_binds = next(
            setCmd(
                SnmpEngine(),
                CommunityData(community, mpModel=1),
                UdpTransportTarget((ip, port), timeout=_SNMP_TIMEOUT, retries=_SNMP_RETRIES),
                ContextData(),
                ObjectType(ObjectIdentity(oid), OctetString(value.encode('ascii'))),
            )
        )
    except Exception as exc:
        raise SnmpError(f'SNMP SET {ip}/{oid}: {exc}') from exc

    if err_ind:
        raise SnmpError(f'SNMP SET {ip}/{oid}: {err_ind}')
    if err_status:
        at = var_binds[int(err_index) - 1][0] if err_index else '?'
        raise SnmpError(f'SNMP SET {ip}/{oid}: {err_status.prettyPrint()} en {at}')
