import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const COMMANDS = [
  'cd /opt/datafast/backend && git pull origin main',
  'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc --noEmit 2>&1 | tail -5',
  'pm2 stop datafast-backend 2>/dev/null; cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc --build && pm2 start datafast-backend',
  'cd /opt/datafast/frontend && git pull origin main',
  'cd /opt/datafast/frontend && NODE_OPTIONS="--max-old-space-size=1400" NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -10',
  'pm2 restart datafast-frontend',
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
