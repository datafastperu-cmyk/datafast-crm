import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { XuiLine, EstadoSyncXuiLine } from './entities/xui-line.entity';
import { XuiApiService } from './xui-api.service';
import { EditarXuiLineDto, FilterXuiLineDto } from './dto/xui-line.dto';
import { encrypt, decrypt } from '../../common/utils/encryption.util';
import { NOTIFICATION_EVENTS } from '../notificaciones/events/notification.events';
import { ResultadoOperacion, clasificarError } from '../../common/domain/resultado-operacion';

const MAX_INTENTOS_SYNC = 6;

// Solo alfanumérico, longitud acotada — nunca se interpola el DNI crudo
// del cliente en el payload HTTP hacia XUI.
function sanitizarCredencial(valor: string): string {
  return (valor || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
}

@Injectable()
export class XuiLinesService {
  private readonly logger = new Logger(XuiLinesService.name);

  constructor(
    @InjectRepository(XuiLine)
    private readonly repo: Repository<XuiLine>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly xuiApi: XuiApiService,
    private readonly events: EventEmitter2,
  ) {}

  // ────────────────────────────────────────────────────────────
  // CREACIÓN — un line por contrato/servicio, con sufijo anti-duplicado
  // ────────────────────────────────────────────────────────────

  // Ola 1, grupo 3b (2026-08-16). Único consumidor: ContratosService (fire-and-forget vía
  // `setImmediate` en `create()`/`actualizarServicio()` — ningún llamador lee el `XuiLine`
  // devuelto, se verificó antes de convertir). El local (fila creada/`ya_en_destino`) define
  // `aplicado`: XUI IPTV está declarado módulo degradable (CLAUDE.md) — la sincronización HTTP
  // sigue siendo best-effort con su propio contador de reintentos y el barrido de
  // `xui-monitor.service.ts` (~10 min) como red de seguridad, sin cambiar ese diseño.
  async crearLineParaContrato(contratoId: string, empresaId: string): Promise<ResultadoOperacion> {
    try {
      const [contrato] = await this.dataSource.query<any[]>(
        `SELECT c.id, c.cliente_id AS "clienteId", c.plan_id AS "planId"
         FROM servicios c WHERE c.id = $1 AND c.empresa_id = $2 AND c.deleted_at IS NULL`,
        [contratoId, empresaId],
      );
      if (!contrato) {
        return { clase: 'rechazado_definitivo', motivo: `Contrato ${contratoId} no encontrado` };
      }

      const [plan] = await this.dataSource.query<any[]>(
        `SELECT id, cuenta_iptv AS "cuentaIptv", sesiones_iptv AS "sesionesIptv",
                xui_bouquet_ids AS "xuiBouquetIds"
         FROM planes WHERE id = $1 AND empresa_id = $2`,
        [contrato.planId, empresaId],
      );
      if (!plan?.cuentaIptv) {
        return { clase: 'no_aplica', mensaje: 'El plan del contrato no incluye IPTV.' };
      }

      const [cliente] = await this.dataSource.query<any[]>(
        `SELECT numero_documento AS "numeroDocumento" FROM clientes WHERE id = $1 AND empresa_id = $2`,
        [contrato.clienteId, empresaId],
      );
      if (!cliente?.numeroDocumento) {
        this.logger.warn(`Cliente ${contrato.clienteId} sin numeroDocumento — no se puede crear line IPTV`);
        return { clase: 'no_aplica', mensaje: 'El cliente no tiene número de documento — nada que crear.' };
      }

      // ── Lock pesimista sobre las filas existentes del cliente ──
      // Serializa el cálculo del sufijo entre contratos del mismo cliente
      // activándose en paralelo (ver punto 2 de la sección de resiliencia del plan).
      const { line, yaExistia } = await this.dataSource.transaction(async (manager) => {
        const yaExiste = await manager
          .getRepository(XuiLine)
          .createQueryBuilder('l')
          .setLock('pessimistic_write')
          .where('l.contratoId = :contratoId AND l.empresaId = :empresaId', { contratoId, empresaId })
          .andWhere('l.activo = true')
          .getOne();
        if (yaExiste) return { line: yaExiste, yaExistia: true }; // idempotencia: el hook ya corrió para este contrato

        const existentes = await manager
          .getRepository(XuiLine)
          .createQueryBuilder('l')
          .setLock('pessimistic_write')
          .where('l.clienteId = :clienteId AND l.empresaId = :empresaId', { clienteId: contrato.clienteId, empresaId })
          .getMany();

        const siguienteSufijo = existentes.length + 1;
        const base     = sanitizarCredencial(cliente.numeroDocumento);
        const usuario  = siguienteSufijo === 1 ? base : `${base}${siguienteSufijo}`;
        const password = usuario;

        const nueva = manager.getRepository(XuiLine).create({
          empresaId,
          contratoId,
          clienteId:     contrato.clienteId,
          usuario,
          password:      encrypt(password),
          sufijo:        siguienteSufijo,
          bouquetIds:    plan.xuiBouquetIds || [],
          maxConexiones: plan.sesionesIptv || 1,
          activo:        true,
          estadoSync:    EstadoSyncXuiLine.PENDIENTE_CREACION,
        });

        return { line: await manager.getRepository(XuiLine).save(nueva), yaExistia: false };
      });

      if (yaExistia) {
        return { clase: 'ya_en_destino', mensaje: 'El contrato ya tiene un line IPTV activo.' };
      }

      // Fuera de la transacción de BD: la llamada HTTP a XUI no bloquea
      // ni revierte el alta del contrato si falla (módulo degradable).
      await this.intentarSincronizarCreacion(line).catch((err) =>
        this.logger.warn(`Creación en XUI diferida para line ${line.id}: ${err.message}`),
      );
      return { clase: 'aplicado', mensaje: `Line IPTV creado (sincronización con XUI en curso): ${line.usuario}` };
    } catch (err) {
      return clasificarError(err);
    }
  }

  private async intentarSincronizarCreacion(line: XuiLine): Promise<void> {
    if (line.estadoSync !== EstadoSyncXuiLine.PENDIENTE_CREACION) return;
    if (line.xuiLineId) { // idempotencia: ya se creó en un intento anterior
      await this.repo.update(line.id, { estadoSync: EstadoSyncXuiLine.SINCRONIZADO, sincronizadoEn: new Date() });
      return;
    }

    try {
      const passwordPlano = decrypt(line.password);
      let remoto;
      try {
        remoto = await this.xuiApi.crearLine({
          username:       line.usuario,
          password:       passwordPlano,
          bouquetIds:     line.bouquetIds,
          maxConnections: line.maxConexiones,
        });
      } catch (err) {
        if (err instanceof ConflictException) {
          // Colisión de usuario en XUI: reutilizar si es el mismo cliente, si no, error explícito
          const existenteRemoto = await this.xuiApi.buscarLinePorUsuario(line.usuario);
          if (existenteRemoto) {
            remoto = existenteRemoto;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      await this.repo.update(line.id, {
        xuiLineId:      remoto.id,
        estadoSync:     EstadoSyncXuiLine.SINCRONIZADO,
        sincronizadoEn: new Date(),
        ultimoErrorSync: null,
      });

      // Evento de dominio — desacopla XUI de mensajería. Solo la primera
      // vez que el line queda sincronizado (no en reconciliaciones futuras).
      this.dataSource.query<any[]>(
        `SELECT whatsapp, telefono, nombre_completo AS "nombreCompleto"
         FROM clientes WHERE id = $1 AND deleted_at IS NULL`,
        [line.clienteId],
      ).then(([cliente]) => {
        const telefono = cliente?.whatsapp || cliente?.telefono;
        if (!telefono) return;
        this.events.emit(NOTIFICATION_EVENTS.IPTV_LINE_CREADA, {
          telefono,
          clienteNombre: cliente.nombreCompleto,
          usuario:       line.usuario,
          password:      passwordPlano,
          empresaId:     line.empresaId,
          contratoId:    line.contratoId,
          clienteId:     line.clienteId,
        });
      }).catch((e: any) => this.logger.warn(`No se pudo emitir IPTV_LINE_CREADA: ${e?.message}`));
    } catch (err: any) {
      await this.repo.increment({ id: line.id }, 'intentosSync', 1);
      const intentos = line.intentosSync + 1;
      await this.repo.update(line.id, {
        estadoSync:      intentos >= MAX_INTENTOS_SYNC ? EstadoSyncXuiLine.ERROR : EstadoSyncXuiLine.PENDIENTE_CREACION,
        ultimoErrorSync: err.message,
      });
      throw err;
    }
  }

  // ────────────────────────────────────────────────────────────
  // BAJA AUTOMÁTICA — cuando el contrato dueño cambia a plan sin IPTV
  // ────────────────────────────────────────────────────────────

  // Ola 1, grupo 3b. Consumida por ContratosService (fire-and-forget y como paso de saga
  // con timeout en `cambiarEstado()` baja — ver F-0.1 §9.1 para la traducción de cada sitio).
  async eliminarLineDeContrato(contratoId: string, empresaId: string): Promise<ResultadoOperacion> {
    try {
      const line = await this.repo.findOne({ where: { contratoId, empresaId, activo: true } });
      if (!line) return { clase: 'no_aplica', mensaje: 'El contrato no tiene line IPTV activo.' };

      await this.repo.update(line.id, { estadoSync: EstadoSyncXuiLine.PENDIENTE_ELIMINACION });
      await this.intentarSincronizarEliminacion(line).catch((err) =>
        this.logger.warn(`Eliminación en XUI diferida para line ${line.id}: ${err.message}`),
      );
      return { clase: 'aplicado', mensaje: 'Line IPTV marcado para eliminación (sincronización con XUI en curso).' };
    } catch (err) {
      return clasificarError(err);
    }
  }

  private async intentarSincronizarEliminacion(line: XuiLine): Promise<void> {
    try {
      if (line.xuiLineId) {
        await this.xuiApi.eliminarLine(line.xuiLineId);
      }
      await this.repo.softDelete(line.id);
      await this.repo.update(line.id, { activo: false });
    } catch (err: any) {
      await this.repo.increment({ id: line.id }, 'intentosSync', 1);
      await this.repo.update(line.id, { ultimoErrorSync: err.message });
      throw err;
    }
  }

  // ────────────────────────────────────────────────────────────
  // HABILITAR / DESHABILITAR — ligado al EstadoContrato (suspender/
  // reactivar), no a cambio de plan. El line es un recurso persistente:
  // se togglea, nunca se recrea. Si la llamada a XUI falla, el barrido
  // de reconciliación de xui-monitor.service.ts la corrige (~10 min).
  // ────────────────────────────────────────────────────────────

  // Ola 1, grupo 3b. Consumida por ContratosService.cambiarEstado() (reactivación),
  // fire-and-forget con `.catch(logger.warn)` en el llamador — ese catch envolvía una
  // excepción real de `xuiApi.enableLine()` sin capturar aquí dentro; se mueve el catch a
  // este método para clasificar en vez de solo loguear. Mismo desenlace que antes: si XUI
  // falla, el flag local NO se marca `habilitado` y el barrido de xui-monitor.service.ts
  // (~10 min) reintenta — eso ya era el diseño, ahora es explícito en la clase devuelta.
  async habilitarLineDeContrato(contratoId: string, empresaId: string): Promise<ResultadoOperacion> {
    try {
      const line = await this.repo.findOne({ where: { contratoId, empresaId, activo: true } });
      if (!line) return { clase: 'no_aplica', mensaje: 'El contrato no tiene line IPTV activo.' };
      if (line.habilitado) return { clase: 'ya_en_destino', mensaje: 'El line ya estaba habilitado.' };
      if (line.xuiLineId) await this.xuiApi.enableLine(line.xuiLineId);
      await this.repo.update(line.id, { habilitado: true });
      return { clase: 'aplicado', mensaje: 'Line IPTV habilitado.' };
    } catch (err) {
      return clasificarError(err);
    }
  }

  // Ola 1, grupo 3b. Simétrico a habilitarLineDeContrato() — mismo fix del catch movido
  // aquí dentro y mismo desenlace preservado (flag local no se toca si XUI falla).
  async deshabilitarLineDeContrato(contratoId: string, empresaId: string): Promise<ResultadoOperacion> {
    try {
      const line = await this.repo.findOne({ where: { contratoId, empresaId, activo: true } });
      if (!line) return { clase: 'no_aplica', mensaje: 'El contrato no tiene line IPTV activo.' };
      if (!line.habilitado) return { clase: 'ya_en_destino', mensaje: 'El line ya estaba deshabilitado.' };
      if (line.xuiLineId) await this.xuiApi.disableLine(line.xuiLineId);
      await this.repo.update(line.id, { habilitado: false });
      return { clase: 'aplicado', mensaje: 'Line IPTV deshabilitado.' };
    } catch (err) {
      return clasificarError(err);
    }
  }

  // ────────────────────────────────────────────────────────────
  // EDICIÓN / LECTURA
  // ────────────────────────────────────────────────────────────

  async editarLine(id: string, empresaId: string, dto: EditarXuiLineDto): Promise<XuiLine> {
    const line = await this.repo.findOne({ where: { id, empresaId, activo: true } });
    if (!line) throw new NotFoundException(`Line IPTV ${id} no encontrado`);

    const cambiosRemoto: any = {};
    if (dto.bouquetIds)     cambiosRemoto.bouquetIds     = dto.bouquetIds;
    if (dto.maxConexiones)  cambiosRemoto.maxConnections = dto.maxConexiones;

    let nuevoPasswordPlano: string | undefined;
    if (dto.regenerarCredenciales) {
      nuevoPasswordPlano   = line.usuario; // mismo esquema DNI/DNI2 — solo re-sincroniza contra XUI
      cambiosRemoto.password = nuevoPasswordPlano;
    }

    if (line.xuiLineId && Object.keys(cambiosRemoto).length > 0) {
      await this.xuiApi.editarLine(line.xuiLineId, cambiosRemoto);
    }

    const update: Partial<XuiLine> = {};
    if (dto.bouquetIds)    update.bouquetIds    = dto.bouquetIds;
    if (dto.maxConexiones) update.maxConexiones = dto.maxConexiones;
    if (nuevoPasswordPlano) update.password     = encrypt(nuevoPasswordPlano);

    await this.repo.update(id, update);
    return this.repo.findOne({ where: { id } });
  }

  async listar(empresaId: string, filtros: FilterXuiLineDto): Promise<XuiLine[]> {
    const qb = this.repo.createQueryBuilder('l')
      .where('l.empresaId = :empresaId', { empresaId })
      .andWhere('l.activo = true');
    if (filtros.clienteId)  qb.andWhere('l.clienteId = :clienteId', { clienteId: filtros.clienteId });
    if (filtros.contratoId) qb.andWhere('l.contratoId = :contratoId', { contratoId: filtros.contratoId });
    if (filtros.q)          qb.andWhere('l.usuario ILIKE :q', { q: `%${filtros.q}%` });
    return qb.orderBy('l.createdAt', 'DESC').getMany();
  }

  // ────────────────────────────────────────────────────────────
  // RECONCILIADOR — invocado por xui-monitor.service.ts (cron)
  // ────────────────────────────────────────────────────────────

  async reconciliarPendientes(): Promise<void> {
    const pendientesCreacion = await this.repo.find({
      where: { estadoSync: EstadoSyncXuiLine.PENDIENTE_CREACION },
      take: 50,
    });
    for (const line of pendientesCreacion) {
      await this.intentarSincronizarCreacion(line).catch(() => {});
    }

    const pendientesEliminacion = await this.repo.find({
      where: { estadoSync: EstadoSyncXuiLine.PENDIENTE_ELIMINACION },
      take: 50,
    });
    for (const line of pendientesEliminacion) {
      await this.intentarSincronizarEliminacion(line).catch(() => {});
    }
  }
}
