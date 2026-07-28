import { Logger } from '@nestjs/common';
import type { EventosSistemaService, OrigenEvento } from '../../modules/sistema/eventos-sistema.service';

// ═══════════════════════════════════════════════════════════════════════════
// Captura global de errores de PROCESO → eventos_sistema.
//
// Origen (2026-07-28): el cron de facturación diaria llevaba días fallando a las 05:00
// con "column em.serie_boleta does not exist" y NO había ni un evento en
// /configuracion/sistema. El fallo solo existía en los logs de PM2 — el ERP no se
// enteraba de que su módulo más crítico estaba roto.
//
// La causa es estructural: `eventos_sistema` se poblaba desde solo DOS sitios —
// el filtro global de excepciones HTTP (que por definición solo ve peticiones HTTP) y
// un puñado de llamadas manuales a `registrar()`. Todo lo demás era invisible:
//
//   · errores dentro de un @Cron           (facturación, cobranza, watchers…)
//   · errores en procesadores de cola      (BullMQ)
//   · errores en tareas fire-and-forget    (setImmediate, void promise)
//   · rechazos de promesa sin await
//
// Es decir: TODA la actividad de fondo del ERP. Y la actividad de fondo es justo donde
// viven los fallos silenciosos — los que nadie ve hasta que un cliente reclama.
//
// Un panel de eventos que no muestra la totalidad de lo que ocurre es peor que no
// tenerlo: da una falsa sensación de control. Si no genera evento, para el ERP no pasó.
// ═══════════════════════════════════════════════════════════════════════════

const logger = new Logger('ErroresProceso');

/**
 * Anti-inundación. Un cron roto que corre cada minuto, o un bucle de reintentos,
 * escribiría miles de filas idénticas y enterraría los eventos que importan. Se
 * registra la primera ocurrencia de cada error y se silencian las repeticiones
 * durante la ventana, anotando cuántas hubo al reaparecer.
 */
const VENTANA_DEDUPE_MS = 15 * 60_000;
const vistos = new Map<string, { ultimo: number; suprimidos: number }>();

function debeRegistrar(clave: string): { registrar: boolean; suprimidos: number } {
  const ahora = Date.now();
  const prev  = vistos.get(clave);

  if (!prev || ahora - prev.ultimo > VENTANA_DEDUPE_MS) {
    const suprimidos = prev?.suprimidos ?? 0;
    vistos.set(clave, { ultimo: ahora, suprimidos: 0 });
    return { registrar: true, suprimidos };
  }
  prev.suprimidos++;
  return { registrar: false, suprimidos: prev.suprimidos };
}

// Evita que el mapa crezca sin límite en un proceso de larga vida.
setInterval(() => {
  const corte = Date.now() - VENTANA_DEDUPE_MS * 2;
  for (const [k, v] of vistos) if (v.ultimo < corte) vistos.delete(k);
}, VENTANA_DEDUPE_MS).unref();

/** Deduce el origen a partir del stack, para que el panel permita filtrar por área. */
function deducirOrigen(stack: string): OrigenEvento {
  if (/QueryFailedError|column .* does not exist|relation .* does not exist/i.test(stack)) return 'db';
  if (/\.worker\.|Scheduler|\.cron\./i.test(stack))   return 'scheduler';
  if (/mikrotik|RouterOS|RosException/i.test(stack))  return 'mikrotik';
  if (/olt-nativo|OltAutomation|ftth/i.test(stack))   return 'olt';
  if (/vpn|openvpn/i.test(stack))                     return 'vpn';
  return 'api';
}

/**
 * Instala los handlers de proceso. Se llama una vez desde bootstrap, con el servicio de
 * eventos ya resuelto del contenedor de Nest.
 *
 * Regla de oro: NADA aquí puede lanzar. Un fallo del registrador dentro de un handler de
 * error global provoca otro rechazo no capturado, y con él un bucle infinito.
 */
export function instalarCapturaDeErroresDeProceso(eventos: EventosSistemaService): void {
  const registrar = (
    codigo: string,
    err: unknown,
    contextoExtra: Record<string, unknown> = {},
  ): void => {
    try {
      const mensaje = err instanceof Error ? err.message : String(err);
      const stack   = err instanceof Error ? (err.stack ?? '') : '';

      const { registrar: hayQueRegistrar, suprimidos } = debeRegistrar(`${codigo}:${mensaje}`);
      if (!hayQueRegistrar) return;

      void eventos.registrar({
        nivel:   'error',
        origen:  deducirOrigen(stack || mensaje),
        codigo,
        mensaje: suprimidos > 0 ? `${mensaje} (+${suprimidos} repeticiones suprimidas)` : mensaje,
        stack:   stack || null,
        contexto: { proceso: process.env.NODE_APP_INSTANCE ?? 'solo', pid: process.pid, ...contextoExtra },
      });
    } catch (e) {
      // Último recinto: si ni siquiera se puede registrar, al log y nada más.
      logger.warn(`No se pudo registrar el error de proceso: ${(e as Error)?.message}`);
    }
  };

  // ── Rechazos de promesa sin manejar ─────────────────────────────
  // La vía por la que se perdían los fallos de cron: un método @Cron async que lanza
  // produce un unhandledRejection, y hasta hoy no había ningún handler.
  process.on('unhandledRejection', (razon) => {
    logger.error(`Rechazo no manejado: ${razon instanceof Error ? razon.message : String(razon)}`);
    registrar('UNHANDLED_REJECTION', razon);
  });

  // ── Excepciones no capturadas ───────────────────────────────────
  // El handler de main.ts ya decide si el proceso sobrevive (hay casos tolerados a
  // propósito, como los timeouts de socket de RouterOS). Aquí solo se DEJA CONSTANCIA:
  // que se tolere no significa que deba ser invisible.
  process.on('uncaughtException', (err) => {
    const msg = err?.message ?? '';
    if (msg === 'write after end') return; // ruido de Winston al apagar
    registrar('UNCAUGHT_EXCEPTION', err, { tolerado: /Timed out after/.test(msg) });
  });

  logger.log('Captura global de errores de proceso instalada → eventos_sistema');
}
