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

/**
 * Día máximo admitido como **anclaje** de facturación.
 *
 * Hasta el 2026-08-09 esto valía **28**, «el único que existe en los doce meses del año»:
 * el problema de febrero se evitaba **prohibiendo** los días que no siempre existen. Es una
 * decisión tomada desde el estado, no desde el modelo — y le niega al operador los tres días
 * de cierre más usados en tarifa plana, el 30 incluido (POL-001 **PD-13**).
 *
 * Se adopta el patrón del sector: **anclaje de ciclo con recorte a fin de mes**. Stripe lo
 * documenta con este ejemplo textual:
 *
 * > *«A monthly subscription with a billing cycle anchor date of January 31 bills the last
 * > day of the month closest to the anchor date, so February 28 (or February 29 in a leap
 * > year), then March 31, April 30, and so on.»*
 *
 * **El anclaje NO se toca nunca; solo se recorta la materialización.** Es la parte que se
 * hace mal: si tras cobrar el 28 de febrero se guardara «28» como nuevo día de pago, el
 * abonado se quedaría en 28 **para siempre** y el ciclo habría derivado sin que nadie lo
 * decidiera. Por eso toda fecha se deriva de `politica.diaPago` —el anclaje— y jamás de la
 * fecha recortada anterior.
 */
export const DIA_ANCLAJE_MAXIMO = 31;

/**
 * @deprecated Nombre anterior, conservado para no romper importaciones.
 * El tope real es {@link DIA_ANCLAJE_MAXIMO}, y ya no es «el día máximo que existe en todos
 * los meses» sino «el anclaje máximo», que es otra cosa.
 */
export const DIA_PAGO_MAXIMO = DIA_ANCLAJE_MAXIMO;

/** Días reales de un mes (`mes` en base 1). Día 0 del siguiente = último de este. */
export const diasDelMes = (anio: number, mes: number): number =>
  new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * Materializa el anclaje en un mes concreto, recortándolo si ese día no existe.
 *
 * **Toda fecha del ciclo pasa por aquí, y no es una comodidad: es una corrección.** La
 * aritmética ingenua de meses en JavaScript **desborda en silencio**:
 *
 *     new Date(Date.UTC(2026, 0 + 1, 31))   // 31 de enero + 1 mes  →  3 de MARZO
 *
 * Con el anclaje topado en 28 eso nunca se disparaba y el código funcionaba **por
 * accidente**. Al abrirlo a 31 habría empezado a producir vencimientos y periodos en el mes
 * equivocado, sin error y sin que ningún test lo notara.
 */
export const anclaEnMes = (anio: number, mes: number, anclaje: number): Date =>
  new Date(Date.UTC(anio, mes - 1, Math.min(anclaje, diasDelMes(anio, mes))));

export interface PoliticaFacturacion {
  /**
   * `prepago` cobra por adelantado el periodo que el abonado va a consumir; `postpago`
   * cobra el que ya consumió. Decide qué mes de servicio ampara el comprobante.
   */
  tipo: 'prepago' | 'postpago';
  /**
   * **Anclaje** del ciclo: día del mes en que vence la factura (1..31). No es una fecha —
   * es el día al que el abonado está anclado. Se recorta a fin de mes al materializarlo
   * (`anclaEnMes`) y el anclaje en sí no cambia nunca.
   */
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

/**
 * Preferencias de aviso del abonado (pestaña Facturación → Notificaciones).
 *
 * Sobre el canal: el gateway de mensajería soporta WhatsApp (varios proveedores) y SMTP.
 * NO existe proveedor de SMS, así que las opciones 'sms' y 'ambos' de la UI se comportan
 * como 'activado' y salen por el gateway configurado en la empresa. El campo se respeta
 * como interruptor —'desactivado' no envía nada—, que es lo que decide si el abonado
 * recibe el mensaje o no.
 */
export interface PreferenciasNotificacion {
  /** Aviso al emitir el comprobante. `null` = desactivado. */
  avisoNuevaFactura: string | null;
  /** Plantilla del aviso de factura; `null` = la genérica del tipo. */
  plantillaAvisoFactura: string | null;
  /** Interruptor de los tres recordatorios. `null` = desactivados todos. */
  recordatoriosPago: string | null;
  /**
   * Offsets en días respecto al vencimiento: negativo = antes, positivo = después.
   * Solo se incluyen los recordatorios activos, con su plantilla si la tienen.
   */
  recordatorios: Array<{ dias: number; plantilla: string | null; indice: 1 | 2 | 3 }>;
}

interface FilaPolitica {
  facturacion_config: Record<string, unknown> | null;
  notificaciones_config?: Record<string, unknown> | null;
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

  /**
   * Preferencias de aviso de un abonado. Devuelve todo desactivado si no configuró nada:
   * el silencio es el valor por defecto seguro — nadie recibe mensajes que el operador no
   * pidió enviar.
   */
  async resolverNotificaciones(
    clienteId: string, empresaId: string,
  ): Promise<PreferenciasNotificacion> {
    const [fila] = await this.ds.query<Array<{
      notificaciones_config: Record<string, unknown> | null;
      facturacion_config: Record<string, unknown> | null;
    }>>(
      `SELECT notificaciones_config, facturacion_config FROM clientes
        WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [clienteId, empresaId],
    );
    return this.notificacionesDesde(
      fila?.notificaciones_config ?? null,
      fila?.facturacion_config ?? null,
    );
  }

  /**
   * `cfg` es `notificaciones_config`; la plantilla del aviso de factura vive en
   * `facturacion_config` porque la pantalla la presenta junto al comprobante.
   */
  notificacionesDesde(
    cfg: Record<string, unknown> | null,
    cfgFacturacion: Record<string, unknown> | null = null,
  ): PreferenciasNotificacion {
    const activo = (v: unknown): string | null => {
      const s = typeof v === 'string' ? v.trim() : '';
      return s && s !== 'desactivado' ? s : null;
    };
    const texto = (v: unknown): string | null => {
      const s = typeof v === 'string' ? v.trim() : '';
      return s || null;
    };

    const recordatoriosPago = activo(cfg?.['recordatoriosPago']);
    const recordatorios: PreferenciasNotificacion['recordatorios'] = [];

    // Los tres recordatorios cuelgan del interruptor general: apagarlo los silencia todos
    // sin tener que desactivarlos uno a uno, que es como lo presenta la pantalla.
    if (recordatoriosPago) {
      for (const indice of [1, 2, 3] as const) {
        const bruto = cfg?.[`recordatorio${indice}`];
        if (typeof bruto === 'string' && bruto === 'desactivado') continue;
        const dias = typeof bruto === 'number' ? bruto : parseInt(String(bruto ?? ''), 10);
        if (!Number.isFinite(dias)) continue; // 0 no es un offset válido: es el día mismo
        recordatorios.push({
          dias,
          plantilla: texto(cfg?.[`plantillaRecordatorio${indice}`]),
          indice,
        });
      }
    }

    return {
      avisoNuevaFactura: activo(cfg?.['avisoNuevaFactura']),
      plantillaAvisoFactura: texto(cfgFacturacion?.['plantillaAvisoFactura']),
      recordatoriosPago,
      recordatorios,
    };
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

    // El ANCLAJE se guarda tal cual (1..31); el recorte a fin de mes ocurre al materializar
    // cada fecha, no aquí. Guardarlo ya recortado haría derivar el ciclo: un abonado
    // anclado en 31 se quedaría en 28 después del primer febrero.
    const diaPago = Math.min(
      Math.max(diaPagoCfg ?? fila?.dia_facturacion ?? 1, 1),
      DIA_ANCLAJE_MAXIMO,
    );

    return {
      // Postpago por defecto: es lo que el ERP venía haciendo (la factura ampara el mes
      // del vencimiento). Un cliente sin configurar no cambia de periodo por este cambio.
      tipo: cfg?.['tipo'] === 'prepago' ? 'prepago' : 'postpago',
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
    // Se materializa el ANCLAJE en el mes de `desde`, recortado a fin de mes si ese día no
    // existe. Si ya pasó, el del mes siguiente — recortado otra vez **desde el anclaje**,
    // nunca desplazando la fecha recortada anterior: así un abonado anclado en 31 vence el
    // 28 de febrero y **vuelve al 31 en marzo**, en vez de quedarse en 28 para siempre.
    const anio = desde.getUTCFullYear();
    const mes  = desde.getUTCMonth() + 1;

    const esteMes = anclaEnMes(anio, mes, politica.diaPago);
    if (esteMes >= this.soloFecha(desde)) return esteMes;

    return mes === 12
      ? anclaEnMes(anio + 1, 1, politica.diaPago)
      : anclaEnMes(anio, mes + 1, politica.diaPago);
  }

  /** El anclaje materializado en el mes anterior o siguiente al de `fecha`. */
  private anclaDesplazada(politica: PoliticaFacturacion, fecha: Date, meses: 1 | -1): Date {
    // Se navega al mes con día 1 —que existe siempre— y solo después se materializa el
    // anclaje. Hacerlo al revés es el desbordamiento que documenta `anclaEnMes`.
    const bruto = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + meses, 1));
    return anclaEnMes(bruto.getUTCFullYear(), bruto.getUTCMonth() + 1, politica.diaPago);
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

  /**
   * Periodo de servicio que ampara un comprobante que vence en `vencimiento`.
   *
   * **Va del día siguiente a una fecha de pago hasta la fecha de pago siguiente**, que es
   * el ciclo real del abonado:
   *
   *     postpago (ya consumió)     vence 10/03  →  ampara 11/02 – 10/03
   *     prepago  (por adelantado)  vence 10/03  →  ampara 11/03 – 10/04
   *
   * El mismo intervalo en los dos; lo que cambia es si va por detrás o por delante del
   * vencimiento. Esa es la diferencia real entre las dos modalidades.
   *
   * **Antes esto devolvía MESES DE CALENDARIO** (`YYYY-MM-01` al último día del mes), con
   * un desplazamiento de un mes en prepago. Lo señaló el propietario el 2026-08-08: un
   * abonado con día de pago 10 recibía un comprobante que decía «01/03 – 31/03» mientras
   * el ciclo que estaba pagando iba del 11/03 al 10/04. El dato era sencillamente falso, y
   * contradecía el resto del módulo — todo lo demás (emisión, vencimiento, corte) ya salía
   * de SU día de pago, y solo el periodo seguía anclado al calendario.
   *
   * Los extremos se materializan **desde el anclaje** (`anclaEnMes`), no desplazando la
   * fecha de vencimiento: con anclaje 31, el ciclo que cierra el 28 de febrero abrió el 1
   * de febrero —día siguiente al 31 de enero— y el que abre ahí cierra el 31 de marzo.
   * Desplazar «un mes» sobre la fecha ya recortada haría derivar el ciclo mes a mes.
   */
  periodoServicio(
    politica: PoliticaFacturacion,
    vencimiento: Date,
  ): { inicio: string; fin: string; mes: number; anio: number } {
    // El vencimiento se NORMALIZA al anclaje de su propio mes antes de nada. En producción
    // siempre llega ya materializado por `proximoVencimiento`, pero sin esta línea la
    // función tendría una precondición tácita —«el día de `vencimiento` es el anclaje»— y
    // devolvería un periodo incoherente en cuanto alguien la llamara con otra fecha: un
    // extremo derivado del anclaje y el otro del día que se pasó. Lo detectó un test.
    const cierre = anclaEnMes(
      vencimiento.getUTCFullYear(), vencimiento.getUTCMonth() + 1, politica.diaPago,
    );

    // Prepago: el ciclo EMPIEZA en el cierre y termina en el siguiente.
    // Postpago: el ciclo TERMINA en el cierre y empezó en el anterior.
    const finCiclo = politica.tipo === 'prepago'
      ? this.anclaDesplazada(politica, cierre, 1)
      : new Date(cierre.getTime());

    const inicioCiclo = politica.tipo === 'prepago'
      ? new Date(cierre.getTime())
      : this.anclaDesplazada(politica, cierre, -1);

    // El día del pago pertenece al ciclo que se cierra, no al que abre: el periodo empieza
    // al día siguiente. Sin esto, dos comprobantes consecutivos se solaparían un día.
    const inicio = new Date(inicioCiclo.getTime());
    inicio.setUTCDate(inicio.getUTCDate() + 1);

    return {
      inicio: this.aIso(inicio),
      fin:    this.aIso(finCiclo),
      // `mes`/`anio` describen el ciclo por su cierre — es como se nombra un periodo de
      // facturación («el recibo de marzo» es el que vence en marzo).
      mes:  finCiclo.getUTCMonth() + 1,
      anio: finCiclo.getUTCFullYear(),
    };
  }

  // Aquí había un `mismoDiaMesSiguiente` / `mismoDiaMesAnterior` que hacían
  // `Date.UTC(año, mes ± 1, día)`. **Se borraron: desbordan en silencio.** El 31 de enero
  // más un mes da el 3 de MARZO, porque JavaScript normaliza el día 31 de un mes de 28.
  // Con el anclaje topado en 28 nunca se disparaba y funcionaban por accidente.
  // Los reemplaza `anclaDesplazada`, que navega al mes con día 1 y materializa el ANCLAJE.

  /** `YYYY-MM-DD` — el formato en que viajan las fechas a Postgres y al frontend. */
  aIso(fecha: Date): string {
    return fecha.toISOString().slice(0, 10);
  }

  private soloFecha(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
}
