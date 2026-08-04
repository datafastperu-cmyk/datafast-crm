import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const c = new Client();

/**
 * `set -o pipefail` NO es opcional aquí.
 *
 * Incidente 2026-08-01: este script hacía `git pull origin main 2>&1 | tail -5 && ...`.
 * En una tubería, bash devuelve por defecto el código del ÚLTIMO comando —`tail`, que
 * siempre tiene éxito—, así que un `git pull` fallido no rompía la cadena: el script
 * recompilaba el código VIEJO, reiniciaba PM2 y **salía con código 0**. El deploy informó
 * éxito y no había desplegado nada; sólo se detectó comparando el commit en la VPS a mano.
 *
 * Con `pipefail` el código de salida es el del primer comando que falla, así que el `&&`
 * corta la cadena donde corresponde. Verificado contra el shell del servidor (bash):
 * sin la opción `false | tail -1` da 0; con ella, 1.
 *
 * El `tail` se conserva: el problema nunca fue recortar la salida, sino que ese recorte
 * decidiera el veredicto.
 */
const PASOS = [
  'cd /opt/datafast',
  'git pull origin main 2>&1 | tail -5',
  'cd frontend',
  "NODE_OPTIONS='--max-old-space-size=2048' npm run build 2>&1 | tail -10",
  'pm2 restart datafast-frontend',
  'sleep 3',
  'pm2 status',
];

c.on('ready', () => {
  const cmd = `set -o pipefail; ${PASOS.join(' && ')}`;
  console.log('Rebuilding frontend + restarting...\n');
  c.exec(cmd, (err, stream) => {
    if (err) { console.error('exec error:', err.message); c.end(); process.exitCode = 1; return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', (code) => {
      // El código de salida se PROPAGA. Antes se descartaba, así que quien invocara este
      // script —persona o automatismo— no tenía forma de saber si el deploy ocurrió.
      if (code === 0) {
        console.log('\n✓ Frontend desplegado');
      } else {
        console.error(`\n✗ DEPLOY FALLIDO (código ${code}). El servidor sigue con la versión anterior.`);
        process.exitCode = code ?? 1;
      }
      c.end();
    });
  });
});

c.on('error', (e) => { console.error('SSH error:', e.message); process.exitCode = 1; });
c.connect(VPS);
