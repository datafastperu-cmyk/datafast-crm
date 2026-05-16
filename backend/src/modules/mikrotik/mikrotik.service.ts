import {
  Injectable, Logger, NotFoundException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { InjectDataSource }  from '@nestjs/typeorm';
import { DataSource }        from 'typeorm';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';
import * as net from 'net';

import { Router, VersionRouterOS, EstadoEquipo, TipoControl, MetodoConexion } from './entities/router.entity';
import { RouterConnectionPool, RouterCredentials } from './services/connection-pool.service';
import { PppoeService, CreatePppoeParams }         from './services/pppoe.service';
import { QueueService, QueueParams }               from './services/queue.service';
import { FirewallService }                          from './services/firewall.service';
import { InterfaceService }                        from './services/interface.service';
import { AuditoriaService }                        from '../auth/auditoria.service';
import { JwtPayload }                              from '../../common/decorators/current-user.decorator';
import { encrypt, decrypt }                        from '../../common/utils/encryption.util';

import {
  CreateRouterDto, UpdateRouterDto, ProvisionarClienteDto,
  SuspenderClienteDto, ReactivarClienteDto, AmareIpMacDto,
  TestConexionDirectaDto,
} from './dto/mikrotik.dto';

// ─── Evento emitido al suspender/reactivar ────────────────────
export const EVENT_CLIENTE_SUSPENDIDO  = 'mikrotik.cliente.suspendido';
export const EVENT_CLIENTE_REACTIVADO  = 'mikrotik.cliente.reactivado';

@Injectable()
export class MikrotikService {
  private readonly logger = new Logger(MikrotikService.name);

  constructor(
    @InjectRepository(Router)
    private readonly routerRepo:  Repository<Router>,
    private readonly pool:        RouterConnectionPool,
    private readonly pppoeSvc:    PppoeService,
    private readonly queueSvc:    QueueService,
    private readonly firewallSvc: FirewallService,
    private readonly ifaceSvc:    InterfaceService,
    private readonly auditoria:   AuditoriaService,
    private readonly events:      EventEmitter,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // GESTIÓN DE ROUTERS
  // ────────────────────────────────────────────────────────────

  async crearRouter(dto: CreateRouterDto, user: JwtPayload): Promise<Router> {
    const existe = await this.routerRepo.findOne({
      where: { ipGestion: dto.ipGestion, empresaId: user.empresaId, deletedAt: null as any },
    });
    if (existe) throw new ConflictException(`Ya existe un router con IP ${dto.ipGestion}`);

    // Cifrar la contraseña antes de guardar
    let passwordCifrado: string;
    try {
      passwordCifrado = encrypt(dto.password);
    } catch {
      passwordCifrado = dto.password;
    }

    const router = this.routerRepo.create({
      ...dto,
      passwordCifrado,
      empresaId: user.empresaId,
      estado:    EstadoEquipo.DESCONOCIDO,
    });

    const saved = await this.routerRepo.save(router);

    // Intentar detectar la versión del RouterOS automáticamente
    this.detectarVersionAsync(saved);

    await this.auditoria.logCreate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'mikrotik', entidadId: saved.id,
      descripcion: `Router creado: ${dto.nombre} (${dto.ipGestion})`,
    });

    return saved;
  }

  async findAll(empresaId: string): Promise<Router[]> {
    return this.routerRepo.find({
      where: { empresaId, activo: true, deletedAt: null as any },
      order: { nombre: 'ASC' },
    });
  }

  async findOne(id: string, empresaId: string): Promise<Router> {
    const r = await this.routerRepo.findOne({ where: { id, empresaId, deletedAt: null as any } });
    if (!r) throw new NotFoundException(`Router ${id} no encontrado`);
    return r;
  }

  async updateRouter(id: string, dto: UpdateRouterDto, user: JwtPayload): Promise<Router> {
    const router = await this.findOne(id, user.empresaId);
    const updates: Partial<Router> = { ...dto } as any;

    if ((dto as any).password) {
      try { updates.passwordCifrado = encrypt((dto as any).password); }
      catch { updates.passwordCifrado = (dto as any).password; }
      delete (updates as any).password;
    }

    await this.routerRepo.update(id, updates);
    // Invalidar conexiones existentes si cambió la IP o contraseña
    if (dto.ipGestion || (dto as any).password) {
      await this.pool.invalidate(id);
    }
    return this.findOne(id, user.empresaId);
  }

  async removeRouter(id: string, user: JwtPayload): Promise<void> {
    await this.findOne(id, user.empresaId);
    await this.routerRepo.update(id, { deletedAt: new Date(), activo: false });
    await this.pool.invalidate(id);
  }

  // ── Construir credenciales para el pool ───────────────────
  private async getCredentials(routerId: string, empresaId: string): Promise<RouterCredentials> {
    const router = await this.findOne(routerId, empresaId);
    const port   = router.usarSsl ? router.puertoApiSsl : router.puertoApi;
    // Si el router tiene VPN configurada, conectar por esa IP
    const ip = router.vpnIp || router.ipGestion;
    return {
      id:              router.id,
      ip,
      port,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      router.timeoutConexion || 10,
      version:         router.versionRos === VersionRouterOS.V7 ? 'v7' : 'v6',
    };
  }

  // ────────────────────────────────────────────────────────────
  // AMARRE IP + MAC  (ARP estático + opcionalmente DHCP lease)
  // ────────────────────────────────────────────────────────────
  async aplicarAmareIpMac(
    routerId: string,
    dto:      AmareIpMacDto,
    user:     JwtPayload,
  ): Promise<{ arp: boolean; dhcp: boolean }> {
    const router = await this.findOne(routerId, user.empresaId);
    const creds  = await this.getCredentials(routerId, user.empresaId);
    const comment = `DATAFAST:${dto.clienteId ? `ClienteID:${dto.clienteId}` : dto.hostname || dto.ip}`;

    let dhcpAdded = false;

    await this.pool.execute(creds, async (api) => {
      // 1. Agregar entrada ARP estática en IP > ARP
      const arpExistente = await api.write('/ip/arp/print', [
        `?address=${dto.ip}`,
        `?mac-address=${dto.mac}`,
      ]);
      if (!arpExistente.length) {
        await api.write('/ip/arp/add', [
          `=address=${dto.ip}`,
          `=mac-address=${dto.mac}`,
          `=comment=${comment}`,
        ]);
      }

      // 2. Si el control incluye DHCP lease, también agregar en DHCP Server > Leases
      if (
        router.tipoControl === TipoControl.AMARRE_IP_MAC_DHCP ||
        dto.dhcpServer
      ) {
        const server = dto.dhcpServer || 'dhcp1';
        const leaseExistente = await api.write('/ip/dhcp-server/lease/print', [
          `?address=${dto.ip}`,
        ]);
        if (!leaseExistente.length) {
          await api.write('/ip/dhcp-server/lease/add', [
            `=address=${dto.ip}`,
            `=mac-address=${dto.mac}`,
            `=server=${server}`,
            `=comment=${comment}`,
          ]);
          dhcpAdded = true;
        } else {
          dhcpAdded = true; // ya existía
        }
      }
    });

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion:       'AMARRE_IP_MAC',
      modulo:       'mikrotik',
      entidadId:    dto.clienteId || routerId,
      descripcion:  `Amarre IP ${dto.ip} ↔ MAC ${dto.mac} en ${creds.ip}${dhcpAdded ? ' + DHCP lease' : ''}`,
    });

    return { arp: true, dhcp: dhcpAdded };
  }

  // ────────────────────────────────────────────────────────────
  // PROVISIONAR CLIENTE EN MIKROTIK
  // Orquesta: PPPoE + Queue + Firewall rules
  // ────────────────────────────────────────────────────────────
  async provisionarCliente(
    routerId: string,
    dto:      ProvisionarClienteDto,
    user:     JwtPayload,
  ): Promise<{ ppppoeId: string; queueId: string }> {
    const creds = await this.getCredentials(routerId, user.empresaId);

    this.logger.log(
      `Provisionando cliente en ${creds.ip}: PPPoE=${dto.usuarioPppoe} | IP=${dto.ipAsignada} | ` +
      `${dto.uploadMbps}/${dto.downloadMbps} Mbps`,
    );

    // ── 1. Crear usuario PPPoE ─────────────────────────────
    const ppppoeId = await this.pppoeSvc.crear(creds, {
      name:          dto.usuarioPppoe,
      password:      dto.passwordPppoe,
      profile:       dto.perfilPppoe || 'default',
      service:       'pppoe',
      remoteAddress: dto.ipAsignada,
      comment:       `DATAFAST:ClienteID:${dto.clienteId}`,
      disabled:      false,
    });

    // ── 2. Crear Simple Queue (o PCQ si está configurado) ──
    const hasQueue = dto.tipoQueue === 'simple_queue' || !dto.tipoQueue;
    let queueId = '';

    if (hasQueue) {
      queueId = await this.queueSvc.crearSimpleQueue(creds, {
        name:         dto.usuarioPppoe,
        target:       `${dto.ipAsignada}/32`,
        maxLimitDown: dto.downloadMbps,
        maxLimitUp:   dto.uploadMbps,
        burstLimitDown: dto.burstDownMbps,
        burstLimitUp:   dto.burstUpMbps,
        burstTimeDown:  dto.burstTiempoSegundos,
        burstTimeUp:    dto.burstTiempoSegundos,
        comment:       `DATAFAST:ClienteID:${dto.clienteId}`,
      });
    } else if (dto.tipoQueue === 'queue_tree' || dto.tipoQueue === 'pcq') {
      // Verificar si PCQ está configurado, si no, configurarlo primero
      const tienePcq = await this.queueSvc.tienePcqConfigurado(creds);
      if (!tienePcq) {
        await this.queueSvc.configurarPcqCompleto(creds, {
          namePrefix:   'datafast',
          downloadMbps: dto.downloadMbps * 10, // límite total del nodo
          uploadMbps:   dto.uploadMbps * 10,
        });
      }
      // El PCQ ya maneja el cliente automáticamente por IP
    }

    // ── 3. Asegurar que las reglas de control están activas ─
    if (user.empresaId) {
      await this.firewallSvc.configurarReglasControl(creds).catch((err) =>
        this.logger.warn(`No se pudieron verificar reglas firewall: ${err.message}`),
      );
    }

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'PROVISION', modulo: 'mikrotik', entidadId: dto.clienteId,
      descripcion: `PPPoE ${dto.usuarioPppoe} provisionado en ${creds.ip} | IP: ${dto.ipAsignada}`,
    });

    return { ppppoeId, queueId };
  }

  // ────────────────────────────────────────────────────────────
  // SUSPENDER CLIENTE (por mora)
  // 1. Agrega IP a Address List "morosos" → firewall la bloquea
  // 2. Desconecta la sesión PPPoE activa
  // ────────────────────────────────────────────────────────────
  async suspenderCliente(
    routerId: string,
    dto:      SuspenderClienteDto,
    user:     JwtPayload,
  ): Promise<void> {
    const creds = await this.getCredentials(routerId, user.empresaId);

    // 1. Agregar a Address List morosos
    await this.firewallSvc.suspenderCliente(
      creds, dto.ipAsignada, dto.clienteId,
      `Mora - ${new Date().toLocaleDateString('es-PE')}`,
    );

    // 2. Desconectar sesión PPPoE activa si existe
    if (dto.usuarioPppoe) {
      await this.pppoeSvc.desconectarSesion(creds, dto.usuarioPppoe).catch((err) =>
        this.logger.warn(`No se pudo desconectar sesión ${dto.usuarioPppoe}: ${err.message}`),
      );
    }

    // 3. Emitir evento para notificación al cliente
    this.events.emit(EVENT_CLIENTE_SUSPENDIDO, {
      clienteId: dto.clienteId,
      empresaId: user.empresaId,
      ip:        dto.ipAsignada,
      routerId,
    });

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'SUSPEND', modulo: 'mikrotik', entidadId: dto.clienteId,
      descripcion: `IP ${dto.ipAsignada} suspendida en ${creds.ip} | Motivo: ${dto.motivo || 'mora'}`,
    });

    this.logger.log(`Cliente suspendido: ${dto.clienteId} | IP: ${dto.ipAsignada} | router: ${creds.ip}`);
  }

  // ────────────────────────────────────────────────────────────
  // REACTIVAR CLIENTE
  // 1. Quita IP de la Address List "morosos"
  // 2. El cliente puede reconectarse con sus credenciales PPPoE
  // ────────────────────────────────────────────────────────────
  async reactivarCliente(
    routerId: string,
    dto:      ReactivarClienteDto,
    user:     JwtPayload,
  ): Promise<void> {
    const creds = await this.getCredentials(routerId, user.empresaId);

    // Quitar de Address Lists de control
    await this.firewallSvc.reactivarCliente(creds, dto.ipAsignada);

    // Emitir evento para notificación
    this.events.emit(EVENT_CLIENTE_REACTIVADO, {
      clienteId: dto.clienteId,
      empresaId: user.empresaId,
      ip:        dto.ipAsignada,
      routerId,
    });

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'REACTIVATE', modulo: 'mikrotik', entidadId: dto.clienteId,
      descripcion: `IP ${dto.ipAsignada} reactivada en ${creds.ip}`,
    });

    this.logger.log(`Cliente reactivado: ${dto.clienteId} | IP: ${dto.ipAsignada}`);
  }

  // ────────────────────────────────────────────────────────────
  // INFORMACIÓN EN TIEMPO REAL
  // ────────────────────────────────────────────────────────────

  async getEstadoRouter(routerId: string, empresaId: string): Promise<{
    router:      Router;
    recursos:    any;
    interfaces:  any[];
    sesionesActivas: number;
    version:     string;
  }> {
    const router = await this.findOne(routerId, empresaId);
    const creds  = await this.getCredentials(routerId, empresaId);

    const [recursos, interfaces, sesiones] = await Promise.all([
      this.ifaceSvc.getRecursos(creds),
      this.ifaceSvc.listarInterfaces(creds),
      this.pppoeSvc.listarSesionesActivas(creds),
    ]);

    // Actualizar estado en BD
    await this.routerRepo.update(routerId, {
      estado:           EstadoEquipo.ONLINE,
      ultimoPing:       new Date(),
      cpuUsoPct:        recursos.cpuLoad,
      memoriaUsoPct:    recursos.freeMemory
        ? Math.round((1 - recursos.freeMemory / recursos.totalMemory) * 100)
        : null,
      uptimeSegundos:   recursos.uptimeSeconds,
      versionFirmware:  recursos.version,
      identityRouteros: await this.ifaceSvc.getIdentity(creds).catch(() => ''),
      versionRos:       recursos.version?.startsWith('7')
        ? VersionRouterOS.V7
        : VersionRouterOS.V6,
    });

    return {
      router:          await this.findOne(routerId, empresaId),
      recursos,
      interfaces,
      sesionesActivas: sesiones.length,
      version:         recursos.version,
    };
  }

  async getSesionesPppoe(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.pppoeSvc.listarSesionesActivas(creds);
  }

  async getMorosos(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.firewallSvc.listarMorosos(creds);
  }

  async getQueues(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.queueSvc.listarSimpleQueues(creds);
  }

  async getInterfaces(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.ifaceSvc.listarInterfaces(creds);
  }

  async getDhcpLeases(routerId: string, empresaId: string): Promise<any[]> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.firewallSvc.listarDhcpLeases(creds);
  }

  async getTrafico(routerId: string, empresaId: string, iface?: string): Promise<any[]> {
    const creds     = await this.getCredentials(routerId, empresaId);
    const interfaces = await this.ifaceSvc.listarInterfaces(creds);
    const target    = iface || interfaces[0]?.name || 'ether1';
    return this.ifaceSvc.monitorearInterface(creds, target, 5);
  }

  async pingDesdeRouter(routerId: string, empresaId: string, destino: string): Promise<any> {
    const creds = await this.getCredentials(routerId, empresaId);
    return this.ifaceSvc.ping(creds, destino);
  }

  // ── Configurar reglas de firewall en un router nuevo ─────
  async configurarFirewallControl(routerId: string, empresaId: string): Promise<void> {
    const creds = await this.getCredentials(routerId, empresaId);
    await this.firewallSvc.configurarReglasControl(creds);
  }

  // ── Testar conexión al router ─────────────────────────────
  async testConexion(routerId: string, empresaId: string): Promise<{
    exitoso: boolean; mensaje: string; latenciaMs?: number;
  }> {
    const router = await this.findOne(routerId, empresaId);
    const creds  = await this.getCredentials(routerId, empresaId);
    const inicio = Date.now();

    try {
      await this.pool.invalidate(routerId); // forzar nueva conexión
      const identity = await this.ifaceSvc.getIdentity(creds);
      const latencia = Date.now() - inicio;

      await this.routerRepo.update(routerId, {
        estado:    EstadoEquipo.ONLINE,
        ultimoPing: new Date(),
        latenciaMs: latencia,
        identityRouteros: identity,
      });

      return { exitoso: true, mensaje: `Conectado a "${identity}" en ${latencia}ms`, latenciaMs: latencia };

    } catch (error) {
      await this.routerRepo.update(routerId, { estado: EstadoEquipo.OFFLINE });
      return { exitoso: false, mensaje: `No se pudo conectar: ${error.message}` };
    }
  }

  // ────────────────────────────────────────────────────────────
  // TEST DE CONEXIÓN DIRECTA (antes de guardar el router)
  // ────────────────────────────────────────────────────────────

  async testConexionDirecta(dto: TestConexionDirectaDto): Promise<{
    exitoso: boolean;
    mensaje: string;
    latenciaMs?: number;
    versionDetectada?: string;
    identityDetectada?: string;
    rosVersion?: string;
  }> {
    const inicio  = Date.now();
    const metodo  = dto.metodoConexion || MetodoConexion.API;

    // SSH / SNMP: solo verificar accesibilidad TCP
    if (metodo === MetodoConexion.SSH || metodo === MetodoConexion.SNMP) {
      return this._tcpCheck(dto.ip, dto.puerto, dto.timeoutConexion ?? 10, inicio);
    }

    // API / API_SSL / VPN_TUNNEL: autenticar con RouterOS API
    const useSsl   = dto.usarSsl ?? (metodo === MetodoConexion.API_SSL);
    const tempCreds: RouterCredentials = {
      id:              `temp-${Date.now()}`,
      ip:              dto.ip,
      port:            dto.puerto,
      user:            dto.usuario,
      passwordCifrado: dto.password,   // el pool hace fallback a texto plano si no está cifrado
      useSsl,
      timeoutSec:      dto.timeoutConexion ?? 10,
      version:         dto.versionRos === VersionRouterOS.V7 ? 'v7' : 'v6',
    };

    let api: any = null;
    try {
      api = await this.pool.connectDirect(tempCreds);

      const [[ident], [res]] = await Promise.all([
        api.write('/system/identity/print'),
        api.write('/system/resource/print'),
      ]);

      const latencia = Date.now() - inicio;
      const version  = res?.version || '';
      const rosVer   = version.startsWith('7') ? 'v7' : 'v6';

      return {
        exitoso:           true,
        mensaje:           `Conectado: "${ident?.name || 'router'}" | RouterOS ${version} | ${latencia}ms`,
        latenciaMs:        latencia,
        versionDetectada:  version,
        identityDetectada: ident?.name || '',
        rosVersion:        rosVer,
      };
    } catch (err: any) {
      return { exitoso: false, mensaje: this._connectionErrorMsg(err.message || '') };
    } finally {
      if (api) try { api.close?.(); } catch { /* ignore */ }
    }
  }

  private _connectionErrorMsg(msg: string): string {
    const m = msg.toLowerCase();
    if (m.includes('econnrefused'))                     return 'Puerto cerrado — verificar IP y puerto';
    if (m.includes('timeout'))                          return 'Timeout — verificar IP, puerto y firewall del router';
    if (m.includes('login') || m.includes('wrong'))     return 'Autenticación fallida — verificar usuario y contraseña';
    if (m.includes('enotfound') || m.includes('ehostunreach')) return 'Host no encontrado — verificar IP o dominio';
    if (m.includes('pool exhausto'))                    return 'Pool saturado — intenta en unos segundos';
    return msg;
  }

  private _tcpCheck(
    host: string, port: number, timeoutSec: number, inicio: number,
  ): Promise<{ exitoso: boolean; mensaje: string; latenciaMs?: number }> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer  = setTimeout(() => {
        socket.destroy();
        resolve({ exitoso: false, mensaje: `Timeout al conectar a ${host}:${port}` });
      }, timeoutSec * 1000);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        const ms = Date.now() - inicio;
        resolve({ exitoso: true, mensaje: `Puerto ${port} accesible en ${ms}ms`, latenciaMs: ms });
      });

      socket.on('error', (err: Error) => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ exitoso: false, mensaje: this._connectionErrorMsg(err.message) });
      });
    });
  }

  // ── Detectar versión RouterOS de forma asíncrona ──────────
  private detectarVersionAsync(router: Router): void {
    const creds: RouterCredentials = {
      id:              router.id,
      ip:              router.ipGestion,
      port:            router.usarSsl ? router.puertoApiSsl : router.puertoApi,
      user:            router.usuario,
      passwordCifrado: router.passwordCifrado,
      useSsl:          router.usarSsl,
      timeoutSec:      10,
      version:         'v6',
    };

    this.ifaceSvc.detectarVersion(creds)
      .then((version) => {
        const rosVersion = version === 'v7' ? VersionRouterOS.V7 : VersionRouterOS.V6;
        return this.routerRepo.update(router.id, { versionRos: rosVersion });
      })
      .catch((err) => this.logger.warn(`No se pudo detectar versión de ${router.ipGestion}: ${err.message}`));
  }
}
