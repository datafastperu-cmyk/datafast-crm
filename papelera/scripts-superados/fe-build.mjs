import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado — rebuilding frontend...');
  const cmd = [
    'cd /opt/datafast && git pull origin main',
    'pm2 stop datafast-frontend 2>/dev/null || true',
    'cd /opt/datafast/frontend && NODE_OPTIONS="--max-old-space-size=1200" NEXT_TELEMETRY_DISABLED=1 npm run build 2>&1 | tail -20',
    'pm2 start datafast-frontend',
    'pm2 status',
  ].join(' && ');
  conn.exec(cmd, { pty: false }, (err, s) => {
    if (err) { console.error(err.message); conn.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', (code) => {
      console.log(`\n✓ Frontend build exit: ${code}`);
      conn.end();
    });
  });
}).connect(VPS);
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
