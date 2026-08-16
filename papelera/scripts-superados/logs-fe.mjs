import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  conn.exec(
    'pm2 logs datafast-frontend --lines 60 --nostream 2>&1',
    { pty: false },
    (err, stream) => {
      if (err) { console.error(err.message); conn.end(); return; }
      stream.on('data', d => process.stdout.write(d.toString()));
      stream.stderr.on('data', d => process.stderr.write(d.toString()));
      stream.on('close', () => conn.end());
    }
  );
}).connect(VPS);
conn.on('error', e => console.error(e.message));
