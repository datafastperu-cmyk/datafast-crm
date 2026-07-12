// Países con una sola zona horaria — selección directa país→timezone.
// Países multi-zona (EE.UU., Brasil, México, etc.) no aplican aquí: el
// ERP se instala por país/región única, y el campo zona horaria queda
// editable para cubrir esos casos borde.
export interface PaisTimezone {
  codigo:   string; // ISO 3166-1 alpha-2
  nombre:   string;
  timezone: string; // IANA
}

export const PAISES_TIMEZONE: PaisTimezone[] = [
  { codigo: 'PE', nombre: 'Perú',        timezone: 'America/Lima' },
  { codigo: 'EC', nombre: 'Ecuador',     timezone: 'America/Guayaquil' },
  { codigo: 'CO', nombre: 'Colombia',    timezone: 'America/Bogota' },
  { codigo: 'BO', nombre: 'Bolivia',     timezone: 'America/La_Paz' },
  { codigo: 'CL', nombre: 'Chile',       timezone: 'America/Santiago' },
  { codigo: 'PY', nombre: 'Paraguay',    timezone: 'America/Asuncion' },
  { codigo: 'UY', nombre: 'Uruguay',     timezone: 'America/Montevideo' },
  { codigo: 'AR', nombre: 'Argentina',   timezone: 'America/Argentina/Buenos_Aires' },
  { codigo: 'VE', nombre: 'Venezuela',   timezone: 'America/Caracas' },
  { codigo: 'PA', nombre: 'Panamá',      timezone: 'America/Panama' },
  { codigo: 'CR', nombre: 'Costa Rica',  timezone: 'America/Costa_Rica' },
  { codigo: 'NI', nombre: 'Nicaragua',   timezone: 'America/Managua' },
  { codigo: 'HN', nombre: 'Honduras',    timezone: 'America/Tegucigalpa' },
  { codigo: 'SV', nombre: 'El Salvador', timezone: 'America/El_Salvador' },
  { codigo: 'GT', nombre: 'Guatemala',   timezone: 'America/Guatemala' },
  { codigo: 'DO', nombre: 'Rep. Dominicana', timezone: 'America/Santo_Domingo' },
  { codigo: 'ES', nombre: 'España',      timezone: 'Europe/Madrid' },
];

export function timezoneDePais(codigo: string): string | null {
  return PAISES_TIMEZONE.find((p) => p.codigo === codigo)?.timezone ?? null;
}
