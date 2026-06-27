import {
  Injectable, Logger, BadRequestException,
  ConflictException, NotFoundException,
} from '@nestjs/common';
import { InjectRepository }  from '@nestjs/typeorm';
import { InjectDataSource }  from '@nestjs/typeorm';
import { Repository, DataSource, LessThan, In } from 'typeorm';
import { Cron }              from '@nestjs/schedule';
import { OnEvent }           from '@nestjs/event-emitter';

import { PromesaPago, EstadoPromesa } from './entities/promesa-pago.entity';
import { FirewallService }            from '../mikrotik/services/firewall.service';
import { PppoeService }               from '../mikrotik/services/pppoe.service';
import { OutboxRedService }           from '../outbox-red/outbox-red.service';
import { decrypt }                    from '../../common/utils/encryption.util';
import { JwtPayload }                 from '../../common/decorators/current-user.decorator';

export interface CrearPromesaDto {
  contratoId:       string;
  fechaVencimiento: string;  // 'YYYY-MM-DD'
  motivo?:          string;
}

export interface EventPromesaVerificarCumplimiento {
  contratoId: string;
  pagoId:     string;
  deuda:      number;
}

const MAX_DIAS_PRORROGA = 15;

@Injectable()
export class PromesasPagoService {
  private readonly logger = new Logger(PromesasPagoService.name);

  constructor(
    @InjectRepository(PromesaPago)
    private readonly repo: Repository<PromesaPago>,
    @InjectDataSource()
    private readonly ds: DataSource,
    private readonly firewallSvc: FirewallService,
    private readonly pppoeSvc:    PppoeService,
    private readonly outboxSvc:   OutboxRedService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // CREAR PROMESA
  // ────────────────────────────────────────────────────────────
  async crear(dto: CrearPromesaDto, user: JwtPayload): Promise<PromesaPago> {
    const hoy = new Date().toISOString().split('T')[0];

    if (dto.fechaVencimiento <= hoy)
      throw new BadRequestException('La fecha de vencimiento debe ser futura');

    const diasDiff = Math.ceil(
      (new Date(dto.fechaVencimiento).getTime() - Date.now()) / 86_400_000,
    );
    if (diasDiff > MAX_DIAS_PRORROGA)
      throw new BadRequestException(`Máximo ${MAX_DIAS_PRORROGA} días de prórroga`);

    // Cargar contrato con snapshot de datos de red
    const [contrato] = await this.ds.query<any[]>(`
      SELECT c.id, c.empresa_id, c.cliente_id, c.estado,
             c.ip_asignada, c.router_id, c.usuario_pppoe,
             c.deuda_total, c.en_prorroga,
             cl.nombre_completo AS nombre_cliente
      FROM   contratos c
      JOIN   clientes cl ON cl.id = c.cliente_id
      WHERE  c.id = $1 AND c.deleted_at IS NULL
    `, [dto.contratoId]);

    if (!contrato)
      throw new NotFoundException('Contrato no encontrado');

    if (contrato.empresa_id !== user.empresaId)
      throw new NotFoundException('Contrato no encontrado');

    const estadosPermitidos = ['activo', 'moroso', 'cortado', 'suspendido'];
    if (!estadosPermitidos.includes(contrato.estado))
      throw new BadRequestException(`No se puede crear promesa en contrato con estado "${contrato.estado}"`);

    // Verificar que no exista ya una promesa activa (el índice UNIQUE lo garantiza en BD,
    // pero verificamos antes para dar un mensaje claro)
    const existente = await this.repo.findOne({
      where: { contratoId: dto.contratoId, estado: EstadoPromesa.ACTIVA },
    });
    if (existente)
      throw new ConflictException(
        `Ya existe una promesa activa para este contrato (vence ${existente.fechaVencimiento})`,
      );

    // Guardar en BD + actualizar campos de prórroga en contrato (transacción)
    const promesa = await this.ds.transaction(async (em) => {
      const nueva = em.create(PromesaPago, {
        empresaId:            contrato.empresa_id,
        contratoId:           dto.contratoId,
        clienteId:            contrato.cliente_id,
        estado:               EstadoPromesa.ACTIVA,
        fechaVencimiento:     dto.fechaVencimiento,
        montoPrometido:       Number(contrato.deuda_total) || 0,
        deudaAlCrear:         Number(contrato.deuda_total) || 0,
        ipClienteSnapshot:    contrato.ip_asignada   || null,
        routerIdSnapshot:     contrato.router_id     || null,
        usuarioPppoeSnapshot: contrato.usuario_pppoe || null,
        contratoEstadoPrevio: contrato.estado,
        motivo:               dto.motivo || 'Promesa de pago',
        otorgadaPor:          user.sub,
        mikrotikAplicado:     false,
        createdBy:            user.sub,
      });
      const saved = await em.save(nueva);

      await em.query(`
        UPDATE contratos
        SET    en_prorroga        = TRUE,
               prorroga_hasta     = $1,
               prorroga_motivo    = $2,
               prorroga_otorgada_por = $3,
               updated_at         = NOW()
        WHERE  id = $4
      `, [dto.fechaVencimiento, dto.motivo || 'Promesa de pago', user.sub, dto.contratoId]);

      // Reactivar contrato suspendido manualmente durante el período de la promesa
      if (contrato.estado === 'suspendido') {
        await em.query(`
          UPDATE contratos
          SET    estado = 'activo', fecha_estado = NOW(), updated_at = NOW()
          WHERE  id = $1
        `, [dto.contratoId]);

        // Sincronizar clientes.estado solo si no quedan otros contratos bloqueados
        const [clienteActualizado] = await em.query<{ id: string }[]>(`
          UPDATE clientes
          SET    estado = 'activo', fecha_estado = NOW()
          WHERE  id = $1
            AND  estado = 'suspendido'
            AND  NOT EXISTS (
              SELECT 1 FROM contratos
              WHERE  cliente_id = $1
                AND  estado IN ('suspendido', 'moroso', 'cortado')
                AND  deleted_at IS NULL
                AND  id != $2
            )
          RETURNING id
        `, [contrato.cliente_id, dto.contratoId]);

        if (clienteActualizado) {
          await em.query(`
            INSERT INTO clientes_historial_estados
              (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
            VALUES ($1, $2, 'suspendido', 'activo', $3, $4, FALSE)
          `, [
            contrato.cliente_id,
            contrato.empresa_id,
            `Promesa de pago hasta ${dto.fechaVencimiento}: ${dto.motivo || '—'}`,
            user.sub,
          ]);
        }
      }

      const estadoNuevo = contrato.estado === 'suspendido' ? 'activo' : contrato.estado;
      await em.query(`
        INSERT INTO contratos_historial
          (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE)
      `, [
        dto.contratoId,
        contrato.empresa_id,
        contrato.estado,
        estadoNuevo,
        `Promesa de pago hasta ${dto.fechaVencimiento}: ${dto.motivo || '—'}`,
        user.sub,
      ]);

      return saved;
    });

    // Aplicar en MikroTik (best-effort, fuera de la TX)
    if (contrato.ip_asignada && contrato.router_id) {
      try {
        const creds = await this.buildCreds(contrato.router_id);
        // Para suspendido: primero limpiar address-lists de bloqueo, luego aplicar prorroga
        if (contrato.estado === 'suspendido') {
          await this.firewallSvc.reactivarCliente(creds, contrato.ip_asignada);
        }
        await this.firewallSvc.aplicarProrroga(
          creds,
          contrato.ip_asignada,
          `Promesa: ${contrato.nombre_cliente ?? contrato.cliente_id} | ${new Date().toLocaleDateString('es-PE')}`,
        );
        // Re-habilitar PPPoE para CORTADO o SUSPENDIDO
        if (['cortado', 'suspendido'].includes(contrato.estado) && contrato.usuario_pppoe) {
          await this.pppoeSvc.setEstado(creds, contrato.usuario_pppoe, false);
        }
        await this.repo.update(promesa.id, {
          mikrotikAplicado:  true,
          mikrotikAplicadoEn: new Date(),
        });
        promesa.mikrotikAplicado = true;
        this.logger.log(`[Promesa] MikroTik OK — promesa=${promesa.id} ip=${contrato.ip_asignada}`);
      } catch (err: any) {
        this.logger.warn(
          `[Promesa] MikroTik falló — encolando para reintento. Error: ${err.message}`,
        );
        await this.repo.update(promesa.id, { mikrotikUltimoError: err.message?.slice(0, 500) });
        // Encolar para reintento automático
        await this.outboxSvc.encolarAplicarProrroga(dto.contratoId, contrato.router_id, {
          promesaId:            promesa.id,
          ipAsignada:           contrato.ip_asignada,
          usuarioPppoe:         contrato.usuario_pppoe || undefined,
          contratoEstadoPrevio: contrato.estado,
          nombreCliente:        contrato.nombre_cliente,
        }).catch((e) => this.logger.error(`[Promesa] No se pudo encolar outbox: ${e.message}`));
      }
    } else {
      this.logger.warn(
        `[Promesa] Sin IP o router — promesa=${promesa.id} solo registrada en BD`,
      );
    }

    return promesa;
  }

  // ────────────────────────────────────────────────────────────
  // CANCELAR PROMESA (operador)
  // ────────────────────────────────────────────────────────────
  async cancelar(id: string, motivo: string, user: JwtPayload): Promise<PromesaPago> {
    const promesa = await this.repo.findOne({ where: { id, empresaId: user.empresaId } });
    if (!promesa) throw new NotFoundException('Promesa no encontrada');
    if (promesa.estado !== EstadoPromesa.ACTIVA)
      throw new BadRequestException(`Solo se puede cancelar una promesa ACTIVA (estado: ${promesa.estado})`);

    // UPDATE atómico con WHERE estado = 'activa': evita race condition contra procesarVencidas().
    // Si el cron movió la promesa a VENCIDA_PENDIENTE entre el findOne y aquí, RETURNING devuelve
    // 0 filas y abortamos antes de tocar MikroTik o los contratos.
    const [cancelada] = await this.ds.query<{ id: string }[]>(`
      UPDATE promesas_pago
      SET    estado       = 'cancelada',
             resuelta_por = $1,
             resuelta_en  = NOW(),
             motivo       = $2
      WHERE  id         = $3
        AND  estado     = 'activa'
        AND  empresa_id = $4
      RETURNING id
    `, [user.sub, motivo || promesa.motivo, id, user.empresaId]);

    if (!cancelada) {
      throw new ConflictException(
        `La promesa ya fue procesada concurrentemente (estado: ${promesa.estado}). Recarga la página y reintenta.`,
      );
    }

    // Estados que requieren volver a bloquear al cancelar la promesa
    const estadosBloqueo = ['suspendido', 'moroso', 'cortado'];
    const previo = promesa.contratoEstadoPrevio ?? 'activo';
    const debeRebloquear = estadosBloqueo.includes(previo);
    // Estado actual en BD: solo suspendido fue cambiado a 'activo' al crear la promesa
    const estadoActualEnBd = previo === 'suspendido' ? 'activo' : previo;

    // Limpiar flags de prorroga (siempre)
    await this.ds.query(`
      UPDATE contratos
      SET    en_prorroga  = FALSE,
             prorroga_hasta = NULL,
             updated_at   = NOW()
      WHERE  id = $1
    `, [promesa.contratoId]);

    // Restaurar estado suspendido (único caso que cambiamos en crear())
    if (previo === 'suspendido') {
      await this.ds.query(`
        UPDATE contratos
        SET    estado = 'suspendido', fecha_estado = NOW(), updated_at = NOW()
        WHERE  id = $1
      `, [promesa.contratoId]);

      // Revertir clientes.estado a suspendido si no quedan contratos activos
      const [clienteActualizado] = await this.ds.query<{ id: string }[]>(`
        UPDATE clientes
        SET    estado = 'suspendido', fecha_estado = NOW()
        WHERE  id = $1
          AND  estado = 'activo'
          AND  NOT EXISTS (
            SELECT 1 FROM contratos
            WHERE  cliente_id = $1
              AND  estado = 'activo'
              AND  deleted_at IS NULL
              AND  id != $2
          )
        RETURNING id
      `, [promesa.clienteId, promesa.contratoId]).catch(() => []);

      if (clienteActualizado) {
        await this.ds.query(`
          INSERT INTO clientes_historial_estados
            (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
          VALUES ($1, $2, 'activo', 'suspendido', $3, $4, FALSE)
        `, [
          promesa.clienteId,
          promesa.empresaId,
          `Promesa cancelada: ${motivo || promesa.motivo}`,
          user.sub,
        ]).catch((e: any) =>
          this.logger.warn(`[Promesa] historial cliente al cancelar: ${e.message}`),
        );
      }
    }

    await this.ds.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
      VALUES ($1, $2, $3, $4, $5, $6, FALSE)
    `, [
      promesa.contratoId,
      promesa.empresaId,
      estadoActualEnBd,
      previo,
      `Promesa cancelada: ${motivo || promesa.motivo}`,
      user.sub,
    ]);

    // Revertir MikroTik
    if (promesa.ipClienteSnapshot && promesa.routerIdSnapshot) {
      try {
        const creds = await this.buildCreds(promesa.routerIdSnapshot);
        if (debeRebloquear) {
          // Re-bloquear: agregar a morosos y quitar de prorroga
          await this.firewallSvc.suspenderCliente(
            creds,
            promesa.ipClienteSnapshot,
            promesa.contratoId,
            `Cancelación de promesa: ${motivo || promesa.motivo}`,
          );
          // Deshabilitar PPPoE si era cortado
          if (promesa.contratoEstadoPrevio === 'cortado' && promesa.usuarioPppoeSnapshot) {
            await this.pppoeSvc.setEstado(creds, promesa.usuarioPppoeSnapshot, true);
          }
          this.logger.log(`[Promesa] Cancelada + re-bloqueado: ip=${promesa.ipClienteSnapshot} estado=${promesa.contratoEstadoPrevio}`);
        } else {
          // El contrato era activo antes — dejar libre (quitar prorroga)
          await this.firewallSvc.reactivarCliente(creds, promesa.ipClienteSnapshot);
          this.logger.log(`[Promesa] Cancelada + reactivarCliente: ip=${promesa.ipClienteSnapshot}`);
        }
      } catch (err: any) {
        this.logger.warn(`[Promesa] No se pudo revertir firewall al cancelar: ${err.message}`);
      }
    }

    return this.repo.findOne({ where: { id } }) as Promise<PromesaPago>;
  }

  // ────────────────────────────────────────────────────────────
  // MARCAR CUMPLIDA — llamado por EventEmitter desde PagosService
  // ────────────────────────────────────────────────────────────
  @OnEvent('promesa.verificar_cumplimiento')
  async onPagoVerificado(event: EventPromesaVerificarCumplimiento): Promise<void> {
    if (event.deuda > 0) return; // deuda parcial, no aplica

    const promesa = await this.repo.findOne({
      where: {
        contratoId: event.contratoId,
        estado:     In([EstadoPromesa.ACTIVA, EstadoPromesa.VENCIDA_PENDIENTE]),
      },
    });
    if (!promesa) return;

    await this.repo.update(promesa.id, {
      estado:              EstadoPromesa.CUMPLIDA,
      resueltaEn:          new Date(),
      pagoIdCumplimiento:  event.pagoId,
    });

    await this.ds.query(`
      UPDATE contratos
      SET    en_prorroga = FALSE, prorroga_hasta = NULL, updated_at = NOW()
      WHERE  id = $1
    `, [promesa.contratoId]);

    // Quitar de TODAS las address-lists (prorroga y morosos)
    if (promesa.ipClienteSnapshot && promesa.routerIdSnapshot) {
      try {
        const creds = await this.buildCreds(promesa.routerIdSnapshot);
        await this.firewallSvc.reactivarCliente(creds, promesa.ipClienteSnapshot);
        if (promesa.usuarioPppoeSnapshot) {
          await this.pppoeSvc.setEstado(creds, promesa.usuarioPppoeSnapshot, false);
        }
        this.logger.log(`[Promesa] Cumplida y reactivada — promesa=${promesa.id}`);
      } catch (err: any) {
        this.logger.warn(`[Promesa] MikroTik falló en cumplimiento: ${err.message}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // SCHEDULER — Procesar promesas vencidas (cada minuto)
  // ────────────────────────────────────────────────────────────
  @Cron('* * * * *')
  async procesarVencidas(): Promise<void> {
    const hoy = new Date().toISOString().split('T')[0];

    const vencidas = await this.repo.find({
      where: { estado: EstadoPromesa.ACTIVA, fechaVencimiento: LessThan(hoy) },
      take: 50,
    });

    if (vencidas.length === 0) return;

    this.logger.log(`[Promesa] Procesando ${vencidas.length} promesas vencidas`);

    for (const p of vencidas) {
      await this.ejecutarCorte(p);
    }
  }

  // ────────────────────────────────────────────────────────────
  // SCHEDULER — Reintentar MikroTik en promesas activas sin apply (cada 5 min)
  // ────────────────────────────────────────────────────────────
  @Cron('0 */5 * * * *')
  async reintentarPendientes(): Promise<void> {
    const pendientes = await this.repo.find({
      where: {
        estado:           EstadoPromesa.ACTIVA,
        mikrotikAplicado: false,
        mikrotikReintentos: LessThan(5),
      },
      take: 20,
    });

    for (const p of pendientes) {
      if (!p.ipClienteSnapshot || !p.routerIdSnapshot) continue;
      try {
        const creds = await this.buildCreds(p.routerIdSnapshot);
        const [cl] = await this.ds.query<any[]>('SELECT nombre_completo FROM clientes WHERE id = $1', [p.clienteId]);
        await this.firewallSvc.aplicarProrroga(
          creds, p.ipClienteSnapshot,
          `Promesa: ${cl?.nombre_completo ?? p.clienteId} | ${new Date().toLocaleDateString('es-PE')}`,
        );
        await this.repo.update(p.id, { mikrotikAplicado: true, mikrotikAplicadoEn: new Date() });
        this.logger.log(`[Promesa] Reintento MK exitoso — promesa=${p.id}`);
      } catch (err: any) {
        await this.repo.increment({ id: p.id }, 'mikrotikReintentos', 1);
        await this.repo.update(p.id, { mikrotikUltimoError: err.message?.slice(0, 500) });
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // LISTAR (para el tab del frontend)
  // ────────────────────────────────────────────────────────────
  async listar(empresaId: string, filtros: {
    estado?: EstadoPromesa;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: any[]; meta: any }> {
    const page  = filtros.page  ?? 1;
    const limit = filtros.limit ?? 50;
    const offset = (page - 1) * limit;

    const whereEstado = filtros.estado
      ? `AND pp.estado = '${filtros.estado}'`
      : '';

    const rows = await this.ds.query<any[]>(`
      SELECT
        pp.id,
        pp.contrato_id       AS "contratoId",
        pp.estado,
        pp.fecha_vencimiento AS "fechaVencimiento",
        pp.monto_prometido   AS "montoPrometido",
        pp.deuda_al_crear    AS "deudaAlCrear",
        pp.mikrotik_aplicado AS "mikrotikAplicado",
        pp.mikrotik_reintentos AS "mikrotikReintentos",
        pp.motivo,
        pp.created_at        AS "creadaEn",
        pp.resuelta_en       AS "resueltaEn",
        c.nombre_completo    AS "clienteNombre",
        c.telefono           AS "clienteTelefono",
        co.numero_contrato   AS "numeroContrato",
        co.ip_asignada       AS "ipAsignada",
        ro.nombre            AS "routerNombre"
      FROM  promesas_pago pp
      JOIN  clientes  c  ON c.id  = pp.cliente_id
      JOIN  contratos co ON co.id = pp.contrato_id
      LEFT JOIN routers ro ON ro.id = pp.router_id_snapshot
      WHERE pp.empresa_id = $1
        ${whereEstado}
      ORDER BY pp.fecha_vencimiento ASC, pp.created_at DESC
      LIMIT $2 OFFSET $3
    `, [empresaId, limit, offset]);

    const [{ total }] = await this.ds.query<any[]>(`
      SELECT COUNT(*) AS total
      FROM   promesas_pago
      WHERE  empresa_id = $1 ${whereEstado}
    `, [empresaId]);

    return {
      data: rows,
      meta: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    };
  }

  async stats(empresaId: string): Promise<Record<string, number>> {
    const hoy = new Date().toISOString().split('T')[0];
    const [row] = await this.ds.query<any[]>(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'activa')                                    AS activas,
        COUNT(*) FILTER (WHERE estado = 'activa' AND fecha_vencimiento = $2)         AS vencen_hoy,
        COUNT(*) FILTER (WHERE estado IN ('vencida', 'vencida_pendiente'))           AS vencidas,
        COUNT(*) FILTER (WHERE estado = 'cumplida')                                  AS cumplidas
      FROM promesas_pago
      WHERE empresa_id = $1
    `, [empresaId, hoy]);

    return {
      activas:    Number(row.activas),
      vencenHoy:  Number(row.vencen_hoy),
      vencidas:   Number(row.vencidas),
      cumplidas:  Number(row.cumplidas),
    };
  }

  // ────────────────────────────────────────────────────────────
  // EJECUTAR CORTE (interno — llamado por el scheduler)
  // ────────────────────────────────────────────────────────────
  private async ejecutarCorte(promesa: PromesaPago): Promise<void> {
    // Marcar como VENCIDA_PENDIENTE ANTES de tocar el router
    // Si el proceso muere aquí, el scheduler lo reintenta en el siguiente tick
    await this.repo.update(promesa.id, { estado: EstadoPromesa.VENCIDA_PENDIENTE });

    if (!promesa.ipClienteSnapshot || !promesa.routerIdSnapshot) {
      // Sin datos de red — marcar vencida directamente y cortar contrato en BD
      await this.finalizarCorteEnBd(promesa);
      return;
    }

    try {
      const creds = await this.buildCreds(promesa.routerIdSnapshot);
      await this.firewallSvc.suspenderCliente(
        creds,
        promesa.ipClienteSnapshot,
        promesa.contratoId,
        `Prorroga vencida — promesa:${promesa.id}`,
      );
      if (promesa.usuarioPppoeSnapshot) {
        await this.pppoeSvc.desconectarSesion(creds, promesa.usuarioPppoeSnapshot);
        await this.pppoeSvc.setEstado(creds, promesa.usuarioPppoeSnapshot, true);
      }
      await this.finalizarCorteEnBd(promesa);
      this.logger.log(`[Promesa] Corte ejecutado — promesa=${promesa.id}`);
    } catch (err: any) {
      // Permanece VENCIDA_PENDIENTE — el outbox reintentará
      this.logger.warn(`[Promesa] Corte fallido, encolando outbox — ${err.message}`);
      await this.repo.increment({ id: promesa.id }, 'mikrotikReintentos', 1);
      await this.repo.update(promesa.id, { mikrotikUltimoError: err.message?.slice(0, 500) });

      await this.outboxSvc.encolarRevocarProrroga(
        promesa.contratoId,
        promesa.routerIdSnapshot,
        {
          promesaId:    promesa.id,
          ipAsignada:   promesa.ipClienteSnapshot,
          usuarioPppoe: promesa.usuarioPppoeSnapshot || undefined,
        },
      ).catch((e) => this.logger.error(`[Promesa] No se pudo encolar REVOCAR_PRORROGA: ${e.message}`));
    }
  }

  private async finalizarCorteEnBd(promesa: PromesaPago): Promise<void> {
    await this.repo.update(promesa.id, {
      estado:            EstadoPromesa.VENCIDA,
      mikrotikAplicado:  true,
      mikrotikAplicadoEn: new Date(),
      resueltaEn:        new Date(),
    });

    // Leer estado real antes del UPDATE para el historial (no hardcodear 'moroso')
    const [contratoActual] = await this.ds.query<{ estado: string }[]>(
      `SELECT estado FROM contratos WHERE id = $1`,
      [promesa.contratoId],
    );
    const estadoAnterior = contratoActual?.estado ?? promesa.contratoEstadoPrevio ?? 'moroso';

    await this.ds.query(`
      UPDATE contratos
      SET    estado        = 'cortado',
             en_prorroga   = FALSE,
             prorroga_hasta = NULL,
             fecha_estado   = NOW(),
             updated_at     = NOW()
      WHERE  id = $1
    `, [promesa.contratoId]);

    await this.ds.query(`
      INSERT INTO contratos_historial
        (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, automatico)
      VALUES ($1, $2, $3, 'cortado', 'Promesa de pago vencida — corte automático', TRUE)
    `, [promesa.contratoId, promesa.empresaId, estadoAnterior]);

    // Sincronizar clientes.estado a suspendido si no quedan contratos activos
    const [clienteActualizado] = await this.ds.query<{ id: string }[]>(`
      UPDATE clientes
      SET    estado = 'suspendido', fecha_estado = NOW()
      WHERE  id = $1
        AND  estado = 'activo'
        AND  NOT EXISTS (
          SELECT 1 FROM contratos
          WHERE  cliente_id = $1
            AND  estado = 'activo'
            AND  deleted_at IS NULL
            AND  id != $2
        )
      RETURNING id
    `, [promesa.clienteId, promesa.contratoId]).catch(() => []);

    if (clienteActualizado) {
      await this.ds.query(`
        INSERT INTO clientes_historial_estados
          (cliente_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
        VALUES ($1, $2, 'activo', 'suspendido', 'Promesa de pago vencida — corte automático', NULL, TRUE)
      `, [promesa.clienteId, promesa.empresaId]).catch((e: any) =>
        this.logger.warn(`[Promesa] historial cliente en corte: ${e.message}`),
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // Helper — construir credenciales MikroTik desde BD
  // ────────────────────────────────────────────────────────────
  private async buildCreds(routerId: string) {
    const [router] = await this.ds.query<any[]>(`
      SELECT ip_gestion, vpn_ip, usuario, password_cifrado,
             usar_ssl, puerto_api, puerto_api_ssl, version_ros, timeout_conexion
      FROM   routers WHERE id = $1
    `, [routerId]);

    if (!router) throw new Error(`Router ${routerId} no encontrado en BD`);

    let password = '';
    try { password = decrypt(router.password_cifrado); }
    catch { password = router.password_cifrado ?? ''; }

    return {
      id:              routerId,
      ip:              router.vpn_ip || router.ip_gestion,
      port:            router.usar_ssl ? (router.puerto_api_ssl ?? 8729) : (router.puerto_api ?? 8728),
      user:            router.usuario ?? 'admin',
      passwordCifrado: router.password_cifrado ?? '',
      useSsl:          router.usar_ssl ?? false,
      timeoutSec:      router.timeout_conexion ?? 10,
      version:         (router.version_ros === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };
  }
}
