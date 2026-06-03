// vps.config.mjs — Lee credenciales de .vps.env (gitignored). No hardcodea nada.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR = dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(resolve(DIR, file), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch {}
  return out;
}

const cfg = loadEnv('.vps.env');

const host = cfg.VPS_HOST || process.env.VPS_HOST;
const pass = cfg.VPS_PASS || process.env.VPS_PASS;

if (!host || !pass) {
  console.error('Error: crea .vps.env con VPS_HOST y VPS_PASS (ver .vps.env.example)');
  process.exit(1);
}

export const VPS = {
  host,
  port:         Number(cfg.VPS_PORT || process.env.VPS_PORT || 22),
  username:     cfg.VPS_USER || process.env.VPS_USER || 'root',
  password:     pass,
  readyTimeout: 20000,
};
