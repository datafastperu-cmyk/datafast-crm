import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  const cmd = [
    // Ver crash reciente antes de reiniciar
    'tail -50 /opt/datafast/logs/backend-error.log | grep -v RosException | tail -30',
    'echo "===OUT_TAIL==="',
    'tail -30 /opt/datafast/logs/backend-out.log | grep -i "error\\|exception\\|circular\\|bootstrap\\|starting\\|fatal" | tail -20',
    'echo "===RESTART==="',
    'cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=1400" pm2 restart datafast-backend --update-env',
    'sleep 8',
    'pm2 list --no-color',
    'echo "===STARTUP_LOG==="',
    'tail -40 /opt/datafast/logs/backend-out.log',
    'echo "===ERROR_TAIL==="',
    'tail -20 /opt/datafast/logs/backend-error.log | grep -v RosException',
  ].join(' && ');

  conn.exec(cmd, (err, s) => {
    if (err) { console.error(err.message); conn.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', code => { console.log('\nExit:', code); conn.end(); });
  });
}).connect(VPS);

conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
