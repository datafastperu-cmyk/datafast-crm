import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const c = new Client();

c.on('ready', () => {
  const cmd = `cd /opt/datafast && git pull origin main 2>&1 | tail -5 && cd frontend && NODE_OPTIONS='--max-old-space-size=2048' npm run build 2>&1 | tail -10 && pm2 restart datafast-frontend && sleep 3 && pm2 status`;
  console.log('Rebuilding frontend + restarting...\n');
  c.exec(cmd, (err, stream) => {
    let out = '';
    stream.on('data', d => { out += d; process.stdout.write(d.toString()); });
    stream.stderr.on('data', d => { out += d; process.stderr.write(d.toString()); });
    stream.on('close', () => { c.end(); });
  });
});

c.connect(VPS);
