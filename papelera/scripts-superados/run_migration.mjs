import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

const c = new Client();

c.on('ready', () => {
  const cmd = [
    'cd /opt/datafast && git pull origin main 2>&1 | tail -3',
    'cd /opt/datafast/backend && TS_NODE_PROJECT=tsconfig.migration.json npx typeorm-ts-node-commonjs migration:run -d src/config/datasource.ts 2>&1',
    'echo MIGRATION_DONE',
  ].join(' && ');

  c.exec(cmd, (err, stream) => {
    if (err) { console.error(err.message); c.end(); return; }
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => c.end());
  });
}).connect(VPS);

c.on('error', e => console.error('ERR:', e.message));
