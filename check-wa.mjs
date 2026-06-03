import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  const cmd = [
    // versión instalada en VPS
    'node -e "console.log(require(\'/opt/datafast/backend/node_modules/whatsapp-web.js/package.json\').version)"',
    // última versión disponible en npm
    'npm view whatsapp-web.js version 2>/dev/null || echo "npm view failed"',
    // versiones recientes disponibles
    'npm view whatsapp-web.js versions --json 2>/dev/null | node -e "const d=require(\'fs\').readFileSync(\'/dev/stdin\',\'utf8\');const v=JSON.parse(d);console.log(\'Ultimas 5:\',v.slice(-5).join(\', \'))" 2>/dev/null || echo "failed"',
  ].join(' && echo "---" && ');

  conn.exec(cmd, { pty: false }, (err, s) => {
    if (err) { console.error(err.message); conn.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', () => conn.end());
  });
}).connect(VPS);
conn.on('error', e => { console.error('SSH error:', e.message); process.exit(1); });
