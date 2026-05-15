// ─── Clave pública RSA-2048 para verificación de licencias ────────────────────
// La clave PRIVADA vive exclusivamente en el servidor de licencias.
// Cambiar esta clave invalida TODAS las licencias emitidas previamente.
export const LICENCIA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx2lDjBl2OhIQtujscwXS
1fhQwT1ubEK3BSI3QsKbniL+KOK43JHtFb5H6POSZ4xOLg50mGua36DUE+Ft2j/h
tfXetHttV7UsRCjLVKC1XB0K7QQWU9g9rB35vh+g/Kfvt8MKKPwfi8mobEaDpE96
/Xz+aasbS7GGuvAVDmpyG0ASSEAuVZtBZQN+xZVBA+hhAi/EYpvphFTwKdnxeI9z
JA2gZXSjrJC3AgnI3wDZvjm7MaQEXohaoq0neY8tVb2j88RJ8Esv+Cm4hF+9tD9D
8cFDY9Elv7Vz/mFRaqqz1T0WqsKjkXegmB8xY0y5dV8BLRu1Dj9NcnzRSjuzaHX6
LwIDAQAB
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
