import { Client } from 'ssh2';

const BACKEND_CHECK  = 'cd /opt/datafast/backend  && NODE_OPTIONS="--max-old-space-size=1400" node_modules/.bin/tsc --noEmit 2>&1 | tail -30';
const FRONTEND_CHECK = 'cd /opt/datafast/frontend && NODE_OPTIONS="--max-old-space-size=1400" npx tsc --noEmit 2>&1 | tail -30';

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado');

  // Pull latest first
  conn.exec(
    'cd /opt/datafast/backend && git pull origin main && cd /opt/datafast/frontend && git pull origin main',
    { pty: false },
    (err, stream) => {
      if (err) { console.error(err.message); conn.end(); return; }
      stream.on('data', d => process.stdout.write(d.toString()));
      stream.stderr.on('data', d => process.stderr.write(d.toString()));
      stream.on('close', () => {
        console.log('\n── Backend tsc --noEmit ──────────────────────');
        conn.exec(BACKEND_CHECK, { pty: false }, (e2, s2) => {
          if (e2) { console.error(e2.message); conn.end(); return; }
          s2.on('data', d => process.stdout.write(d.toString()));
          s2.stderr.on('data', d => process.stderr.write(d.toString()));
          s2.on('close', (code) => {
            console.log(`\nBackend exit: ${code}`);
            console.log('\n── Frontend tsc --noEmit ─────────────────────');
            conn.exec(FRONTEND_CHECK, { pty: false }, (e3, s3) => {
              if (e3) { console.error(e3.message); conn.end(); return; }
              s3.on('data', d => process.stdout.write(d.toString()));
              s3.stderr.on('data', d => process.stderr.write(d.toString()));
              s3.on('close', (code2) => {
                console.log(`\nFrontend exit: ${code2}`);
                conn.end();
              });
            });
          });
        });
      });
    }
  );
}).connect({
  host:     '149.34.48.224',
  port:     22,
  username: 'root',
  password: '10471687648',
  readyTimeout: 20000,
});
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
