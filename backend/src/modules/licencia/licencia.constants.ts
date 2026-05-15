// ─── Clave pública RSA-2048 para verificación de licencias ────────────────────
// La clave PRIVADA vive exclusivamente en el servidor de licencias.
// Cambiar esta clave invalida TODAS las licencias emitidas previamente.
export const LICENCIA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxVjFjdNfpPlHUyV4FfyG
g8jcndwNCrIW1oSR0H7yKukD6IihdlgFt2NWez6dr2vjB4x9yZWdyaf+7cQzLWAo
fG6Nsh9bEEe5za8bSngHZibUJpadgQ8nR/sU1lCKDWTmaphfBKHVpnhbgJx2beyb
N+iWFh2R0jCObk0asv73sJQx+ZKwGJJLPp7M6TpUgg3NOoPEIKwqxZy0wj4LYLd9
yeFx7ZlXRkLV00ef9nIxeTrgNHP4E7RyqIiOQV0nYRFXt4KN+0Sq3eyZo0ajLL4O
5eLjR+v/b4QfhePq/cPNUS4ZHJbzC5YTnVerQoh9oNFduqBVql/CF7pQu7AZSDx9
EQIDAQAB
-----END PUBLIC KEY-----`;

// ─── Emisor válido en el JWT ───────────────────────────────────────────────────
export const LICENCIA_ISSUER = 'DataFast-LS-v1';

// ─── Salt para el hash de machine ID ─────────────────────────────────────────
// Debe coincidir con el salt en tools/generate-license.js
export const MACHINE_ID_SALT = 'dft-2026-ls-salt';

// ─── Días de gracia offline antes de bloquear ─────────────────────────────────
export const GRACE_PERIOD_DAYS = 7;

// ─── URL del servidor de validación online (revocación) ───────────────────────
export const LICENCIA_VALIDATION_URL = 'https://licenses.datafast.pe/v1/validate';

// ─── Definición de planes ─────────────────────────────────────────────────────
export const PLANES_LICENCIA = {
  basic: {
    nombre:      'Básica',
    maxClientes: 100,
    color:       '#6B7280',
    features:    ['clientes', 'facturacion', 'pagos', 'mikrotik'],
  },
  silver: {
    nombre:      'Plata',
    maxClientes: 300,
    color:       '#64748B',
    features:    ['clientes', 'facturacion', 'pagos', 'mikrotik', 'smartolt', 'notificaciones', 'reportes'],
  },
  gold: {
    nombre:      'Oro',
    maxClientes: -1,    // -1 = ilimitado
    color:       '#F59E0B',
    features:    ['*'],  // todos los módulos
  },
} as const;

export type PlanCode = keyof typeof PLANES_LICENCIA;

// ─── Rutas que NO requieren licencia válida ───────────────────────────────────
export const BYPASS_LICENSE_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/health',
  '/api/v1/admin/licencia',
];
