import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AuditoriaService } from '../auth/auditoria.service';

export interface ArqueoCuenta {
  cuentaId: string;
  nombre: string;
  tipo: string;
  moneda: string;
  /** Bruto cobrado: lo que pagaron los abonados. Es lo que hay que tener en la caja. */
  esperado: number;
  /** Lo que retuvieron los canales. En una caja física es 0; en pasarela, no. */
  comisiones: number;
  /** `esperado - comisiones`: lo que se busca en el extracto de una cuenta bancaria. */
  neto: number;
  cobros: number;
  porCajero: Array<{ cajeroId: string | null; email: string | null; monto: number; cobros: number }>;
}

/**
 * Arqueo y cierre de caja.
 *
 * Existe porque las cuentas receptoras de tipo `caja` son dinero físico que alguien tiene
 * en la mano, y el ERP solo sabe lo que le dijeron. El arqueo compara ambas cosas.
 *
 * Decisión de diseño que condiciona todo lo demás: **una caja con arqueo pertenece a UN
 * responsable**. Una "Caja Campo" compartida por todos los cobradores hace imposible saber
 * a quién le falta dinero — que es exactamente para lo que existe una caja.
 */
@Injectable()
export class ArqueoCajaService {
  private readonly logger = new Logger(ArqueoCajaService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Qué debería haber en cada cuenta en un periodo.
   *
   * Solo cuenta pagos `verificado`: un pago pendiente de verificar es dinero que aún no se
   * ha confirmado, y un extornado dejó de existir a efectos de caja. Ninguno de los dos
   * debe aparecer en un arqueo, y ambos aparecerían si el filtro fuera por fecha a secas.
   */
  async calcular(empresaId: string, desde: string, hasta: string): Promise<ArqueoCuenta[]> {
    const cuentas = await this.ds.query<Array<{
      cuenta_id: string; nombre: string; tipo: string; moneda: string;
      esperado: string; comisiones: string; cobros: string;
    }>>(`
      SELECT cb.id AS cuenta_id,
             COALESCE(cb.nombre, cb.banco) AS nombre,
             cb.tipo, cb.moneda,
             COALESCE(SUM(p.monto), 0)::text     AS esperado,
             COALESCE(SUM(p.comision), 0)::text  AS comisiones,
             COUNT(p.id)::text                   AS cobros
        FROM cuentas_bancarias cb
        LEFT JOIN pagos p
               ON p.cuenta_receptora_id = cb.id
              AND p.estado = 'verificado'
              AND p.fecha_pago BETWEEN $2 AND $3
       WHERE cb.empresa_id = $1 AND cb.activa
       GROUP BY cb.id, cb.nombre, cb.banco, cb.tipo, cb.moneda
       ORDER BY cb.tipo, nombre
    `, [empresaId, desde, hasta]);

    // Desglose por cajero: sin esto un descuadre dice que falta dinero pero no de quién.
    const porCajero = await this.ds.query<Array<{
      cuenta_id: string; cajero_id: string | null; email: string | null;
      monto: string; cobros: string;
    }>>(`
      SELECT p.cuenta_receptora_id AS cuenta_id, p.cajero_id, u.email,
             COALESCE(SUM(p.monto), 0)::text AS monto, COUNT(*)::text AS cobros
        FROM pagos p
        LEFT JOIN usuarios u ON u.id = p.cajero_id
       WHERE p.empresa_id = $1
         AND p.estado = 'verificado'
         AND p.fecha_pago BETWEEN $2 AND $3
         AND p.cuenta_receptora_id IS NOT NULL
       GROUP BY p.cuenta_receptora_id, p.cajero_id, u.email
       ORDER BY monto DESC
    `, [empresaId, desde, hasta]);

    return cuentas.map((c) => {
      const esperado   = parseFloat(c.esperado);
      const comisiones = parseFloat(c.comisiones);
      return {
        cuentaId: c.cuenta_id, nombre: c.nombre, tipo: c.tipo, moneda: c.moneda,
        esperado, comisiones,
        neto: Number((esperado - comisiones).toFixed(2)),
        cobros: parseInt(c.cobros, 10),
        porCajero: porCajero
          .filter((k) => k.cuenta_id === c.cuenta_id)
          .map((k) => ({
            cajeroId: k.cajero_id, email: k.email,
            monto: parseFloat(k.monto), cobros: parseInt(k.cobros, 10),
          })),
      };
    });
  }

  /**
   * Registra el cierre. `contado` es lo que se contó físicamente.
   *
   * La diferencia se guarda tal cual, con signo. **No se corrige nada**: el arqueo
   * constata, no ajusta. Un ERP que "cuadra" la caja moviendo cifras destruye justo la
   * información por la que existe el arqueo.
   */
  async cerrar(
    empresaId: string,
    dto: { cuentaId: string; desde: string; hasta: string; contado: number; nota?: string },
    user: JwtPayload,
    req?: any,
  ) {
    const arqueo = await this.calcular(empresaId, dto.desde, dto.hasta);
    const cuenta = arqueo.find((a) => a.cuentaId === dto.cuentaId);
    if (!cuenta) throw new BadRequestException('La cuenta no existe o no está activa');

    const diferencia = Number((dto.contado - cuenta.esperado).toFixed(2));

    // Un descuadre sin explicación es exactamente lo que el arqueo existe para detectar.
    // Dejarlo pasar en silencio convierte el control en un trámite.
    if (Math.abs(diferencia) > 0.01 && !dto.nota?.trim()) {
      throw new BadRequestException(
        `Hay una diferencia de S/ ${diferencia.toFixed(2)} entre lo esperado ` +
        `(S/ ${cuenta.esperado.toFixed(2)}) y lo contado (S/ ${dto.contado.toFixed(2)}). ` +
        `Explica a qué se debe antes de cerrar.`,
      );
    }

    const [fila] = await this.ds.query(`
      INSERT INTO cierre_caja (empresa_id, cuenta_id, desde, hasta, esperado, contado,
                               diferencia, nota, usuario_id, usuario_email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, esperado, contado, diferencia, created_at
    `, [
      empresaId, dto.cuentaId, dto.desde, dto.hasta,
      cuenta.esperado, dto.contado, diferencia, dto.nota ?? null,
      user.sub, user.email,
    ]);

    await this.auditoria.logCreate({
      empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'cobranza', entidadId: fila.id,
      descripcion:
        `Cierre de caja "${cuenta.nombre}" ${dto.desde}→${dto.hasta} | ` +
        `esperado S/ ${cuenta.esperado.toFixed(2)} · contado S/ ${dto.contado.toFixed(2)} · ` +
        `diferencia S/ ${diferencia.toFixed(2)}` + (dto.nota ? ` | ${dto.nota}` : ''),
      req,
    });

    if (Math.abs(diferencia) > 0.01) {
      this.logger.warn(
        `[ARQUEO] Descuadre de S/ ${diferencia.toFixed(2)} en "${cuenta.nombre}" ` +
        `(${dto.desde}→${dto.hasta}), declarado por ${user.email}: ${dto.nota}`,
      );
    }

    return { ...fila, cuenta: cuenta.nombre };
  }

  async historial(empresaId: string, limite = 50) {
    return this.ds.query(`
      SELECT cc.*, COALESCE(cb.nombre, cb.banco) AS cuenta_nombre
        FROM cierre_caja cc
        JOIN cuentas_bancarias cb ON cb.id = cc.cuenta_id
       WHERE cc.empresa_id = $1
       ORDER BY cc.created_at DESC
       LIMIT $2
    `, [empresaId, limite]);
  }
}
