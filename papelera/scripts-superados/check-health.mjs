import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  const cmd = [
    'pm2 list --no-color',
    'echo "---HEALTH---"',
    'curl -s -w "\\nHTTP_STATUS:%{http_code}" http://localhost:3000/health',
    'echo "---NGINX---"',
    'nginx -t 2>&1 | head -5',
    'echo "---NEST_START---"',
    'grep -i "nest\\|error\\|exception\\|circular\\|undefined\\|null" /opt/datafast/logs/backend-out.log 2>/dev/null | tail -20',
  ].join(' && ');

  conn.exec(cmd, (err, s) => {
    if (err) { console.error(err.message); conn.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', () => conn.end());
  });
}).connect(VPS);

conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
