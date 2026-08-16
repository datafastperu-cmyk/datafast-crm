import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH — pull + build + restart...');
  const cmd = [
    'cd /opt/datafast/frontend && git pull origin main',
    'pm2 stop datafast-frontend',
    'NODE_OPTIONS="--max-old-space-size=1200" NEXT_TELEMETRY_DISABLED=1 npm run build',
    'pm2 start datafast-frontend',
    'pm2 status --no-color 2>/dev/null | grep datafast',
  ].join(' && ');

  conn.exec(cmd, { pty: false }, (err, stream) => {
    if (err) { console.error(err.message); conn.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', (code) => {
      console.log(`\n✓ Terminado, código: ${code}`);
      conn.end();
    });
  });
}).connect(VPS);
conn.on('error', e => console.error(e.message));
