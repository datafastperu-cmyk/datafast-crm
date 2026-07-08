import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const c = new Client();
const cmds = [
  `cd /opt/datafast && git pull origin main 2>&1 | tail -8`,
  `cd /opt/datafast/backend && NODE_OPTIONS='--max-old-space-size=2048' npm run build 2>&1 | tail -5`,
  `pm2 restart datafast-api-core && sleep 3 && pm2 status`,
  // El worker corre los crons (outbox-red, recovery, etc.) desde el MISMO dist del
  // backend. Si no se reinicia, queda con código viejo → comandos descartados.
  `pm2 restart datafast-worker-auxiliary && sleep 2 && pm2 status`,
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
