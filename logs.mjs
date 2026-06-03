import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  conn.exec(
    'pm2 logs datafast-backend --lines 80 --nostream 2>&1',
    { pty: false },
    (err, stream) => {
      if (err) { console.error(err.message); conn.end(); return; }
      stream.on('data', d => process.stdout.write(d.toString()));
      stream.stderr.on('data', d => process.stderr.write(d.toString()));
      stream.on('close', () => conn.end());
    }
  );
}).connect({ host: '149.34.48.224', port: 22, username: 'root', password: '10471687648', readyTimeout: 15000 });
conn.on('error', e => console.error(e.message));
