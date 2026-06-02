"""
Mapeo de OIDs SNMP estándar para OLTs VSOL y CData.

Convención de índice de instancia:
  Cada OID base se extiende con <slot>.<port>.<onu_id> para apuntar
  a una ONU concreta.
  Ejemplo: rx_power, slot=0 port=1 onu_id=3
    VSOL → 1.3.6.1.4.1.37950.1.1.5.12.2.1.2.0.1.3

Factor de escala de potencia óptica:
  Los enteros SNMP se dividen por SNMP_POWER_SCALE para obtener dBm.
  Ejemplo: -2540 → -25.40 dBm
"""
from app.schemas.olt import OltBrand

SNMP_POWER_SCALE = 100  # entero_snmp / 100 = valor en dBm

SNMP_OID_MAP: dict[OltBrand, dict[str, str]] = {
    OltBrand.VSOL: {
        'provision_sn': '1.3.6.1.4.1.37950.1.1.5.12.1.1',
        'onu_status':   '1.3.6.1.4.1.37950.1.1.5.12.1.25',
        'rx_power':     '1.3.6.1.4.1.37950.1.1.5.12.2.1.2',
        'tx_power':     '1.3.6.1.4.1.37950.1.1.5.12.2.1.3',
    },
    OltBrand.CDATA: {
        'provision_sn': '1.3.6.1.4.1.34592.1.3.3.1.1.1',
        'onu_status':   '1.3.6.1.4.1.34592.1.3.3.1.1.2',
        'rx_power':     '1.3.6.1.4.1.34592.1.3.3.1.3.1',
        'tx_power':     '1.3.6.1.4.1.34592.1.3.3.1.3.2',
    },
}
