// Fuente única de verdad para tipos de autenticación y tipo de servicio.
// Sincronizado con el backend: backend/src/common/constants/service-types.ts

export const AUTH_TYPES = [
  { val: 'pppoe',              label: 'PPPoE' },
  { val: 'amarre_ip_mac',      label: 'Amarre IP/MAC' },
  { val: 'amarre_ip_mac_dhcp', label: 'Amarre IP/MAC + DHCP Leases' },
] as const;

export type AuthTypeVal = (typeof AUTH_TYPES)[number]['val'];

export const TIPO_SERVICIO_CONTRATO = [
  { val: 'wisp', label: 'WISP — Radio / Antena' },
  { val: 'ftth', label: 'FTTH — Fibra Óptica' },
] as const;

export type TipoServicioContrato = 'wisp' | 'ftth';
