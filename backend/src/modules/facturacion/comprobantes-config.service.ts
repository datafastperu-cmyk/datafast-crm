import {
  Injectable, Logger, NotFoundException,
  ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ComprobanteConfig } from './entities/comprobante-config.entity';
import { ConfiguracionFacturacion } from './entities/configuracion-facturacion.entity';
import {
  CreateComprobanteConfigDto,
  UpdateComprobanteConfigDto,
  UpdateConfiguracionFacturacionDto,
} from './dto/comprobante-config.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { filasUpdateReturning } from '../../common/utils/pg-result.util';

@Injectable()
export class ComprobantesConfigService {
  private readonly logger = new Logger(ComprobantesConfigService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── Tipos de comprobante ──────────────────────────────────────

  async listar(empresaId: string): Promise<ComprobanteConfig[]> {
    return this.ds.getRepository(ComprobanteConfig).find({
      where: { empresaId, deletedAt: null as any },
      order: { esDefault: 'DESC', nombre: 'ASC' },
    });
  }

  async crear(
    dto: CreateComprobanteConfigDto,
    user: JwtPayload,
  ): Promise<ComprobanteConfig> {
    const repo = this.ds.getRepository(ComprobanteConfig);

    // Código único por empresa
    const existe = await repo.findOne({
      where: { empresaId: user.empresaId, codigo: dto.codigo, deletedAt: null as any },
    });
    if (existe) {
      throw new ConflictException(`Ya existe un tipo de comprobante con el código '${dto.codigo}'`);
    }

    // Si se marca como default, quitar el default anterior
    if (dto.esDefault) {
      await this.ds.query(
        `UPDATE comprobantes_config SET es_default = false WHERE empresa_id = $1`,
        [user.empresaId],
      );
    }

    const nuevo = repo.create({
      empresaId:       user.empresaId,
      nombre:          dto.nombre,
      codigo:          dto.codigo,
      tieneCargaFiscal: dto.tieneCargaFiscal,
      serie:           dto.serie,
      correlativoActual: 0,
      esDefault:       dto.esDefault ?? false,
      activo:          true,
      creadoPor:       user.sub,
    });

    const saved = await repo.save(nuevo);
    this.logger.log(`Comprobante creado: ${dto.codigo} (${dto.nombre}) | empresa: ${user.empresaId}`);
    return saved;
  }

  async actualizar(
    id: string,
    dto: UpdateComprobanteConfigDto,
    user: JwtPayload,
  ): Promise<ComprobanteConfig> {
    const repo = this.ds.getRepository(ComprobanteConfig);
    const config = await repo.findOne({
      where: { id, empresaId: user.empresaId, deletedAt: null as any },
    });
    if (!config) throw new NotFoundException(`Tipo de comprobante ${id} no encontrado`);

    // Si cambia el código, verificar unicidad
    if (dto.codigo && dto.codigo !== config.codigo) {
      const existe = await repo.findOne({
        where: { empresaId: user.empresaId, codigo: dto.codigo, deletedAt: null as any },
      });
      if (existe) {
        throw new ConflictException(`Ya existe un tipo de comprobante con el código '${dto.codigo}'`);
      }
    }

    // Si se activa como default, desactivar el anterior
    if (dto.esDefault === true) {
      await this.ds.query(
        `UPDATE comprobantes_config SET es_default = false WHERE empresa_id = $1 AND id != $2`,
        [user.empresaId, id],
      );
    }

    Object.assign(config, dto);
    return repo.save(config);
  }

  // ── Regla de negocio: no eliminar si está en uso por clientes ──
  async eliminar(id: string, user: JwtPayload): Promise<void> {
    const repo = this.ds.getRepository(ComprobanteConfig);
    const config = await repo.findOne({
      where: { id, empresaId: user.empresaId, deletedAt: null as any },
    });
    if (!config) throw new NotFoundException(`Tipo de comprobante ${id} no encontrado`);

    if (config.esProtegido) {
      throw new BadRequestException(
        `El comprobante "${config.nombre}" es un comprobante de sistema y no puede eliminarse. Puede editarlo si necesita cambiar sus datos.`,
      );
    }

    // Verificar si algún cliente tiene este comprobante en su facturacion_config
    const [{ count }] = await this.ds.query(`
      SELECT COUNT(*)::int AS count
      FROM clientes
      WHERE empresa_id = $1
        AND deleted_at IS NULL
        AND facturacion_config->>'comprobanteConfigId' = $2
    `, [user.empresaId, id]);

    if (count > 0) {
      throw new BadRequestException(
        `No se puede eliminar: ${count} cliente(s) tienen este tipo de comprobante configurado. ` +
        `Reasigna su configuración antes de eliminar.`,
      );
    }

    // Verificar si hay facturas emitidas con este comprobante
    const [{ facturas }] = await this.ds.query(`
      SELECT COUNT(*)::int AS facturas
      FROM facturas
      WHERE empresa_id = $1
        AND comprobante_config_id = $2
        AND deleted_at IS NULL
      LIMIT 1
    `, [user.empresaId, id]);

    if (facturas > 0) {
      throw new BadRequestException(
        `No se puede eliminar: existen facturas emitidas con este tipo de comprobante. ` +
        `Puedes desactivarlo en su lugar.`,
      );
    }

    await repo.softDelete(id);
    this.logger.log(`Comprobante eliminado: ${config.codigo} | empresa: ${user.empresaId}`);
  }

  async setDefault(id: string, user: JwtPayload): Promise<ComprobanteConfig> {
    const repo = this.ds.getRepository(ComprobanteConfig);
    const config = await repo.findOne({
      where: { id, empresaId: user.empresaId, activo: true, deletedAt: null as any },
    });
    if (!config) throw new NotFoundException(`Tipo de comprobante ${id} no encontrado o inactivo`);

    await this.ds.query(
      `UPDATE comprobantes_config SET es_default = false WHERE empresa_id = $1`,
      [user.empresaId],
    );
    await repo.update(id, { esDefault: true });
    return { ...config, esDefault: true };
  }

  // ── Motor de resolución: qué comprobante usar para un cliente ──
  // Jerarquía: config individual cliente → default empresa → primer activo
  async resolverParaCliente(
    empresaId: string,
    clienteId: string,
  ): Promise<ComprobanteConfig> {
    const repo = this.ds.getRepository(ComprobanteConfig);

    // 1. Config individual del cliente
    const [cliente] = await this.ds.query(
      `SELECT facturacion_config FROM clientes WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [clienteId, empresaId],
    );
    const comprobanteConfigId = cliente?.facturacion_config?.comprobanteConfigId;
    if (comprobanteConfigId) {
      const config = await repo.findOne({
        where: { id: comprobanteConfigId, empresaId, activo: true, deletedAt: null as any },
      });
      if (config) return config;
    }

    // 2. Default de la empresa
    const defaultConfig = await repo.findOne({
      where: { empresaId, esDefault: true, activo: true, deletedAt: null as any },
    });
    if (defaultConfig) return defaultConfig;

    // 3. Primer tipo activo de la empresa
    const primero = await repo.findOne({
      where: { empresaId, activo: true, deletedAt: null as any },
      order: { createdAt: 'ASC' },
    });
    if (primero) return primero;

    throw new BadRequestException(
      'No hay tipos de comprobante configurados para esta empresa. ' +
      'Ve a /configuracion/facturacion-config y crea al menos uno.',
    );
  }

  // ── Incremento atómico de correlativo (sin race condition) ────
  // Usa UPDATE ... RETURNING en lugar de MAX()+1
  async siguienteCorrelativo(comprobanteConfigId: string): Promise<{ serie: string; correlativo: number }> {
    const [row] = filasUpdateReturning<{ serie: string; correlativo: string }>(await this.ds.query(`
      UPDATE comprobantes_config
      SET correlativo_actual = correlativo_actual + 1
      WHERE id = $1
      RETURNING serie, correlativo_actual AS correlativo
    `, [comprobanteConfigId]));

    if (!row) throw new NotFoundException(`ComprobanteConfig ${comprobanteConfigId} no encontrado`);
    const correlativo = parseInt(String(row.correlativo ?? 1), 10);
    return { serie: row.serie, correlativo: Number.isNaN(correlativo) ? 1 : correlativo };
  }

  // ── Configuración global de facturación ──────────────────────

  async getConfiguracion(empresaId: string): Promise<ConfiguracionFacturacion> {
    const repo = this.ds.getRepository(ConfiguracionFacturacion);
    let config = await repo.findOne({ where: { empresaId, deletedAt: null as any } });

    // Auto-crear si no existe (primera vez)
    if (!config) {
      config = repo.create({ empresaId });
      await repo.save(config);
    }
    return config;
  }

  async updateConfiguracion(
    dto: UpdateConfiguracionFacturacionDto,
    user: JwtPayload,
  ): Promise<ConfiguracionFacturacion> {
    const repo = this.ds.getRepository(ConfiguracionFacturacion);
    let config = await repo.findOne({
      where: { empresaId: user.empresaId, deletedAt: null as any },
    });

    if (!config) {
      config = repo.create({ empresaId: user.empresaId });
    }

    if (dto.moneda            !== undefined) config.moneda  = dto.moneda;
    if (dto.moneda2           !== undefined) config.moneda2 = dto.moneda2;
    if (dto.igvRate           !== undefined) config.igvRate = dto.igvRate / 100; // frontend envía 18, guardamos 0.18
    if (dto.moraAcumulaSiguienteCiclo    !== undefined) config.moraAcumulaSiguienteCiclo = dto.moraAcumulaSiguienteCiclo;
    if (dto.reconexionAcumulaSiguienteCiclo !== undefined) config.reconexionAcumulaSiguienteCiclo = dto.reconexionAcumulaSiguienteCiclo;
    config.actualizadoPor = user.sub;

    return repo.save(config);
  }

  // ── Resumen para el dashboard de la página de config ─────────
  async getResumen(empresaId: string): Promise<Record<string, any>> {
    const tipos = await this.listar(empresaId);
    const config = await this.getConfiguracion(empresaId);

    // Último correlativo por tipo
    const correlativos: Record<string, number> = {};
    for (const t of tipos) {
      correlativos[t.codigo] = t.correlativoActual;
    }

    const [{ total_emitidas, total_vencidas, monto_deuda }] = await this.ds.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado NOT IN ('anulada')) AS total_emitidas,
        COUNT(*) FILTER (
          WHERE fecha_vencimiento < CURRENT_DATE AND estado NOT IN ('pagada','anulada')
        ) AS total_vencidas,
        COALESCE(SUM(saldo) FILTER (
          WHERE estado IN ('emitida','pagada_parcial','vencida','en_cobranza')
        ), 0) AS monto_deuda
      FROM facturas
      WHERE empresa_id = $1 AND deleted_at IS NULL
    `, [empresaId]);

    return {
      tiposComprobante: tipos,
      configuracion:    config,
      correlativos,
      totalEmitidas:    parseInt(total_emitidas || '0', 10),
      totalVencidas:    parseInt(total_vencidas || '0', 10),
      montoDeudaPendiente: parseFloat(monto_deuda || '0'),
    };
  }

  // ── Bancos ────────────────────────────────────────────────────

  async listarBancos(empresaId: string) {
    const rows = await this.ds.query(
      `SELECT id, nombre, es_protegido AS "esProtegido", activo
       FROM bancos_isp
       WHERE empresa_id = $1 AND deleted_at IS NULL
       ORDER BY es_protegido DESC, nombre ASC`,
      [empresaId],
    );
    if (rows.length === 0) {
      await this.ds.query(
        `INSERT INTO bancos_isp (empresa_id, nombre, es_protegido) VALUES ($1, 'Banco 01', true)`,
        [empresaId],
      );
      return this.listarBancos(empresaId);
    }
    return rows;
  }

  async crearBanco(nombre: string, user: JwtPayload) {
    const [row] = await this.ds.query(
      `INSERT INTO bancos_isp (empresa_id, nombre)
       VALUES ($1, $2)
       RETURNING id, nombre, es_protegido AS "esProtegido", activo`,
      [user.empresaId, nombre.trim()],
    );
    return row;
  }

  async actualizarBanco(id: string, nombre: string, user: JwtPayload) {
    const [row] = filasUpdateReturning<Record<string, unknown>>(await this.ds.query(
      `UPDATE bancos_isp
       SET nombre = $1, updated_at = NOW(), version = version + 1
       WHERE id = $2 AND empresa_id = $3 AND deleted_at IS NULL
       RETURNING id, nombre, es_protegido AS "esProtegido", activo`,
      [nombre.trim(), id, user.empresaId],
    ));
    if (!row) throw new NotFoundException('Banco no encontrado');
    return row;
  }

  async eliminarBanco(id: string, user: JwtPayload): Promise<void> {
    const rows = await this.ds.query(
      `SELECT es_protegido FROM bancos_isp
       WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [id, user.empresaId],
    );
    if (!rows.length) throw new NotFoundException('Banco no encontrado');
    if (rows[0].es_protegido) {
      throw new BadRequestException('Este banco es del sistema y no se puede eliminar');
    }
    await this.ds.query(`UPDATE bancos_isp SET deleted_at = NOW() WHERE id = $1`, [id]);
  }

  // ── Formas de pago ────────────────────────────────────────────

  async listarFormasPago(empresaId: string) {
    const rows = await this.ds.query(
      `SELECT id, nombre, es_protegido AS "esProtegido", activo
       FROM formas_pago_isp
       WHERE empresa_id = $1 AND deleted_at IS NULL
       ORDER BY es_protegido DESC, nombre ASC`,
      [empresaId],
    );
    if (rows.length === 0) {
      await this.ds.query(
        `INSERT INTO formas_pago_isp (empresa_id, nombre, es_protegido)
         VALUES ($1, 'Efectivo', true), ($1, 'Transferencia', true), ($1, 'Depósito', true)`,
        [empresaId],
      );
      return this.listarFormasPago(empresaId);
    }
    return rows;
  }

  async crearFormaPago(nombre: string, user: JwtPayload) {
    const [row] = await this.ds.query(
      `INSERT INTO formas_pago_isp (empresa_id, nombre)
       VALUES ($1, $2)
       RETURNING id, nombre, es_protegido AS "esProtegido", activo`,
      [user.empresaId, nombre.trim()],
    );
    return row;
  }

  async actualizarFormaPago(id: string, nombre: string, user: JwtPayload) {
    const [row] = filasUpdateReturning<Record<string, unknown>>(await this.ds.query(
      `UPDATE formas_pago_isp
       SET nombre = $1, updated_at = NOW(), version = version + 1
       WHERE id = $2 AND empresa_id = $3 AND deleted_at IS NULL
       RETURNING id, nombre, es_protegido AS "esProtegido", activo`,
      [nombre.trim(), id, user.empresaId],
    ));
    if (!row) throw new NotFoundException('Forma de pago no encontrada');
    return row;
  }

  async eliminarFormaPago(id: string, user: JwtPayload): Promise<void> {
    const rows = await this.ds.query(
      `SELECT es_protegido FROM formas_pago_isp
       WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL`,
      [id, user.empresaId],
    );
    if (!rows.length) throw new NotFoundException('Forma de pago no encontrada');
    if (rows[0].es_protegido) {
      throw new BadRequestException('Esta forma de pago es del sistema y no se puede eliminar');
    }
    await this.ds.query(`UPDATE formas_pago_isp SET deleted_at = NOW() WHERE id = $1`, [id]);
  }
}
