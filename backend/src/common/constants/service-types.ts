// ─── Tipos de autenticación de abonado ────────────────────────
export enum AuthType {
  PPPOE              = 'pppoe',
  AMARRE_IP_MAC      = 'amarre_ip_mac',
  AMARRE_IP_MAC_DHCP = 'amarre_ip_mac_dhcp',
}

// Array para selectores en wizard (fuente única — frontend y backend importan de aquí)
export const AUTH_TYPES = [
  { val: AuthType.PPPOE,              label: 'PPPoE'                       },
  { val: AuthType.AMARRE_IP_MAC,      label: 'Amarre IP/MAC'               },
  { val: AuthType.AMARRE_IP_MAC_DHCP, label: 'Amarre IP/MAC + DHCP Leases' },
] as const;

// ─── Tipo de servicio del contrato ────────────────────────────
// Nota: clientes pueden tener 'mixto' (derivado) pero un contrato
// individual siempre es wisp o ftth.
export enum TipoServicioContrato {
  WISP = 'wisp',
  FTTH = 'ftth',
}

// ─── Método de aprovisionamiento de ONU ──────────────────────
export enum MetodoAprovisionamiento {
  SMARTOLT   = 'smartolt',
  NATIVO_SSH  = 'nativo_ssh',
  NATIVO_SNMP = 'nativo_snmp',
}
