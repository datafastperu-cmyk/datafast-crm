import {
  Injectable, Logger, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { JwtPayload }           from '../../common/decorators/current-user.decorator';
import { AuditoriaService }     from '../auth/auditoria.service';
import { PagoAplicacion }       from './entities/pago-aplicacion.entity';
import { AplicadorFacturaService } from '../facturacion/aplicador-factura.service';
import { sqlDeudaExigible } from '../facturacion/domain/estados-con-saldo';

/**
 * Adelantos de pago (saldo a favor del abonado).
 *
 * Un adelanto NO es una entidad nueva: es un pago que todavía no se ha imputado a ningún
 * comprobante. El saldo a favor se DERIVA de los hechos —lo cobrado menos lo imputado—,
 * nunca de un contador que alguien deba mantener:
 *
 *     saldo a favor = Σ pagos.monto − Σ pago_aplicaciones.monto_aplicado
 *
 * Se modela así por lo aprendido con `contratos.deuda_total` (incidente 2026-08-04): una
 * cifra que se actualiza a mano acaba contradiciendo a los documentos que dice resumir, y
 * gana siempre la que tiene respaldo documental. Aquí no hay nada que sincronizar.
 *
 * Consecuencias que salen gratis de ese modelo:
 *   · Un adelanto mayor que el comprobante deja remanente y sigue aplicándose después.
 *   · El estado (disponible / aplicado / devuelto) se deduce, no se guarda.
 *   · El arqueo de caja cuadra: el dinero entró una vez y hay una fila que lo representa.
 */

export interface SaldoAFavor {
  clienteId:   string;
  /** Cobrado y aún no imputado a ningún comprobante. */
  disponible:  number;
  /** Suma de todos los adelantos registrados, aplicados o no. */
  totalAdelantado: number;
  /** Ya consumido por comprobantes. */
  aplicado:    number;
}

export interface AdelantoListado {
  id: string;
  clienteId: string;
  clienteNombre: string;
  monto: number;
  aplicado: number;
  disponible: number;
  metodoPago: string;
  numeroOperacion: string | null;
  fechaPago: string;
  estado: string;
  /** Derivado: qué se puede hacer con él y qué se ve en la UI. */
  situacion: 'disponible' | 'parcial' | 'efectuado' | 'devuelto';
  facturasAplicadas: string[];
  createdAt: string;
}

@Injectable()
export class AdelantosService {
  private readonly logger = new Logger(AdelantosService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly aplicador: AplicadorFacturaService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // SALDO A FAVOR
  // ────────────────────────────────────────────────────────────
  async saldoAFavor(clienteId: string, empresaId: string): Promise<SaldoAFavor> {
    const [row] = await this.ds.query<Array<{ total: string; aplicado: string }>>(
      `SELECT
         COALESCE(SUM(p.monto), 0)                                    AS total,
         COALESCE(SUM((SELECT COALESCE(SUM(a.monto_aplicado), 0)
                         FROM pago_aplicaciones a
                        WHERE a.pago_id = p.id)), 0)                  AS aplicado
       FROM pagos p
       WHERE p.cliente_id = $1
         AND p.empresa_id = $2
         AND p.estado = 'verificado'
         AND p.factura_id IS NULL`,
      [clienteId, empresaId],
    );

    const totalAdelantado = parseFloat(row?.total ?? '0');
    const aplicado        = parseFloat(row?.aplicado ?? '0');

    return {
      clienteId,
      totalAdelantado,
      aplicado,
      disponible: Number((totalAdelantado - aplicado).toFixed(2)),
    };
  }

  /** Deuda exigible del abonado: lo que impide registrar un adelanto. */
  async deudaPendiente(clienteId: string, empresaId: string): Promise<number> {
    const [row] = await this.ds.query<Array<{ deuda: string }>>(
      `SELECT COALESCE(SUM(COALESCE(saldo, total - monto_pagado)), 0) AS deuda
         FROM facturas
        WHERE cliente_id = $1 AND empresa_id = $2
          AND deleted_at IS NULL
          AND ${sqlDeudaExigible()}`,
      [clienteId, empresaId],
    );
    return parseFloat(row?.deuda ?? '0');
  }

  /**
   * Un adelanto no puede convivir con deuda pendiente: entregar dinero teniendo
   * comprobantes impagos no es adelantar, es pagar lo que se debe. Registrarlo como
   * adelanto dejaría al abonado con saldo a favor y en mora a la vez, y el cron lo
   * cortaría con su dinero ya en caja.
   */
  async assertSinDeuda(clienteId: string, empresaId: string): Promise<void> {
    const deuda = await this.deudaPendiente(clienteId, empresaId);
    if (deuda > 0) {
      throw new BadRequestException(
        `El cliente tiene S/ ${deuda.toFixed(2)} de deuda pendiente. ` +
        `Registra primero el pago de sus comprobantes: entregar dinero con comprobantes ` +
        `impagos no es un adelanto.`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // CONSUMO AUTOMÁTICO AL EMITIR UN COMPROBANTE
  // ────────────────────────────────────────────────────────────
  /**
   * Imputa el saldo a favor disponible a una factura recién emitida, del adelanto más
   * antiguo al más nuevo. Devuelve lo aplicado.
   *
   * Es lo que el abonado espera: si adelantó, su próximo comprobante nace pagado y no
   * entra en mora. Si el saldo no alcanza, la factura queda `pagada_parcial` y el resto
   * se cobra normal.
   *
   * Corre dentro de la transacción de emisión: una factura que nace pagada y un saldo
   * consumido son el mismo hecho y no pueden separarse.
   */
  async aplicarSaldoAFactura(
    manager: EntityManager,
    facturaId: string,
    clienteId: string,
    empresaId: string,
  ): Promise<number> {
    // Adelantos con remanente, del más antiguo al más nuevo. FOR UPDATE sobre los pagos:
    // dos emisiones simultáneas del mismo cliente no pueden consumir el mismo saldo.
    const disponibles = await manager.query<Array<{ id: string; restante: string }>>(
      `SELECT p.id,
              (p.monto - COALESCE((SELECT SUM(a.monto_aplicado)
                                     FROM pago_aplicaciones a
                                    WHERE a.pago_id = p.id), 0)) AS restante
         FROM pagos p
        WHERE p.cliente_id = $1
          AND p.empresa_id = $2
          AND p.estado = 'verificado'
          AND p.factura_id IS NULL
        ORDER BY p.fecha_pago ASC, p.created_at ASC
          FOR UPDATE`,
      [clienteId, empresaId],
    );

    const conSaldo = disponibles
      .map((d) => ({ id: d.id, restante: parseFloat(d.restante) }))
      .filter((d) => d.restante > 0);
    if (!conSaldo.length) return 0;

    const [fac] = await manager.query<Array<{ pendiente: string }>>(
      `SELECT (total - monto_pagado) AS pendiente FROM facturas WHERE id = $1`,
      [facturaId],
    );
    let porCubrir = parseFloat(fac?.pendiente ?? '0');
    if (porCubrir <= 0) return 0;

    let aplicadoTotal = 0;

    for (const adelanto of conSaldo) {
      if (porCubrir <= 0) break;
      const importe = Number(Math.min(adelanto.restante, porCubrir).toFixed(2));
      if (importe <= 0) continue;

      // `aplicadoEn` va puesto desde el principio porque aquí la imputación se vuelca
      // sobre la factura en esta misma transacción, unas líneas más abajo. Dejarlo en NULL
      // metería el adelanto en la cola del reconciliador, que lo reintentaría contra una
      // factura ya saldada — el bucle que corrigió F0.5, por otra puerta.
      await manager.insert(PagoAplicacion, {
        empresaId,
        pagoId:        adelanto.id,
        facturaId,
        montoAplicado: importe,
        aplicadoEn:    new Date(),
      });

      porCubrir     = Number((porCubrir - importe).toFixed(2));
      aplicadoTotal = Number((aplicadoTotal + importe).toFixed(2));
    }

    if (aplicadoTotal > 0) {
      // Un saldo a favor entra en la factura por el MISMO sitio que un cobro: el aplicador
      // canónico del módulo de facturación. Aquí había una copia de ese UPDATE que había
      // envejecido por su cuenta y había perdido dos cosas:
      //
      //   · el guard `estado NOT IN ('pagada','anulada')` — aplicaba saldo a favor a un
      //     comprobante ANULADO, consumiendo el adelanto del abonado a cambio de nada;
      //   · la tolerancia de 1 céntimo por redondeo que usa el resto del módulo.
      //
      // Eso es exactamente lo que produce tener varios escritores del mismo dato: no
      // divergen de golpe, divergen en la corrección que solo se aplicó a uno.
      await this.aplicador.aplicar(
        facturaId, aplicadoTotal, empresaId,
        new Date().toISOString().split('T')[0],
        manager,
      );
      this.logger.log(
        `Saldo a favor aplicado: S/ ${aplicadoTotal} del cliente ${clienteId} a la factura ${facturaId}`,
      );
    }

    return aplicadoTotal;
  }

  // ────────────────────────────────────────────────────────────
  // LISTADO
  // ────────────────────────────────────────────────────────────
  async listar(
    empresaId: string,
    filtros: { clienteId?: string; situacion?: string } = {},
  ): Promise<AdelantoListado[]> {
    const params: unknown[] = [empresaId];
    let where = `p.empresa_id = $1 AND p.factura_id IS NULL`;

    if (filtros.clienteId) {
      params.push(filtros.clienteId);
      where += ` AND p.cliente_id = $${params.length}`;
    }

    const filas = await this.ds.query<Array<{
      id: string; cliente_id: string; cliente_nombre: string;
      monto: string; aplicado: string; metodo_pago: string;
      numero_operacion: string | null; fecha_pago: string; estado: string;
      facturas: string[] | null; created_at: string;
    }>>(
      `SELECT p.id, p.cliente_id, cl.nombre_completo AS cliente_nombre,
              p.monto, p.metodo_pago, p.numero_operacion, p.fecha_pago,
              p.estado::text AS estado, p.created_at,
              COALESCE((SELECT SUM(a.monto_aplicado) FROM pago_aplicaciones a
                         WHERE a.pago_id = p.id), 0) AS aplicado,
              (SELECT array_agg(f.numero_completo ORDER BY f.fecha_emision)
                 FROM pago_aplicaciones a
                 JOIN facturas f ON f.id = a.factura_id
                WHERE a.pago_id = p.id) AS facturas
         FROM pagos p
         JOIN clientes cl ON cl.id = p.cliente_id
        WHERE ${where}
        ORDER BY p.created_at DESC
        LIMIT 500`,
      params,
    );

    const listado = filas.map((f) => {
      const monto      = parseFloat(f.monto);
      const aplicado   = parseFloat(f.aplicado);
      const disponible = Number((monto - aplicado).toFixed(2));

      // La situación se DERIVA del dinero, no es un campo que alguien mantenga.
      const situacion: AdelantoListado['situacion'] =
        f.estado === 'devuelto' ? 'devuelto'
        : disponible <= 0       ? 'efectuado'
        : aplicado   >  0       ? 'parcial'
        : 'disponible';

      return {
        id: f.id,
        clienteId: f.cliente_id,
        clienteNombre: f.cliente_nombre,
        monto, aplicado, disponible,
        metodoPago: f.metodo_pago,
        numeroOperacion: f.numero_operacion,
        fechaPago: f.fecha_pago,
        estado: f.estado,
        situacion,
        facturasAplicadas: f.facturas ?? [],
        createdAt: f.created_at,
      };
    });

    return filtros.situacion
      ? listado.filter((a) => a.situacion === filtros.situacion)
      : listado;
  }

  // ────────────────────────────────────────────────────────────
  // DEVOLUCIÓN
  // ────────────────────────────────────────────────────────────
  /**
   * Devuelve al abonado un adelanto que aún no se ha consumido.
   *
   * Solo se devuelve lo NO aplicado: si ya se imputó a un comprobante, ese dinero pagó una
   * deuda real y deshacerlo exige una nota de crédito, no una devolución de caja.
   */
  async devolver(
    pagoId: string, motivo: string, user: JwtPayload, req?: any,
  ): Promise<{ devuelto: number }> {
    if (!motivo?.trim()) {
      throw new BadRequestException('Indica el motivo de la devolución');
    }

    return this.ds.transaction(async (manager) => {
      const [pago] = await manager.query<Array<{
        id: string; monto: string; estado: string; cliente_id: string;
        factura_id: string | null; aplicado: string;
      }>>(
        `SELECT p.id, p.monto, p.estado::text AS estado, p.cliente_id, p.factura_id,
                COALESCE((SELECT SUM(a.monto_aplicado) FROM pago_aplicaciones a
                           WHERE a.pago_id = p.id), 0) AS aplicado
           FROM pagos p
          WHERE p.id = $1 AND p.empresa_id = $2
            FOR UPDATE`,
        [pagoId, user.empresaId],
      );

      if (!pago)              throw new NotFoundException('Adelanto no encontrado');
      if (pago.factura_id)    throw new BadRequestException('Ese pago no es un adelanto: está imputado a un comprobante');
      if (pago.estado === 'devuelto') throw new BadRequestException('El adelanto ya fue devuelto');

      const disponible = Number((parseFloat(pago.monto) - parseFloat(pago.aplicado)).toFixed(2));
      if (disponible <= 0) {
        throw new BadRequestException(
          'El adelanto ya se aplicó a comprobantes: para deshacerlo se emite una nota de crédito',
        );
      }

      await manager.query(
        `UPDATE pagos
            SET estado = 'devuelto', devuelto_en = NOW(),
                devuelto_por = $1, motivo_devolucion = $2
          WHERE id = $3`,
        [user.sub, motivo.trim(), pagoId],
      );

      await this.auditoria.logUpdate({
        empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
        modulo: 'pagos', entidadId: pagoId,
        descripcion: `Adelanto devuelto S/ ${disponible.toFixed(2)} — ${motivo.trim()}`,
        req,
      });

      this.logger.log(`Adelanto ${pagoId} devuelto: S/ ${disponible} por ${user.email}`);
      return { devuelto: disponible };
    });
  }
}
