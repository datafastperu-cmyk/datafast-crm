import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  const cmd = [
    'ls /opt/datafast/frontend/.next/server/app/\\(dashboard\\)/mensajeria/ 2>/dev/null || echo "DIR_NOT_FOUND"',
    'echo "---SIDEBAR_BUILD---"',
    // Buscar el string Campañas en los chunks del layout compilado
    'grep -r "Campa" /opt/datafast/frontend/.next/server/app/\\(dashboard\\)/ --include="*.js" -l 2>/dev/null | head -5',
    'echo "---PERMISOS_TABLA---"',
    'PGPASSWORD=$(grep DB_PASSWORD /opt/datafast/backend/.env.production 2>/dev/null | cut -d= -f2) psql -U $(grep DB_USERNAME /opt/datafast/backend/.env.production 2>/dev/null | cut -d= -f2 | tr -d "\\r") -h localhost -d $(grep DB_DATABASE /opt/datafast/backend/.env.production 2>/dev/null | cut -d= -f2 | tr -d "\\r") -c "SELECT nombre FROM permisos WHERE nombre LIKE \'%mensajer%\';" 2>&1 | head -10',
  ].join(' && ');

  conn.exec(cmd, (err, s) => {
    if (err) { console.error(err.message); conn.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', () => conn.end());
  });
}).connect(VPS);

conn.on('error', e => { console.error('SSH:', e.message); process.exit(1); });
