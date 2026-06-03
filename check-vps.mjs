import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  conn.exec(
    'cd /opt/datafast/backend && git log --oneline -3 && echo "---" && cd /opt/datafast/frontend && git log --oneline -3 && echo "---" && pm2 list --no-color 2>/dev/null | grep -E "name|datafast"',
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
