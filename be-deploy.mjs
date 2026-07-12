import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado');
  const cmd = [
    'cd /opt/datafast && git pull origin main',
    'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc -p tsconfig.build.json --skipLibCheck 2>&1 | tail -20',
    'pm2 restart datafast-api-core --update-env',
    'pm2 status',
  ].join(' && ');
  conn.exec(cmd, { pty: false }, (err, s) => {
    if (err) { console.error(err.message); conn.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', (code) => {
      console.log(`\n✓ Backend deploy exit: ${code}`);
      conn.end();
    });
  });
}).connect(VPS);
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
