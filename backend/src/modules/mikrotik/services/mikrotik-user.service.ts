import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository }             from 'typeorm';

import { Contrato, EstadoContrato } from '../../contratos/entities/contrato.entity';
import { Plan }                     from '../../planes/entities/plan.entity';
import { Router }                   from '../entities/router.entity';
import { RouterConnectionPool }     from './connection-pool.service';
import { PppoeService }             from './pppoe.service';
import { QueueService }             from './queue.service';
import { encrypt }                  from '../../../common/utils/encryption.util';
import {
  AuthType,
  CreateMikrotikUserDto,
  MikrotikUserResult,
} from '../dto/mikrotik-user.dto';

// ─── Credenciales internas (suficiente para el pool) ─────────
interface Creds {
  id:              string;
  ip:              string;
  port:            number;
  user:            string;
  passwordCifrado: string;
  useSsl:          boolean;
  timeoutSec:      number;
  version:         string;
}

@Injectable()
export class MikrotikUserService {
  private readonly logger = new Logger(MikrotikUserService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,

    @InjectRepository(Contrato)
    private readonly contratoRepo: Repository<Contrato>,

    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,

    @InjectRepository(Router)
    private readonly routerRepo: Repository<Router>,

    private readonly pool:     RouterConnectionPool,
    private readonly pppoeSvc: PppoeService,
    private readonly queueSvc: QueueService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Punto de entrada público
  // ──────────────────────────────────────────────────────────
  async crear(dto: CreateMikrotikUserDto, empresaId: string): Promise<MikrotikUserResult> {
    // 1. Cargar recursos necesarios ANTES de abrir la transacción
    const { contrato, plan, creds } = await this.cargarRecursos(dto.contratoId, empresaId);

    // 2. Ejecutar estrategia + transacción atómica
    switch (dto.authType) {
      case AuthType.PPPOE:    return this.crearPppoe(dto, contrato, plan, creds);
      case AuthType.ARP:      return this.crearArp(dto, contrato, plan, creds);
      case AuthType.DHCP_ARP: return this.crearDhcpArp(dto, contrato, plan, creds);
    }
  }

  async eliminar(contratoId: string, empresaId: string): Promise<void> {
    const contrato = await this.contratoRepo.findOne({
      where: { id: contratoId, empresaId, deletedAt: null as any },
    });
    if (!contrato) throw new NotFoundException(`Contrato ${contratoId} no encontrado`);
    if (!contrato.routerId) return;

    const creds = await this.buildCreds(contrato.routerId, empresaId);

    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // Limpiar según tipo guardado en BD
      await this.cleanupMikrotik(contrato, creds);

      await qr.manager.update(Contrato, contratoId, {
        usuarioPppoe: null as any,
        passwordPppoe: null as any,
        ipAsignada: null as any,
        macAddress: null as any,
        nombreQueue: null as any,
        tipoAuth: null as any,
        estado: EstadoContrato.PENDIENTE_ACTIVACION,
        fechaInstalacion: null as any,
      });

      await qr.commitTransaction();
      this.logger.log(`MikroTik: recursos eliminados para contrato ${contratoId}`);
    } catch (err: any) {
      await qr.rollbackTransaction();
      throw new InternalServerErrorException(
        `Error al eliminar recursos de MikroTik: ${err.message}`,
      );
    } finally {
      await qr.release();
    }
  }

  // ──────────────────────────────────────────────────────────
  // ESTRATEGIA: PPPoE
  // Crea /ppp/secret en RouterOS y persiste en BD.
  // ──────────────────────────────────────────────────────────
  private async crearPppoe(
    dto:      CreateMikrotikUserDto,
    contrato: Contrato,
    plan:     Plan,
    creds:    Creds,
  ): Promise<MikrotikUserResult> {
    const username = dto.username!;
    const password = dto.password!;
    const profile  = dto.pppoeProfile ?? plan.pppProfile ?? 'default';

    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let mikrotikId = '';
    try {
      // ── PASO 1: crear en RouterOS ─────────────────────────
      mikrotikId = await this.pppoeSvc.crear(creds, {
        name:          username,
        password,
        profile,
        service:       'pppoe',
        remoteAddress: contrato.ipAsignada || undefined,
        comment:       `CRM:${contrato.id.slice(0, 8)}`,
        disabled:      false,
      });

      // ── PASO 2: actualizar contrato en BD ─────────────────
      await qr.manager.update(Contrato, contrato.id, {
        usuarioPppoe:    username,
        passwordPppoe:   encrypt(password),
        tipoAuth:        AuthType.PPPOE,
        estado:          EstadoContrato.ACTIVO,
        fechaInstalacion: new Date(),
      });

      await qr.commitTransaction();
      this.logger.log(`PPPoE creado: ${username} en router ${creds.ip}`);

      return {
        contratoId:    contrato.id,
        authType:      AuthType.PPPOE,
        mikrotikId,
        usuarioPppoe:  username,
        ipAsignada:    contrato.ipAsignada,
      };
    } catch (err: any) {
      await qr.rollbackTransaction();

      // Compensar: si RouterOS ya creó el usuario, eliminarlo
      if (mikrotikId) {
        await this.pppoeSvc.eliminar(creds, username).catch((e: any) =>
          this.logger.error(`PPPoE rollback failed: ${e.message}`),
        );
      }

      this.lanzarErrorMikrotik('PPPoE', err);
    } finally {
      await qr.release();
    }
  }

  // ──────────────────────────────────────────────────────────
  // ESTRATEGIA: ARP estático
  // Crea /ip/arp + /queue/simple en RouterOS.
  // ──────────────────────────────────────────────────────────
  private async crearArp(
    dto:      CreateMikrotikUserDto,
    contrato: Contrato,
    plan:     Plan,
    creds:    Creds,
  ): Promise<MikrotikUserResult> {
    const ip        = dto.ipAddress!;
    const mac       = dto.macAddress!;
    const queueName = dto.queueName ?? `q-${ip.replace(/\./g, '-')}`;

    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let arpId    = '';
    let queueId  = '';
    try {
      // ── PASO 1: entrada ARP estática ──────────────────────
      arpId = await this.pool.execute(creds, async (api: any) => {
        // Verificar duplicados
        const existing = await api.write('/ip/arp/print', [`?address=${ip}`]);
        if (existing.length > 0) {
          this.logger.warn(`ARP: ${ip} ya existe, actualizando`);
          await api.write('/ip/arp/set', [
            `=.id=${existing[0]['.id']}`,
            `=mac-address=${mac}`,
            ...(dto.arpInterface ? [`=interface=${dto.arpInterface}`] : []),
            `=comment=CRM:${contrato.id.slice(0, 8)}`,
          ]);
          return existing[0]['.id'];
        }

        const res = await api.write('/ip/arp/add', [
          `=address=${ip}`,
          `=mac-address=${mac}`,
          ...(dto.arpInterface ? [`=interface=${dto.arpInterface}`] : []),
          `=comment=CRM:${contrato.id.slice(0, 8)}`,
        ]);
        return res?.[0]?.ret || '';
      });

      // ── PASO 2: Simple Queue ──────────────────────────────
      queueId = await this.queueSvc.crearSimpleQueue(creds, {
        name:         queueName,
        target:       ip,
        maxLimitDown: plan.velocidadBajada / 1000,
        maxLimitUp:   plan.velocidadSubida / 1000,
        ...(plan.burstBajada ? {
          burstLimitDown:  plan.burstBajada  / 1000,
          burstLimitUp:    plan.burstSubida  / 1000,
          burstTimeDown:   plan.burstTiempo,
          burstTimeUp:     plan.burstTiempo,
          burstThreshDown: plan.burstUmbral  / 1000,
          burstThreshUp:   plan.burstUmbral  / 1000,
        } : {}),
        priority: plan.prioridad,
        comment:  `CRM:${contrato.id.slice(0, 8)}`,
      });

      // ── PASO 3: actualizar contrato ───────────────────────
      await qr.manager.update(Contrato, contrato.id, {
        ipAsignada:       ip,
        macAddress:       mac,
        nombreQueue:      queueName,
        tipoAuth:         AuthType.ARP,
        estado:           EstadoContrato.ACTIVO,
        fechaInstalacion: new Date(),
      });

      await qr.commitTransaction();
      this.logger.log(`ARP + Queue creados: ${ip} / ${mac} en router ${creds.ip}`);

      return {
        contratoId:  contrato.id,
        authType:    AuthType.ARP,
        mikrotikId:  arpId,
        ipAsignada:  ip,
        macAddress:  mac,
        nombreQueue: queueName,
      };
    } catch (err: any) {
      await qr.rollbackTransaction();
      await this.compensarArp(creds, ip, queueName, !!arpId, !!queueId);
      this.lanzarErrorMikrotik('ARP', err);
    } finally {
      await qr.release();
    }
  }

  // ──────────────────────────────────────────────────────────
  // ESTRATEGIA: DHCP + ARP
  // Crea lease estático en /ip/dhcp-server/lease,
  // lo fija en /ip/arp y añade Simple Queue.
  // ──────────────────────────────────────────────────────────
  private async crearDhcpArp(
    dto:      CreateMikrotikUserDto,
    contrato: Contrato,
    plan:     Plan,
    creds:    Creds,
  ): Promise<MikrotikUserResult> {
    const ip          = dto.ipAddress!;
    const mac         = dto.macAddress!;
    const dhcpServer  = dto.dhcpServer!;
    const queueName   = dto.queueName ?? `q-${ip.replace(/\./g, '-')}`;

    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let leaseId  = '';
    let arpId    = '';
    let queueId  = '';
    try {
      // ── PASO 1: lease DHCP estático ───────────────────────
      leaseId = await this.pool.execute(creds, async (api: any) => {
        const existing = await api.write('/ip/dhcp-server/lease/print', [
          `?mac-address=${mac}`,
          `?server=${dhcpServer}`,
        ]);

        const leaseArgs = [
          `=address=${ip}`,
          `=mac-address=${mac}`,
          `=server=${dhcpServer}`,
          `=always-broadcast=yes`,
          `=comment=CRM:${contrato.id.slice(0, 8)}`,
        ];

        if (existing.length > 0) {
          this.logger.warn(`DHCP: lease para ${mac} ya existe, actualizando`);
          await api.write('/ip/dhcp-server/lease/set', [
            `=.id=${existing[0]['.id']}`, ...leaseArgs,
          ]);
          return existing[0]['.id'];
        }

        const res = await api.write('/ip/dhcp-server/lease/add', leaseArgs);
        return res?.[0]?.ret || '';
      });

      // ── PASO 2: entrada ARP estática (ancla IP↔MAC) ───────
      arpId = await this.pool.execute(creds, async (api: any) => {
        const existing = await api.write('/ip/arp/print', [`?address=${ip}`]);
        if (existing.length > 0) {
          await api.write('/ip/arp/set', [
            `=.id=${existing[0]['.id']}`,
            `=mac-address=${mac}`,
            ...(dto.arpInterface ? [`=interface=${dto.arpInterface}`] : []),
          ]);
          return existing[0]['.id'];
        }

        const res = await api.write('/ip/arp/add', [
          `=address=${ip}`,
          `=mac-address=${mac}`,
          ...(dto.arpInterface ? [`=interface=${dto.arpInterface}`] : []),
          `=comment=CRM:${contrato.id.slice(0, 8)}`,
        ]);
        return res?.[0]?.ret || '';
      });

      // ── PASO 3: Simple Queue ──────────────────────────────
      queueId = await this.queueSvc.crearSimpleQueue(creds, {
        name:         queueName,
        target:       ip,
        maxLimitDown: plan.velocidadBajada / 1000,
        maxLimitUp:   plan.velocidadSubida / 1000,
        ...(plan.burstBajada ? {
          burstLimitDown:  plan.burstBajada  / 1000,
          burstLimitUp:    plan.burstSubida  / 1000,
          burstTimeDown:   plan.burstTiempo,
          burstTimeUp:     plan.burstTiempo,
          burstThreshDown: plan.burstUmbral  / 1000,
          burstThreshUp:   plan.burstUmbral  / 1000,
        } : {}),
        priority: plan.prioridad,
        comment:  `CRM:${contrato.id.slice(0, 8)}`,
      });

      // ── PASO 4: actualizar contrato ───────────────────────
      await qr.manager.update(Contrato, contrato.id, {
        ipAsignada:       ip,
        macAddress:       mac,
        nombreQueue:      queueName,
        tipoAuth:         AuthType.DHCP_ARP,
        estado:           EstadoContrato.ACTIVO,
        fechaInstalacion: new Date(),
      });

      await qr.commitTransaction();
      this.logger.log(`DHCP_ARP + Queue creados: ${ip} / ${mac} en router ${creds.ip}`);

      return {
        contratoId:  contrato.id,
        authType:    AuthType.DHCP_ARP,
        mikrotikId:  leaseId,
        ipAsignada:  ip,
        macAddress:  mac,
        nombreQueue: queueName,
      };
    } catch (err: any) {
      await qr.rollbackTransaction();
      await this.compensarDhcpArp(creds, ip, mac, dhcpServer, queueName, !!leaseId, !!arpId, !!queueId);
      this.lanzarErrorMikrotik('DHCP_ARP', err);
    } finally {
      await qr.release();
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers privados
  // ──────────────────────────────────────────────────────────

  private async cargarRecursos(contratoId: string, empresaId: string) {
    const contrato = await this.contratoRepo.findOne({
      where: { id: contratoId, empresaId, deletedAt: null as any },
    });
    if (!contrato) {
      throw new NotFoundException(`Contrato ${contratoId} no encontrado`);
    }
    if (contrato.estado !== EstadoContrato.PENDIENTE_ACTIVACION) {
      throw new BadRequestException(
        `El contrato debe estar en estado PENDIENTE_ACTIVACION (actual: ${contrato.estado})`,
      );
    }
    if (!contrato.routerId) {
      throw new BadRequestException('El contrato no tiene router asignado');
    }

    const plan = await this.planRepo.findOne({ where: { id: contrato.planId } });
    if (!plan) {
      throw new NotFoundException(`Plan ${contrato.planId} no encontrado`);
    }

    const creds = await this.buildCreds(contrato.routerId, empresaId);

    return { contrato, plan, creds };
  }

  private async buildCreds(routerId: string, empresaId: string): Promise<Creds> {
    const router = await this.routerRepo.findOne({
      where: { id: routerId, empresaId, activo: true, deletedAt: null as any },
    });
    if (!router) {
      throw new NotFoundException(`Router ${routerId} no encontrado o inactivo`);
    }

    const ip   = (router as any).vpnIp || (router as any).ipGestion;
    const port = (router as any).usarSsl
      ? (router as any).puertoApiSsl
      : (router as any).puertoApi;

    return {
      id:              router.id,
      ip,
      port,
      user:            (router as any).usuario,
      passwordCifrado: (router as any).passwordCifrado,
      useSsl:          (router as any).usarSsl,
      timeoutSec:      (router as any).timeoutConexion || 10,
      version:         (router as any).versionRos === 'v7' ? 'v7' : 'v6',
    };
  }

  private async cleanupMikrotik(contrato: Contrato, creds: Creds): Promise<void> {
    const tipoAuth = (contrato as any).tipoAuth as AuthType | null;

    if (tipoAuth === AuthType.PPPOE && contrato.usuarioPppoe) {
      await this.pppoeSvc.eliminar(creds, contrato.usuarioPppoe).catch(() => {});
    }

    if ((tipoAuth === AuthType.ARP || tipoAuth === AuthType.DHCP_ARP) && contrato.ipAsignada) {
      if (contrato.nombreQueue) {
        await this.queueSvc.eliminarSimpleQueue(creds, contrato.nombreQueue).catch(() => {});
      }
      await this.pool.execute(creds, async (api: any) => {
        const arps = await api.write('/ip/arp/print', [`?address=${contrato.ipAsignada}`]);
        for (const a of arps) {
          await api.write('/ip/arp/remove', [`=.id=${a['.id']}`]);
        }
      }).catch(() => {});
    }

    if (tipoAuth === AuthType.DHCP_ARP && contrato.macAddress) {
      await this.pool.execute(creds, async (api: any) => {
        const leases = await api.write('/ip/dhcp-server/lease/print', [
          `?mac-address=${contrato.macAddress}`,
        ]);
        for (const l of leases) {
          await api.write('/ip/dhcp-server/lease/remove', [`=.id=${l['.id']}`]);
        }
      }).catch(() => {});
    }
  }

  /** Compensación ARP: revierte sólo los pasos que llegaron a ejecutarse */
  private async compensarArp(
    creds:     Creds,
    ip:        string,
    queueName: string,
    hadArp:    boolean,
    hadQueue:  boolean,
  ): Promise<void> {
    if (hadQueue) {
      await this.queueSvc.eliminarSimpleQueue(creds, queueName).catch((e: any) =>
        this.logger.error(`ARP compensación queue: ${e.message}`),
      );
    }
    if (hadArp) {
      await this.pool.execute(creds, async (api: any) => {
        const arps = await api.write('/ip/arp/print', [`?address=${ip}`]);
        for (const a of arps) {
          await api.write('/ip/arp/remove', [`=.id=${a['.id']}`]);
        }
      }).catch((e: any) => this.logger.error(`ARP compensación arp: ${e.message}`));
    }
  }

  /** Compensación DHCP_ARP: revierte sólo los pasos que llegaron a ejecutarse */
  private async compensarDhcpArp(
    creds:      Creds,
    ip:         string,
    mac:        string,
    dhcpServer: string,
    queueName:  string,
    hadLease:   boolean,
    hadArp:     boolean,
    hadQueue:   boolean,
  ): Promise<void> {
    if (hadQueue) {
      await this.queueSvc.eliminarSimpleQueue(creds, queueName).catch((e: any) =>
        this.logger.error(`DHCP_ARP compensación queue: ${e.message}`),
      );
    }
    if (hadArp) {
      await this.pool.execute(creds, async (api: any) => {
        const arps = await api.write('/ip/arp/print', [`?address=${ip}`]);
        for (const a of arps) {
          await api.write('/ip/arp/remove', [`=.id=${a['.id']}`]);
        }
      }).catch((e: any) => this.logger.error(`DHCP_ARP compensación arp: ${e.message}`));
    }
    if (hadLease) {
      await this.pool.execute(creds, async (api: any) => {
        const leases = await api.write('/ip/dhcp-server/lease/print', [
          `?mac-address=${mac}`,
          `?server=${dhcpServer}`,
        ]);
        for (const l of leases) {
          await api.write('/ip/dhcp-server/lease/remove', [`=.id=${l['.id']}`]);
        }
      }).catch((e: any) => this.logger.error(`DHCP_ARP compensación lease: ${e.message}`));
    }
  }

  /** Convierte cualquier error en la excepción NestJS apropiada */
  private lanzarErrorMikrotik(estrategia: string, err: any): never {
    const msg: string = err?.message || String(err);

    // Errores conocidos de RouterOS API
    if (msg.includes('already have such entry')) {
      throw new BadRequestException(
        `[${estrategia}] Ya existe una entrada con esos datos en el MikroTik: ${msg}`,
      );
    }
    if (msg.includes('no such item')) {
      throw new BadRequestException(
        `[${estrategia}] El ítem referenciado no existe en el MikroTik: ${msg}`,
      );
    }
    if (msg.includes('Pool exhausto') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
      throw new InternalServerErrorException(
        `[${estrategia}] No se pudo conectar al router MikroTik: ${msg}`,
      );
    }

    throw new InternalServerErrorException(
      `[${estrategia}] Error en MikroTik — la operación fue revertida: ${msg}`,
    );
  }
}
