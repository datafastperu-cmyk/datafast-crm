import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const conn = new Client();
conn.on('ready', () => {
  // Verificar si el build compilado contiene 'mensajeria/campanas'
  const cmd = [
    'grep -r "mensajeria/campanas" /opt/datafast/frontend/.next/server --include="*.js" -l 2>/dev/null | head -3',
    'echo "---GIT---"',
    'cd /opt/datafast && git log --oneline -4',
    'echo "---PERMISOS_DB---"',
    // Ver si el permiso mensajeria:masiva existe en la tabla de permisos
    'psql -U datafast -d datafast_crm -c "SELECT nombre FROM permisos WHERE nombre LIKE \'%mensajer%\' LIMIT 10;" 2>/dev/null || echo "DB_CHECK_SKIPPED"',
  ].join(' && ');

  conn.exec(cmd, (err, s) => {
    if (err) { console.error(err.message); conn.end(); return; }
    s.on('data', d => process.stdout.write(d.toString()));
    s.stderr.on('data', d => process.stderr.write(d.toString()));
    s.on('close', () => conn.end());
  });
}).connect(VPS);

conn.on('error', e => { console.error('SSH:', e.message); process.exit(1); });
