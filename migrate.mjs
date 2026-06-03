import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  console.log('✓ SSH conectado');
  conn.exec('cd /opt/datafast/backend && NODE_OPTIONS="--max-old-space-size=512" npm run migration:run 2>&1', { pty: false }, (err, stream) => {
    if (err) { console.error('exec error:', err.message); conn.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', (code) => {
      console.log(`\n✓ Código: ${code}`);
      conn.end();
    });
  });
}).connect({
  host:     '149.34.48.224',
  port:     22,
  username: 'root',
  password: '10471687648',
  readyTimeout: 20000,
});
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
