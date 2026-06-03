import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  const cmd = [
    'cd /opt/datafast && git pull origin main',
    'pm2 stop datafast-backend 2>/dev/null || true',
    'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc --noEmit 2>&1; echo "TSC_EXIT:$?"',
  ].join(' && ');
  conn.exec(cmd, (err, s) => {
    if (err) { console.error(err.message); conn.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', code => { console.log('\n✓ TypeCheck exit:', code); conn.end(); });
  });
}).connect({ host: '149.34.48.224', port: 22, username: 'root', password: '10471687648', readyTimeout: 20000 });
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
