import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

/**
 * Despliegue rápido de sólo backend (sin migraciones ni frontend).
 *
 * `set -o pipefail` NO es opcional. Incidente 2026-08-01: el paso de compilación termina
 * en `| tail -20`, y en una tubería bash devuelve por defecto el código del ÚLTIMO comando
 * —`tail`, que siempre tiene éxito—. Un error de compilación no rompía la cadena de `&&`:
 * PM2 se reiniciaba igual, arrancando el binario ANTERIOR, y el script salía con 0.
 *
 * Es el peor caso de los tres scripts: reiniciar tras una compilación fallida hace que el
 * proceso levante código viejo mientras el repositorio dice otra cosa — la misma
 * discordancia entre lo declarado y lo real que persigue el resto del proyecto.
 *
 * Verificado contra el shell del servidor (bash): sin la opción, `false | tail -1`
 * devuelve 0; con ella, 1.
 */
const PASOS = [
  'cd /opt/datafast && git pull origin main',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc -p tsconfig.build.json --skipLibCheck 2>&1 | tail -20',
  'pm2 restart datafast-api-core --update-env',
  'pm2 status',
];

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado');
  const cmd = `set -o pipefail; ${PASOS.join(' && ')}`;

  conn.exec(cmd, { pty: false }, (err, s) => {
    if (err) { console.error(err.message); conn.end(); process.exitCode = 1; return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', (code) => {
      // El veredicto se PROPAGA. Antes se imprimía "✓ Backend deploy exit: 1" —un tilde
      // verde delante de un fallo— y el proceso salía con 0.
      if (code === 0) {
        console.log('\n✓ Backend desplegado');
      } else {
        console.error(
          `\n✗ DEPLOY DE BACKEND FALLIDO (código ${code}). ` +
          `El proceso sigue con la versión anterior.`,
        );
        process.exitCode = code ?? 1;
      }
      conn.end();
    });
  });
}).connect(VPS);

conn.on('error', e => { console.error('SSH error:', e.message); process.exitCode = 1; });
