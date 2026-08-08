import { ejecutarDespliegue } from './deploy-lib.mjs';

/**
 * Despliegue rápido de sólo backend (sin migraciones ni frontend).
 *
 * La mecánica vive en `deploy-lib.mjs`. Aquí sólo se declaran los pasos.
 *
 * De los tres scripts, éste era el más peligroso antes de `pipefail`: la compilación
 * termina en `| tail -20`, así que un error de `tsc` no rompía la cadena y PM2 se
 * reiniciaba igual, levantando el binario ANTERIOR mientras el repositorio decía otra cosa.
 */
const PASOS = [
  'cd /opt/datafast && git pull origin main',
  // Un cambio de dependencia no llega al servidor sin esto, y el despliegue reporta
  // "aplicado" mientras corre con la version anterior. Idempotente.
  'cd /opt/datafast/backend && npm install --no-audit --no-fund 2>&1 | tail -5',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc -p tsconfig.build.json --skipLibCheck 2>&1 | tail -20',
  // B-12: era , el patrón exacto que el
  // 2026-08-06 dejó al worker sin su PORT y lo metió en bucle. La recarga verificada es
  // ahora la misma función que usa update.sh.
  'source /opt/datafast/scripts/lib/pm2-recargar.sh && pm2_recargar_backend /opt/datafast/ecosystem.config.js',
  'pm2 status',
];

await ejecutarDespliegue({ pasos: PASOS, etiqueta: 'Backend' });
