import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const c = new Client();
const cmds = [
  `cd /opt/datafast && git pull origin main 2>&1 | tail -8`,
  `cd /opt/datafast/backend && NODE_OPTIONS='--max-old-space-size=2048' npm run build 2>&1 | tail -5`,
  // B-12/B-13: recarga verificada compartida; cubre api-core y worker de una vez.
  `source /opt/datafast/scripts/lib/pm2-recargar.sh && pm2_recargar_backend /opt/datafast/ecosystem.config.js`,
  // El worker ya va incluido arriba: corre los crons (outbox-red, recovery, etc.) desde el
  // MISMO dist del backend, y `pm2_recargar_backend` recarga todo lo que el ecosystem
  // declara como api-core o worker. Reiniciarlo aparte era duplicar el reinicio.
  `pm2 restart olt-automation-service && sleep 2 && pm2 status`,
];

c.on('ready', () => {
  let idx = 0;
  const run = () => {
    if (idx >= cmds.length) { c.end(); return; }
    const n = ++idx;
    console.log(`\n─── [${n}/${cmds.length}] ───────────────────────────────`);
    c.exec(cmds[n - 1], (err, stream) => {
      let out = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => out += d);
      stream.on('close', () => { console.log(out.trim()); run(); });
    });
  };
  run();
});
c.connect(VPS);
