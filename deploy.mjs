import { ejecutarDespliegue } from './deploy-lib.mjs';

/**
 * Despliegue completo: backend + migraciones + frontend.
 *
 * La mecánica (pipefail, propagación del código y la distinción entre fallo y resultado
 * desconocido) vive en `deploy-lib.mjs`, junto con los dos incidentes que la motivaron.
 *
 * El paso más delicado es `migration:run`: antes estaba enmascarado por `| tail -20`, así
 * que una migración fallida dejaba seguir el despliegue y arrancaba el backend contra un
 * esquema a medias.
 */
const PASOS = [
  // `|| true` legítimo: si `installer/` no tiene cambios locales no hay nada que revertir,
  // y eso no es un fallo del despliegue.
  'git -C /opt/datafast checkout -- installer/ 2>/dev/null || true',

  'cd /opt/datafast/backend && git pull origin main',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc --noEmit 2>&1 | tail -5',
  'cd /opt/datafast/backend && npm run migration:run 2>&1 | tail -20',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=2048" node_modules/.bin/tsc --build',
  // B-12/B-13: reiniciar por nombre no verificaba nada. Definición única en scripts/lib.
  'source /opt/datafast/scripts/lib/pm2-recargar.sh && pm2_recargar_backend /opt/datafast/ecosystem.config.js',

  'cd /opt/datafast/frontend && git pull origin main',
  'cd /opt/datafast/frontend && npm install --production=false 2>&1 | tail -5',
  'cd /opt/datafast/frontend && NODE_OPTIONS="--max-old-space-size=1400" NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -10',

  // Fallback entre las dos formas de arrancar, SIN `|| true` final: si ninguna levanta el
  // frontend, el despliegue no funcionó y debe reportarse como tal.
  'pm2 startOrRestart /opt/datafast/ecosystem.config.js --only datafast-frontend || pm2 restart datafast-frontend',

  'pm2 status',
];

await ejecutarDespliegue({ pasos: PASOS, etiqueta: 'Completo (backend + migraciones + frontend)' });
