import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const CMDS = [
  'pm2 status',
  'echo "=== ULTIMOS LOGS BACKEND ==="',
  'tail -5 /opt/datafast/logs/backend-out-0.log 2>/dev/null',
].join(' && ');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(CMDS, { pty: false }, (err, stream) => {
    if (err) { console.error(err.message); conn.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect(VPS);
conn.on('error', e => console.error('SSH error:', e.message));
