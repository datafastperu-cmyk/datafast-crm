import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Resuelve CUÁNDO se le factura a un abonado, cuándo vence esa factura y cuándo se le
 * corta. Es la única fuente de esas tres fechas.
 *
 * Antes vivían en tres sitios que no se hablaban entre sí, con parámetros distintos:
 *
 *   · La emisión disparaba por `empresas.dia_facturacion` y vencía a
 *     `contratos.dia_facturacion + empresas.dias_gracia`.
 *   · El portal anunciaba el corte con `contratos.dias_prorroga`.
 *   · La pestaña Facturación → Configuración del cliente guardaba `diaPago`,
 *     `crearFactura`, `diasGracia` y `aplicarCorte` en `clientes.facturacion_config`…
 *     que NADIE leía. Era una pantalla decorativa: el operador configuraba día de pago 28
 *     y el sistema facturaba el día 1.
 *
 * Incidente 2026-08-05: a un abonado se le anunciaba corte el día 4, su factura vencía el
 * 6 y el cron lo cortó el 5. Tres fechas, tres fórmulas, ninguna de acuerdo.
 *
 * REGLA DE NEGOCIO (invariante del módulo):
 *
 *     emisión  =  diaPago − crearFactura
 *     vence    =  diaPago                       ← el día en que el abonado debe pagar
 *     corte    =  diaPago + diasGracia          ← los días de gracia SON esa distancia
 *
 * De ahí se sigue `vencimiento < corte` por construcción, sin validación que nadie pueda
 * saltarse, siempre que `diasGracia >= 1`. Un `diasGracia = 0` significa "sin corte
 * automático" (es como lo expresa la UI), no "cortar el mismo día del vencimiento".
 *
 * El vencimiento se CONGELA en la factura al emitirla: cambiar esta configuración no
 * reescribe deuda ya notificada al abonado. El corte se evalúa siempre contra el
 * `fecha_vencimiento` que la factura lleva grabado, nunca recalculándolo.
 */

/** Día máximo admitido: el único que existe en los doce meses del año. */
export const DIA_PAGO_MAXIMO = 28;

export interface PoliticaFacturacion {
  /** Día del mes en que vence la factura (1..28). */
  diaPago: number;
  /** Días antes del vencimiento en que se emite. `null` = no emitir automáticamente. */
  diasAntesEmision: number | null;
  /** Distancia entre vencimiento y corte. `0` = sin corte automático. */
  diasGracia: number;
  /** Meses vencidos que deben acumularse para cortar. `null` = no cortar nunca. */
  mesesVencidosParaCorte: number | null;
  /** De dónde salió: sirve para explicar en logs por qué se eligió una fecha. */
  origen: 'cliente' | 'heredada';
}

interface FilaPolitica {
  facturacion_config: Record<string, unknown> | null;
  dia_facturacion: number | null;
  dias_gracia: number | null;
}

@Injectable()
export class PoliticaFacturacionService {
  private readonly logger = new Logger(PoliticaFacturacionService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Política vigente de un abonado. Si no tiene configuración propia, hereda la del
   * contrato y la empresa — que es exactamente el comportamiento anterior, para que un
   * cliente sin configurar no cambie de ciclo por este cambio.
   */
  async resolver(clienteId: string, empresaId: string): Promise<PoliticaFacturacion> {
    const [fila] = await this.ds.query<FilaPolitica[]>(
      `SELECT cl.facturacion_config,
              -- El día del contrato es el respaldo; con varios servicios se toma el menor
              -- para no facturar a un mismo abonado en dos fechas distintas del mes.
              MIN(co.dia_facturacion)::int AS dia_facturacion,
              MIN(em.dias_gracia)::int     AS dias_gracia
         FROM clientes cl
         JOIN empresas em ON em.id = cl.empresa_id
         LEFT JOIN contratos co
                ON co.cliente_id = cl.id
               AND co.deleted_at IS NULL
               AND co.estado <> 'baja_definitiva'
        WHERE cl.id = $1 AND cl.empresa_id = $2 AND cl.deleted_at IS NULL
        GROUP BY cl.facturacion_config`,
      [clienteId, empresaId],
    );

    return this.desdeFila(fila ?? null);
  }

  /**
   * Igual que `resolver`, pero para un lote ya leído: evita una consulta por abonado
   * cuando la generación mensual recorre miles de clientes.
   */
  async resolverLote(
    clienteIds: string[],
    empresaId: string,
  ): Promise<Map<string, PoliticaFacturacion>> {
    const mapa = new Map<string, PoliticaFacturacion>();
    if (!clienteIds.length) return mapa;

    const filas = await this.ds.query<Array<FilaPolitica & { id: string }>>(
      `SELECT cl.id,
              cl.facturacion_config,
              MIN(co.dia_facturacion)::int AS dia_facturacion,
              MIN(em.dias_gracia)::int     AS dias_gracia
         FROM clientes cl
         JOIN empresas em ON em.id = cl.empresa_id
         LEFT JOIN contratos co
                ON co.cliente_id = cl.id
               AND co.deleted_at IS NULL
               AND co.estado <> 'baja_definitiva'
        WHERE cl.id = ANY($1) AND cl.empresa_id = $2 AND cl.deleted_at IS NULL
        GROUP BY cl.id, cl.facturacion_config`,
      [clienteIds, empresaId],
    );

    for (const fila of filas) mapa.set(fila.id, this.desdeFila(fila));
    return mapa;
  }

  private desdeFila(fila: FilaPolitica | null): PoliticaFacturacion {
    const cfg = fila?.facturacion_config ?? null;

    const diaPagoCfg  = this.entero(cfg?.['diaPago']);
    const graciaCfg   = this.entero(cfg?.['diasGracia']);
    const emisionCfg  = this.entero(cfg?.['crearFactura']);
    const corteCfg    = this.entero(cfg?.['aplicarCorte']);

    // `diaPago` es lo que decide si la configuración del cliente está en juego: sin él no
    // hay ciclo que aplicar y se hereda todo, como antes de que esta pantalla existiera.
    const tieneConfigPropia = diaPagoCfg !== null;

    const diaPago = Math.min(
      Math.max(diaPagoCfg ?? fila?.dia_facturacion ?? 1, 1),
      DIA_PAGO_MAXIMO,
    );

    return {
      diaPago,
      // 'desactivado' llega como null: no se emite sola, la factura se crea a mano.
      diasAntesEmision: tieneConfigPropia ? emisionCfg : null,
      // Con configuración propia manda ENTERA, incluido el 0. Caer al valor de la empresa
      // cuando el operador eligió "0 Días" le cortaría el servicio a un abonado al que
      // decidió no cortarle.
      diasGracia: tieneConfigPropia
        ? (graciaCfg ?? 0)
        : (fila?.dias_gracia ?? 0),
      // Sin configuración propia se conserva el criterio anterior: un mes vencido basta.
      mesesVencidosParaCorte: tieneConfigPropia ? corteCfg : 1,
      origen: tieneConfigPropia ? 'cliente' : 'heredada',
    };
  }

  /**
   * `'desactivado'`, `''`, `null` y cualquier basura → `null`. La configuración viene de
   * un jsonb sin esquema: lo que no sea un entero positivo no es una cantidad de días.
   */
  private entero(valor: unknown): number | null {
    if (valor === null || valor === undefined) return null;
    const n = typeof valor === 'number' ? valor : parseInt(String(valor), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // ── Fechas derivadas ──────────────────────────────────────────────────────
  // Se calculan con aritmética de calendario en UTC para que no dependan de la zona
  // horaria del proceso: una factura no puede vencer un día distinto según dónde corra
  // el worker.

  /**
   * Próximo vencimiento a partir de `desde` (inclusive). Es la fecha que se graba en la
   * factura al emitirla, y el ancla de la que cuelgan la emisión y el corte.
   */
  proximoVencimiento(politica: PoliticaFacturacion, desde: Date): Date {
    const venc = new Date(Date.UTC(
      desde.getUTCFullYear(), desde.getUTCMonth(), politica.diaPago,
    ));
    if (venc < this.soloFecha(desde)) venc.setUTCMonth(venc.getUTCMonth() + 1);
    return venc;
  }

  /** Fecha de corte de una factura: su vencimiento más los días de gracia. */
  fechaCorte(politica: PoliticaFacturacion, vencimiento: Date): Date | null {
    if (politica.diasGracia <= 0) return null; // sin corte automático
    const corte = new Date(vencimiento.getTime());
    corte.setUTCDate(corte.getUTCDate() + politica.diasGracia);
    return corte;
  }

  /** Fecha en que debe emitirse la factura de ese vencimiento. */
  fechaEmision(politica: PoliticaFacturacion, vencimiento: Date): Date | null {
    if (politica.diasAntesEmision === null) return null; // emisión manual
    const emision = new Date(vencimiento.getTime());
    emision.setUTCDate(emision.getUTCDate() - politica.diasAntesEmision);
    return emision;
  }

  /** `YYYY-MM-DD` — el formato en que viajan las fechas a Postgres y al frontend. */
  aIso(fecha: Date): string {
    return fecha.toISOString().slice(0, 10);
  }

  private soloFecha(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
}
