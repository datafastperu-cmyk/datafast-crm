import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository }         from 'typeorm';
import { createHash }         from 'crypto';

import {
  OltOperacionLog,
  TipoOperacion,
  EstadoOperacion,
} from '../entities/olt-operacion-log.entity';
import { TipoProveedor } from '../entities/olt-proveedor-config.entity';
import { OltOperacionResult } from '../interfaces/olt-provider.interface';

// ─────────────────────────────────────────────────────────────
// OltIdempotencyService
//
// Garantiza que una misma operación (mismo tipo + OLT + ONU +
// parámetros de negocio) no se ejecute dos veces con éxito.
//
// FLUJO:
//   1. buildKey() → SHA-1 de (tipo, oltId, onuSn, payload sin campos volátiles)
//   2. execute():
//      a. Busca en olt_operacion_log WHERE idempotency_key = key
//                                       AND estado = 'exitoso'
//         → Si existe: retorna resultado cacheado (no re-ejecuta).
//      b. Inserta registro 'pendiente' → obtiene logId.
//      c. Ejecuta fn(logId) → OltOperacionResult<T>.
//      d. Actualiza el registro a 'exitoso' o 'fallido'.
//
// GARANTÍA DE UNICIDAD:
//   La BD tiene un índice UNIQUE parcial sobre (idempotency_key)
//   WHERE estado = 'exitoso'. Esto previene doble-exitoso incluso
//   ante race conditions que pasen el advisory lock (red de seguridad).
//   Dos 'pendiente' simultáneos con la misma clave son posibles pero
//   controlados por OltAtomicLockService antes de llegar aquí.
//
// CAMPOS EXCLUIDOS DEL KEY (volátiles — no deben romper idempotencia):
//   usuarioId, timestamps, campos de log/audit.
// ─────────────────────────────────────────────────────────────

export interface IdempotencyContext {
  tipo:       TipoOperacion;
  empresaId:  string;
  oltId:      string;
  onuSn?:     string | null;
  payload:    Record<string, unknown>;
  usuarioId?: string | null;
}

export interface IdempotencyExecResult<T> {
  cached:    boolean;
  resultado: OltOperacionResult<T>;
  logId:     string;
}

@Injectable()
export class OltIdempotencyService {
  private readonly logger = new Logger(OltIdempotencyService.name);

  constructor(
    @InjectRepository(OltOperacionLog)
    private readonly logRepo: Repository<OltOperacionLog>,
  ) {}

  // ── Generación de clave ──────────────────────────────────────
  // Clave determinista: SHA-1 de los campos de negocio relevantes.
  // El resultado es un hex de 40 chars; se prefija con el tipo
  // para hacer los logs legibles sin necesidad de lookups.
  buildKey(
    tipo:    TipoOperacion,
    oltId:   string,
    onuSn:   string | null | undefined,
    payload: Record<string, unknown>,
  ): string {
    const normalized = {
      tipo,
      oltId,
      onuSn:   onuSn ?? null,
      payload: sortKeys(payload),
    };
    const hash = createHash('sha1')
      .update(JSON.stringify(normalized))
      .digest('hex');
    return `${tipo}:${hash}`;   // máx ~70 chars, dentro del límite VARCHAR(120)
  }

  // ── Ejecución idempotente ─────────────────────────────────────
  async execute<T>(
    ctx: IdempotencyContext,
    fn:  (logId: string) => Promise<OltOperacionResult<T>>,
  ): Promise<IdempotencyExecResult<T>> {

    const key = this.buildKey(ctx.tipo, ctx.oltId, ctx.onuSn, ctx.payload);

    // ── Paso 1: buscar resultado exitoso previo ──────────────────
    const previo = await this.logRepo.findOne({
      where: { idempotencyKey: key, estado: 'exitoso' as EstadoOperacion },
      order: { createdAt: 'DESC' },
    });

    if (previo) {
      this.logger.log(
        `Idempotencia: hit | key=${key} | logId=${previo.id} | ` +
        `proveedor=${previo.proveedorExitoso ?? 'n/a'}`,
      );
      return {
        cached: true,
        logId:  previo.id,
        resultado: {
          exitoso:    true,
          datos:      (previo.resultado as any)?.datos as T | undefined,
          mensaje:    (previo.resultado as any)?.mensaje ?? 'Resultado cacheado',
          latenciaMs: previo.duracionMs ?? 0,
          proveedor:  (previo.proveedorExitoso ?? 'nativo_ssh') as TipoProveedor,
        },
      };
    }

    // ── Paso 2: crear registro pendiente ─────────────────────────
    const log = this.logRepo.create({
      empresaId:            ctx.empresaId,
      oltId:                ctx.oltId,
      onuSn:                ctx.onuSn ?? null,
      tipo:                 ctx.tipo,
      idempotencyKey:       key,
      estado:               'pendiente' as EstadoOperacion,
      proveedoresIntentados: [],
      usuarioId:            ctx.usuarioId ?? null,
    });
    const saved = await this.logRepo.save(log);
    const logId = saved.id;

    const t0 = Date.now();

    // ── Paso 3: ejecutar la operación ────────────────────────────
    let resultado: OltOperacionResult<T>;
    try {
      resultado = await fn(logId);
    } catch (err: any) {
      // Error inesperado fuera del contrato IOltProvider (no debería ocurrir)
      const duracionMs = Date.now() - t0;
      await this.logRepo.update(logId, {
        estado:       'fallido'  as EstadoOperacion,
        errorMensaje: err?.message ?? 'Error interno inesperado',
        duracionMs,
      });
      throw err;   // re-lanzar — este path indica bug, no fallo de proveedor
    }

    // ── Paso 4: actualizar log según resultado ───────────────────
    const duracionMs = Date.now() - t0;

    if (resultado.exitoso) {
      await this.logRepo.update(logId, {
        estado:               'exitoso' as EstadoOperacion,
        proveedorExitoso:     resultado.proveedor,
        resultado:            { datos: resultado.datos ?? null, mensaje: resultado.mensaje },
        duracionMs,
      });
    } else {
      await this.logRepo.update(logId, {
        estado:       'fallido'  as EstadoOperacion,
        errorMensaje: resultado.mensaje,
        duracionMs,
      });
    }

    return { cached: false, resultado, logId };
  }

  // ── Registro de proveedores intentados ──────────────────────
  // Llamado por el Router tras cada intento (exitoso o fallido)
  // para mantener auditoría completa de la cadena de fallback.
  async registrarIntento(logId: string, proveedor: TipoProveedor): Promise<void> {
    await this.logRepo
      .createQueryBuilder()
      .update(OltOperacionLog)
      .set({
        proveedoresIntentados: () =>
          `array_append("proveedores_intentados", '${proveedor}')`,
      })
      .where('id = :id', { id: logId })
      .execute();
  }
}

// ── Utilidad: ordenar claves de objeto recursivamente ────────
// Garantiza que { a:1, b:2 } y { b:2, a:1 } produzcan el mismo JSON.
function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v)
          ? sortKeys(v as Record<string, unknown>)
          : v,
      ]),
  );
}
