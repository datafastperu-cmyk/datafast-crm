import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

// Deploy rapido: git pull + build backend + restart + build frontend + restart
const COMMANDS = [
  'cd /opt/datafast && git pull origin main 2>&1 | tail -5',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=2048" node_modules/.bin/tsc --build 2>&1 | tail -5',
  'pm2 restart datafast-api-core datafast-worker-auxiliary',
  'cd /opt/datafast/frontend && rm -rf .next && NODE_OPTIONS="--max-old-space-size=2048" NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -15',
  'pm2 startOrRestart /opt/datafast/ecosystem.config.js --only datafast-frontend || pm2 restart datafast-frontend || true',
  'pm2 status',
].join(' && ');

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado (deploy-quick)');
  conn.exec(COMMANDS, { pty: false }, (err, stream) => {
    if (err) { console.error('exec error:', err.message); conn.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', (code) => {
      console.log(`\n✓ Proceso terminado, código: ${code}`);
      conn.end();
    });
  });
}).connect(VPS);
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
