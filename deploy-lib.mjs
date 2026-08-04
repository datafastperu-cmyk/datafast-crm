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

export function ejecutarDespliegue({ pasos, etiqueta = 'Despliegue' }) {
  return new Promise((resolve) => {
    const conn = new Client();
    let cerroLimpio = false;
    let errorConexion = null;

    conn.on('ready', () => {
      console.log(`✓ SSH conectado — ${etiqueta}\n`);
      // `set -o pipefail`: sin esto, un paso que termina en `| tail -N` devuelve el código
      // de `tail` y la cadena de `&&` continúa como si nada.
      const cmd = `set -o pipefail; ${pasos.join(' && ')}`;

      conn.exec(cmd, { pty: false }, (err, stream) => {
        if (err) {
          errorConexion = err.message;
          conn.end();
          return;
        }
        stream.on('data', (d) => process.stdout.write(d.toString()));
        stream.stderr.on('data', (d) => process.stderr.write(d.toString()));

        stream.on('close', (code) => {
          // Un código NUMÉRICO es un veredicto del shell remoto: sabemos qué pasó.
          // `undefined` significa que el canal murió antes de devolverlo — no lo sabemos.
          if (typeof code === 'number') {
            cerroLimpio = true;
            resolve(dictaminar(code === 0 ? VEREDICTO.APLICADO : VEREDICTO.FALLIDO, code));
          }
          conn.end();
        });
      });
    });

    conn.on('error', (e) => { errorConexion = e.message; });

    conn.on('close', () => {
      // Si el stream ya dictaminó, esto no hace nada (la promesa está resuelta).
      if (cerroLimpio) return;
      resolve(dictaminar(VEREDICTO.INDETERMINADO, null, errorConexion));
    });

    conn.connect(VPS);
  });
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
    `  Se perdió la conexión antes de conocer el resultado. Los cambios PUDIERON haberse\n` +
    `  aplicado igual — no relances sin verificar primero el estado real:\n` +
    `    git log --oneline -1   (en /opt/datafast)\n` +
    `    pm2 status             (uptime de los procesos)`,
  );
  process.exitCode = 2; // distinto de 1: un automatismo puede diferenciarlo de un fallo
  return { veredicto, code: null, motivo };
}
