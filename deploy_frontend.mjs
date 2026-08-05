import { ejecutarDespliegue } from './deploy-lib.mjs';

/**
 * Despliegue de sólo frontend.
 *
 * La mecánica (pipefail, propagación del código y la distinción entre fallo y resultado
 * desconocido) vive en `deploy-lib.mjs`, junto con los dos incidentes que la motivaron.
 * Aquí sólo se declaran los pasos.
 *
 * El `tail` se conserva en los pasos ruidosos: el problema nunca fue recortar la salida,
 * sino que ese recorte decidiera el veredicto.
 */
const PASOS = [
  'cd /opt/datafast',
  'git pull origin main 2>&1 | tail -5',
  'cd frontend',
  // Sin este paso, un cambio de dependencia NUNCA llega al servidor y el despliegue
  // reporta "aplicado" mientras sirve la versión anterior de la librería. Ocurrió al
  // corregir maplibre-gl: package.json decía 5.24.0 y el navegador seguía cargando 6.1.0.
  // Es idempotente y apenas cuesta cuando no hay cambios.
  'npm install --no-audit --no-fund 2>&1 | tail -5',
  "NODE_OPTIONS='--max-old-space-size=2048' NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -10",
  'pm2 restart datafast-frontend',
  'sleep 3',
  'pm2 status',
];

await ejecutarDespliegue({ pasos: PASOS, etiqueta: 'Frontend' });
