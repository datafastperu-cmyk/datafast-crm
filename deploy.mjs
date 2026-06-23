import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const COMMANDS = [
  'git -C /opt/datafast checkout -- installer/ 2>/dev/null || true',
  'cd /opt/datafast/backend && git pull origin main',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc --noEmit 2>&1 | tail -5',
  'cd /opt/datafast/backend && npm run migration:run 2>&1 | tail -20',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=2048" node_modules/.bin/tsc --build && pm2 restart datafast-api-core datafast-worker-auxiliary',
  'cd /opt/datafast/frontend && git pull origin main',
  'cd /opt/datafast/frontend && npm install --production=false 2>&1 | tail -5',
  'cd /opt/datafast/frontend && NODE_OPTIONS="--max-old-space-size=1400" NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -10',
  'pm2 startOrRestart /opt/datafast/ecosystem.config.js --only datafast-frontend || pm2 restart datafast-frontend || true',
  'pm2 status',
].join(' && ');

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado');
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
