import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

/**
 * Despliegue completo (backend + migraciones + frontend).
 *
 * `set -o pipefail` NO es opcional. Incidente 2026-08-01: varios pasos terminaban en
 * `| tail -N`, y en una tubería bash devuelve por defecto el código del ÚLTIMO comando
 * —`tail`, que siempre tiene éxito—. Así, un `git pull` fallido no rompía la cadena de
 * `&&`: el script recompilaba el código VIEJO, reiniciaba PM2 y **salía con código 0**.
 * El deploy informó éxito sin haber desplegado nada.
 *
 * Aquí era peor que en el frontend, porque `npm run migration:run` también estaba
 * enmascarado: una migración fallida habría dejado seguir el despliegue y arrancado el
 * backend contra un esquema a medias.
 *
 * Verificado contra el shell del servidor (bash): sin la opción, `false | tail -1`
 * devuelve 0; con ella, 1.
 *
 * El `tail` se conserva en todos los pasos: el problema nunca fue recortar la salida,
 * sino que ese recorte decidiera el veredicto.
 */
const PASOS = [
  // `|| true` legítimo: si `installer/` no tiene cambios locales, no hay nada que revertir
  // y eso no es un fallo del despliegue.
  'git -C /opt/datafast checkout -- installer/ 2>/dev/null || true',

  'cd /opt/datafast/backend && git pull origin main',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc --noEmit 2>&1 | tail -5',
  'cd /opt/datafast/backend && npm run migration:run 2>&1 | tail -20',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=2048" node_modules/.bin/tsc --build && pm2 restart datafast-api-core datafast-worker-auxiliary',

  'cd /opt/datafast/frontend && git pull origin main',
  'cd /opt/datafast/frontend && npm install --production=false 2>&1 | tail -5',
  'cd /opt/datafast/frontend && NODE_OPTIONS="--max-old-space-size=1400" NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -10',

  // El fallback entre las dos formas de arrancar sigue siendo válido, pero SIN el
  // `|| true` final: si ninguna de las dos consigue levantar el frontend, el despliegue
  // no funcionó y debe reportarse como tal.
  'pm2 startOrRestart /opt/datafast/ecosystem.config.js --only datafast-frontend || pm2 restart datafast-frontend',

  'pm2 status',
];

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado');
  const cmd = `set -o pipefail; ${PASOS.join(' && ')}`;

  conn.exec(cmd, { pty: false }, (err, stream) => {
    if (err) { console.error('exec error:', err.message); conn.end(); process.exitCode = 1; return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', (code) => {
      // El veredicto se PROPAGA. Antes se imprimía el código y siempre se salía con 0, así
      // que ni una persona ni un automatismo podían distinguir un despliegue real de uno
      // que no ocurrió.
      if (code === 0) {
        console.log('\n✓ Despliegue completo');
      } else {
        console.error(
          `\n✗ DESPLIEGUE FALLIDO (código ${code}).\n` +
          `  El servidor puede haber quedado con la versión anterior. Revisa la salida de\n` +
          `  arriba: el primer paso que falló es donde se cortó la cadena.`,
        );
        process.exitCode = code ?? 1;
      }
      conn.end();
    });
  });
}).connect(VPS);

conn.on('error', e => { console.error('SSH error:', e.message); process.exitCode = 1; });
