import { Client } from 'ssh2';
import { VPS } from './vps.config.mjs';

/**
 * Ejecuta una cadena de pasos en el VPS y devuelve un VEREDICTO, no un booleano.
 *
 * Dos incidentes distintos motivaron este archivo, y hacen falta los dos para entender por
 * qué el resultado tiene tres clases y no dos:
 *
 * 1. **2026-08-01 — el despliegue que mintió.** Los scripts hacían
 *    `git pull ... | tail -5 && npm run build && pm2 restart`. En una tubería bash devuelve
 *    el código del ÚLTIMO comando (`tail`, siempre 0), así que un pull fallido no rompía la
 *    cadena: se recompilaba el código VIEJO, se reiniciaba PM2 y se salía con 0. Se corrigió
 *    con `set -o pipefail`.
 *
 * 2. **Horas después — la conexión que se cayó.** El mismo script volvió a reportar fallo,
 *    pero con código `undefined`: SSH murió por `ECONNRESET` a mitad de la ejecución. Y ahí
 *    quedó claro que "falló" era una respuesta incompleta: **los pasos remotos pudieron
 *    haberse aplicado igual**. De hecho se habían aplicado. Tratar eso como fallo invita a
 *    relanzar a ciegas; tratarlo como éxito es peor.
 *
 * Es exactamente la distinción de `ResultadoOperacion` del backend, aplicada a la
 * herramienta de despliegue: un timeout o una desconexión NO significan "no pasó nada".
 */
export const VEREDICTO = {
  /** Todos los pasos terminaron bien. */
  APLICADO: 'aplicado',
  /** Un paso falló y el shell lo dijo con un código. El servidor sigue como estaba. */
  FALLIDO: 'fallido',
  /**
   * Se perdió la conexión sin saber en qué paso. Los cambios PUDIERON aplicarse.
   * No se relanza a ciegas: se verifica el estado real primero.
   */
  INDETERMINADO: 'indeterminado',
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. **2026-08-08 — tres ECONNRESET seguidos, y la lección de los otros dos aplicada mal.**
//
// El diseño anterior ejecutaba la cadena entera en un `exec` y leía su salida. Correcto
// para clasificar el resultado… y frágil justo donde importa: el paso de compilación pasa
// minutos sin emitir nada (`| tail -20` retiene toda la salida hasta terminar), y el canal
// SSH silencioso se cae. Tres despliegues seguidos murieron ahí, y los tres dejaron el
// **código compilado sin recargar** — el ERP corriendo el binario anterior mientras el
// repositorio decía otra cosa.
//
// `INDETERMINADO` estaba bien diseñado y funcionó: avisó, no invitó a relanzar, y la
// verificación posterior encontró el estado real. Pero clasificar bien un fallo recurrente
// no es corregirlo. La causa no era la clasificación: era **atar la vida del trabajo a la
// vida de la conexión**.
//
// Ahora el trabajo se lanza DESLIGADO (`nohup … &`) escribiendo a un log en el servidor, y
// el cliente solo lo sigue. Una caída de red deja de poder interrumpir un despliegue: se
// reconecta y se sigue leyendo. `INDETERMINADO` se conserva para lo que sí sigue siendo
// incierto — que el sondeo agote su plazo sin ver el marcador de fin.
// ─────────────────────────────────────────────────────────────────────────────

const LOG_REMOTO   = '/opt/datafast/logs/_deploy.log';
const MARCA_FIN    = '===DEPLOY-FIN===';
const SONDEO_MS    = 10_000;
const PLAZO_MAX_MS = 20 * 60_000;

const conectar = () => new Promise((res, rej) => {
  const c = new Client();
  c.on('ready', () => res(c));
  c.on('error', rej);
  c.connect({ ...VPS, keepaliveInterval: 5000 });
});

const ejec = (c, cmd) => new Promise((res) => {
  c.exec(cmd, { pty: false }, (err, s) => {
    if (err) return res({ code: 1, out: '' });
    let out = '';
    s.on('data', (d) => { out += d; });
    s.stderr.on('data', (d) => { out += d; });
    s.on('close', (code) => res({ code, out }));
  });
});

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ejecutarDespliegue({ pasos, etiqueta = 'Despliegue' }) {
  // `set -o pipefail`: sin esto, un paso que termina en `| tail -N` devuelve el código de
  // `tail` y la cadena de `&&` continúa como si nada.
  // El marcador de fin lleva el código de salida real: es el veredicto del shell remoto,
  // y viaja por el log en vez de por el canal, que es lo que se caía.
  const guion = `set -o pipefail; ${pasos.join(' && ')}; echo "${MARCA_FIN}:$?"`;
  const lanzar =
    `rm -f ${LOG_REMOTO}; ` +
    `nohup bash -c '${guion.replace(/'/g, `'\\''`)}' > ${LOG_REMOTO} 2>&1 & ` +
    `echo lanzado`;

  try {
    const c0 = await conectar();
    console.log(`✓ SSH conectado — ${etiqueta} (desligado; log en ${LOG_REMOTO})\n`);
    await ejec(c0, lanzar);
    c0.end();
  } catch (e) {
    return dictaminar(VEREDICTO.FALLIDO, 1, `no se pudo lanzar: ${e.message}`);
  }

  let visto = 0;
  const limite = Date.now() + PLAZO_MAX_MS;

  while (Date.now() < limite) {
    await dormir(SONDEO_MS);
    let out = null;
    try {
      const c = await conectar();
      ({ out } = await ejec(c, `cat ${LOG_REMOTO} 2>/dev/null || true`));
      c.end();
    } catch (e) {
      // Una caída entre sondeos ya no importa: el trabajo corre en el servidor.
      console.log(`  · sin conexión (${e.message}) — el despliegue sigue en el servidor`);
      continue;
    }

    if (out.length > visto) { process.stdout.write(out.slice(visto)); visto = out.length; }

    const fin = new RegExp(`${MARCA_FIN}:(\\d+)`).exec(out);
    if (fin) {
      const code = Number(fin[1]);
      return dictaminar(code === 0 ? VEREDICTO.APLICADO : VEREDICTO.FALLIDO, code);
    }
  }

  return dictaminar(VEREDICTO.INDETERMINADO, null, `sin marcador de fin tras ${PLAZO_MAX_MS / 60000} min`);
}

function dictaminar(veredicto, code, motivo) {
  if (veredicto === VEREDICTO.APLICADO) {
    console.log('\n✓ Despliegue aplicado');
    process.exitCode = 0;
    return { veredicto, code };
  }

  if (veredicto === VEREDICTO.FALLIDO) {
    console.error(
      `\n✗ DESPLIEGUE FALLIDO (código ${code}).\n` +
      `  El servidor sigue con la versión anterior. El primer paso que falló es donde se\n` +
      `  cortó la cadena; revisa la salida de arriba.`,
    );
    process.exitCode = code || 1;
    return { veredicto, code };
  }

  // Indeterminado. El mensaje es deliberadamente distinto: no dice "falló" ni invita a
  // relanzar, porque relanzar a ciegas sobre un estado desconocido es cómo se rompen las
  // cosas de verdad.
  console.error(
    `\n⚠ DESPLIEGUE SIN CONFIRMAR${motivo ? ` (${motivo})` : ''}.\n` +
    `  El trabajo corre DESLIGADO en el servidor, así que probablemente siga en marcha o\n` +
    `  haya terminado sin que este cliente lo viera. Los cambios PUDIERON aplicarse — no\n` +
    `  relances sin mirar primero el estado real:\n` +
    `    tail -40 ${LOG_REMOTO}   (el log del propio despliegue)\n` +
    `    git log --oneline -1     (en /opt/datafast)\n` +
    `    pm2 list                 (uptime y contador de reinicios)`,
  );
  process.exitCode = 2; // distinto de 1: un automatismo puede diferenciarlo de un fallo
  return { veredicto, code: null, motivo };
}
