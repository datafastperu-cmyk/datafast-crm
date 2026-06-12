import {
  Injectable, Logger, NotFoundException,
  ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, LessThan, In } from 'typeorm';
import { Cron }             from '@nestjs/schedule';
import * as fs              from 'fs/promises';
import * as path            from 'path';
import * as net             from 'net';
import { Response }         from 'express';

import { VpnCliente, EstadoVpnCliente } from '../entities/vpn-cliente.entity';
import { VpnAlerta }                    from '../entities/vpn-alerta.entity';
import { CrearVpnClienteDto }           from '../dto/vpn-cliente.dto';
import { JwtPayload }                   from '../../../common/decorators/current-user.decorator';
import { generateToken, encrypt }       from '../../../common/utils/encryption.util';
import { Router, MetodoConexion, EstadoEquipo, VersionRouterOS } from '../../mikrotik/entities/router.entity';

// ── Rutas del sistema VPN ─────────────────────────────────────
const CA_CRT      = '/etc/openvpn/server/ca.crt';
const CCD_DIR     = '/etc/openvpn/ccd';
const VPS_IP      = process.env.VPN_SERVER_IP || process.env.APP_URL?.replace(/^https?:\/\//, '').split(':')[0] || '127.0.0.1';
const VPN_PORT    = parseInt(process.env.VPN_SERVER_PORT || '1195', 10);

interface VpnConnectedClient {
  commonName:     string;
  realAddress:    string;
  vpnAddress:     string;
  bytesReceived:  number;
  bytesSent:      number;
  connectedSince: string;
}

@Injectable()
export class VpnClienteService {
  private readonly logger = new Logger(VpnClienteService.name);
  private _ipAssignLock: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(VpnCliente)
    private readonly repo: Repository<VpnCliente>,
    @InjectRepository(VpnAlerta)
    private readonly alertaRepo: Repository<VpnAlerta>,
    @InjectRepository(Router)
    private readonly routerRepo: Repository<Router>,
  ) {}

  // ── Crear cliente VPN ─────────────────────────────────────────

  async crearCliente(dto: CrearVpnClienteDto, user: JwtPayload): Promise<{
    cliente: VpnCliente;
    script:  string;
  }> {
    // Limpiar todos los certs anteriores de este usuario sin router asignado.
    // Garantiza inicio limpio: no quedan certs/CCD/túneles huérfanos de intentos previos.
    const anteriores = await this.repo.find({
      where: {
        empresaId: user.empresaId,
        usuarioId: user.sub,
        activo:    true,
        routerId:  IsNull(),
        estado:    Not('revocado' as EstadoVpnCliente),
      },
    });
    for (const ant of anteriores) {
      this.logger.log(`[VPN] Revocando cert huérfano previo al nuevo wizard: ${ant.nombreCert}`);
      await this.revocar(ant.id, ant.empresaId).catch(e =>
        this.logger.warn(`[VPN] Error revocando cert anterior ${ant.nombreCert}: ${e.message}`),
      );
    }

    const versionRos = dto.versionRos ?? 'v7';
    const { cipher, authAlg } = this._resolveParams(
      versionRos,
      dto.cipher  ?? 'aes256',
      dto.authAlg ?? 'sha1',
    );

    const slug = dto.nombre
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40);
    const shortId = generateToken(3);

    const nombreCert    = `user-${slug}-${shortId}`;
    const autoVpnUsuario  = `df-${slug}-${shortId}`;
    const autoVpnPassword = generateToken(12);

    const tokenDescarga  = generateToken(32);
    const tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const cliente = this.repo.create({
      empresaId:          user.empresaId,
      usuarioId:          user.sub,
      nombre:             dto.nombre,
      ubicacion:          dto.ubicacion,
      descripcion:        dto.descripcion,
      nombreCert,
      versionRos,
      vpnUsuario:         autoVpnUsuario,
      vpnPasswordCifrado: encrypt(autoVpnPassword),
      cipher,
      authAlg,
      verifyServerCert:   dto.verifyServerCert ?? false,
      estado:             'pendiente',
      tokenDescarga,
      tokenExpiresAt,
      activo:             true,
    });
    await this.repo.save(cliente);
    this.logger.log(`VPN cliente creado: ${cliente.id} | cert: ${nombreCert}`);

    // Pre-asignar IP VPN y escribir CCD antes de distribuir el script.
    // Serializado con mutex para evitar race condition cuando varios operadores
    // abren el wizard simultáneamente y seleccionan la misma IP libre.
    // Para modo usuario/contraseña, el CCD se escribe con el vpnUsuario como clave
    // (porque username-as-common-name está activo en el servidor OpenVPN).
    {
      let releaseLock!: () => void;
      const acquired = new Promise<void>(resolve => { releaseLock = resolve; });
      const prev = this._ipAssignLock;
      this._ipAssignLock = acquired;
      await prev;
      try {
        const preasignedIp = await this._preasignarIpVpn();
        const ccdCn = autoVpnUsuario;
        await this.escribirArchivoCcd(ccdCn, [], preasignedIp);
        this.logger.log(`[VPN] IP pre-asignada para ${ccdCn}: ${preasignedIp}`);
      } catch (err: any) {
        this.logger.error(`[VPN] No se pudo pre-asignar IP para ${nombreCert}: ${err.message}`);
        throw err;
      } finally {
        releaseLock();
      }
    }

    const script = await this._generarScript(cliente);
    // Guardar el script íntegro — esta es la única vez que se genera; "Ver script" lo leerá directamente
    await this.repo.update(cliente.id, { scriptGenerado: script });
    return { cliente, script };
  }

  async getScriptByRouterId(routerId: string, empresaId: string): Promise<string> {
    const cliente = await this.repo.findOne({
      where: { routerId, empresaId, activo: true },
      order: { createdAt: 'DESC' },
    });
    if (!cliente) throw new NotFoundException('No hay cliente VPN asociado a este router');
    // Retornar el script guardado en el momento de generación (íntegro, MAC incluida)
    // Fallback a reconstrucción solo para clientes anteriores a este cambio (scriptGenerado null)
    return cliente.scriptGenerado ?? await this._generarScript(cliente);
  }

  // ── Listar por router (para revocación al eliminar router) ────

  async listarPorRouterId(routerId: string, empresaId: string): Promise<VpnCliente[]> {
    return this.repo.find({
      where: { routerId, empresaId, activo: true },
    });
  }

  // ── Limpiar túneles huérfanos ─────────────────────────────────
  // Revoca todos los clientes VPN activos cuyo router fue eliminado o no existe.

  async limpiarHuerfanos(empresaId: string): Promise<{ revocados: number; ids: string[] }> {
    const routersActivos = await this.routerRepo.find({
      where: { empresaId, activo: true },
      select: ['id'],
    });
    const activeIds = new Set(routersActivos.map(r => r.id));

    const candidatos = await this.repo.find({
      where: { empresaId, activo: true, estado: Not('revocado' as EstadoVpnCliente) },
      select: ['id', 'empresaId', 'nombreCert', 'routerId'],
    });

    const huerfanos = candidatos.filter(c => !c.routerId || !activeIds.has(c.routerId));
    if (!huerfanos.length) return { revocados: 0, ids: [] };

    const ids: string[] = [];
    for (const c of huerfanos) {
      try {
        await this.revocar(c.id, empresaId);
        ids.push(c.id);
      } catch (err: any) {
        this.logger.warn(`Huérfano ${c.id} (${c.nombreCert}): error al revocar — ${err.message}`);
      }
    }

    this.logger.log(`Limpieza VPN: ${ids.length}/${huerfanos.length} clientes huérfanos revocados para empresa ${empresaId}`);
    return { revocados: ids.length, ids };
  }

  // ── Revocar por tokenDescarga (sin JWT — útil cuando la sesión expiró) ──

  async revocarPorToken(tokenDescarga: string): Promise<void> {
    const cliente = await this.repo.findOne({
      where: { tokenDescarga, activo: true },
    });
    if (!cliente || cliente.estado === 'revocado') return;
    await this.revocar(cliente.id, cliente.empresaId);
  }

  // ── Cron: limpiar wizards abandonados (sin router asignado) ────
  // Dos cutoffs según estado del túnel:
  //   · pendiente  (nunca conectó)  → 15 min: el operador abandonó antes de ejecutar el script
  //   · conectado  (túnel activo)   → 60 min: el operador tardó en completar el paso 3
  // Corre cada 10 min. Máxima exposición de IP bloqueada: ~25 min / ~70 min.

  @Cron('0 */10 * * * *', { name: 'vpn-cleanup-abandonados', timeZone: 'America/Lima' })
  async limpiarWizardsAbandonados(): Promise<void> {
    const cutoff15 = new Date(Date.now() - 15 * 60 * 1000);
    const cutoff60 = new Date(Date.now() - 60 * 60 * 1000);

    const abandonados = await this.repo.find({
      where: [
        // Nunca conectó: corte corto
        { routerId: IsNull(), activo: true, estado: 'pendiente'     as EstadoVpnCliente, createdAt: LessThan(cutoff15) },
        { routerId: IsNull(), activo: true, estado: 'desconectado'  as EstadoVpnCliente, createdAt: LessThan(cutoff15) },
        // Túnel activo pero paso 3 nunca completado: corte largo
        { routerId: IsNull(), activo: true, estado: 'conectado'     as EstadoVpnCliente, createdAt: LessThan(cutoff60) },
      ],
    });
    if (!abandonados.length) return;
    this.logger.log(`VPN cron: ${abandonados.length} wizard(s) abandonado(s) — revocando`);
    for (const c of abandonados) {
      try { await this.revocar(c.id, c.empresaId); } catch {}
    }
  }

  // ── Validar túnel (lee status.log) ────────────────────────────

  async validarTunel(id: string, empresaId: string): Promise<{
    conectado:         boolean;
    vpnIp?:            string;
    ipReal?:           string;
    routerRegistrado?: boolean;
    routerId?:         string;
    mensaje:           string;
  }> {
    const cliente = await this._getCliente(id, empresaId);

    if (cliente.estado === 'revocado') {
      return { conectado: false, mensaje: 'Cliente VPN revocado' };
    }

    const cn = cliente.vpnUsuario ?? cliente.nombreCert;

    // Management socket: datos en tiempo real sin race condition de lectura de archivo
    const connectedClients = await this._leerManagement();
    const found = connectedClients.find(c => c.commonName === cn);

    if (!found) {
      // Si el DB indicaba conectado pero el status.log ya no lo muestra, actualizar estado
      if (cliente.estado === 'conectado') {
        await this.repo.update(cliente.id, { estado: 'desconectado' });
      }
      return {
        conectado: false,
        mensaje:   'Túnel no detectado. Ejecuta el script en el router y espera 15 segundos.',
      };
    }

    const ipReal = found.realAddress.includes(':')
      ? found.realAddress.split(':')[0]
      : found.realAddress;

    const updates: Partial<VpnCliente> = {
      estado:          'conectado',
      vpnIp:           found.vpnAddress,
      ipReal,
      ultimoHandshake: new Date(),
    };

    const routerId = cliente.routerId;

    await this.repo.update(cliente.id, updates);

    // Bloquear la IP en CCD inmediatamente para que OpenVPN nunca la reasigne
    // a otro cert, incluso si este router se desconecta temporalmente.
    // La IP solo se libera al revocar (revocar() borra el CCD).
    await this.escribirArchivoCcd(cn, [], found.vpnAddress).catch(
      (err) => this.logger.warn(`[VPN] No se pudo escribir CCD para ${cn}: ${err.message}`),
    );

    return {
      conectado: true,
      vpnIp:     found.vpnAddress,
      ipReal,
      routerId:  routerId ?? undefined,
      mensaje:   `Túnel activo | IP VPN: ${found.vpnAddress} | Conectado desde: ${found.connectedSince}`,
    };
  }

  // ── Revocar certificado ───────────────────────────────────────

  async revocar(id: string, empresaId: string): Promise<void> {
    const cliente = await this._getCliente(id, empresaId);
    if (cliente.estado === 'revocado') throw new ConflictException('Ya revocado');

    const effectiveCn = cliente.vpnUsuario ?? cliente.nombreCert;

    await this.killClienteVpnManagement(effectiveCn);
    await this.repo.update(cliente.id, { estado: 'revocado', activo: false });

    // Eliminar archivo CCD del cliente revocado para limpiar rutas del servidor
    const ccdPath = path.join(CCD_DIR, effectiveCn);
    await fs.unlink(ccdPath).catch(() => {});
    this.logger.log(`VPN cliente revocado: ${cliente.id}`);
  }

  // ── Servir certificado (endpoint público protegido por token) ─

  async servirCertificado(token: string, filename: string, res: Response): Promise<void> {
    if (filename !== 'ca.crt') {
      res.status(404).json({ message: 'Archivo no válido' });
      return;
    }

    const cliente = await this.repo.findOne({
      where: { tokenDescarga: token, activo: true },
    });

    if (!cliente) {
      res.status(404).json({ message: 'Token inválido' });
      return;
    }
    if (new Date() > cliente.tokenExpiresAt) {
      res.status(410).json({ message: 'Token expirado — regenera el script' });
      return;
    }
    if (cliente.estado === 'revocado') {
      res.status(403).json({ message: 'Cliente VPN revocado' });
      return;
    }

    try {
      const content = await fs.readFile(CA_CRT, 'utf8');
      res.setHeader('Content-Type', 'application/x-pem-file');
      res.setHeader('Content-Disposition', `attachment; filename="ca.crt"`);
      res.send(content);
    } catch {
      res.status(404).json({ message: 'CA no disponible' });
    }
  }

  // ── Vincular cliente VPN a router registrado ─────────────────

  async vincularARouter(vpnIp: string, empresaId: string, routerId: string): Promise<void> {
    await this.repo.update(
      { vpnIp, empresaId, activo: true } as any,
      { routerId },
    );
  }

  // ── Vincular cert del wizard al router recién creado ─────────
  // Usa el cert real (mt-<slug>-<hex>) como vpnCommonName del router,
  // evitando el flujo df_router_id_<uuid> que genera un cert nunca instalado.

  async vincularCertWizardARouter(
    vpnClienteId: string,
    routerId:     string,
    empresaId:    string,
  ): Promise<void> {
    const cliente = await this.repo.findOne({ where: { id: vpnClienteId, empresaId, activo: true } });
    if (!cliente || cliente.estado === 'revocado') {
      this.logger.warn(`[VPN-LINK] vpn_cliente ${vpnClienteId} no encontrado o revocado — fallback a generarParaRouter`);
      const router = await this.routerRepo.findOne({ where: { id: routerId, empresaId } });
      if (router) await this.generarParaRouter(router);
      return;
    }

    const effectiveCn = cliente.vpnUsuario ?? cliente.nombreCert;

    await this.routerRepo.update(routerId, { vpnCommonName: effectiveCn } as any);
    await this.repo.update(cliente.id, { routerId });

    // Escribir/actualizar CCD con el CN correcto y las subnets del router
    const router = await this.routerRepo.findOne({ where: { id: routerId } });
    if (router) {
      await this.escribirArchivoCcd(effectiveCn, router.subnetsLocales || [], router.vpnIp || router.ipGestion);
    }

    this.logger.log(`[VPN-LINK] VPN vinculada: "${effectiveCn}" → router ${routerId}`);
  }

  // ── Generar cliente VPN sin certificado (user/pass) y escribir CCD ─
  // Llamado como fallback desde MikrotikService cuando se crea un router
  // VPN_TUNNEL sin pasar por el wizard (sin vpnClienteId).

  async generarParaRouter(router: Router): Promise<string> {
    // Si ya existe un cliente activo para este router, solo actualiza el CCD
    const existing = await this.repo.findOne({
      where: { routerId: router.id, empresaId: router.empresaId, activo: true },
    });
    if (existing?.vpnUsuario) {
      await this.escribirArchivoCcd(existing.vpnUsuario, router.subnetsLocales || [], router.vpnIp || router.ipGestion);
      await this.routerRepo.update(router.id, { vpnCommonName: existing.vpnUsuario } as any);
      return existing.vpnUsuario;
    }

    const slug = router.nombre
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30);
    const shortId        = generateToken(3);
    const vpnUsuario     = `df-${slug}-${shortId}`;
    const vpnPassword    = generateToken(12);
    const nombreCert     = `user-${slug}-${shortId}`;
    const tokenDescarga  = generateToken(32);
    const tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const cliente = this.repo.create({
      empresaId:          router.empresaId,
      nombre:             router.nombre,
      nombreCert,
      versionRos:         (router.versionRos as string) === 'v7' ? 'v7' : 'v6',
      vpnUsuario,
      vpnPasswordCifrado: encrypt(vpnPassword),
      cipher:             'aes256',
      authAlg:            'sha256',
      verifyServerCert:   false,
      estado:             'pendiente',
      routerId:           router.id,
      tokenDescarga,
      tokenExpiresAt,
      activo:             true,
    });
    await this.repo.save(cliente);

    await this.routerRepo.update(router.id, { vpnCommonName: vpnUsuario } as any);
    await this.escribirArchivoCcd(vpnUsuario, router.subnetsLocales || [], router.vpnIp || router.ipGestion);
    this.logger.log(`[VPN] Cliente no-cert creado: ${vpnUsuario} → router ${router.id}`);

    return vpnUsuario;
  }

  // ── Escribir archivo CCD en /etc/openvpn/ccd/<commonName> ────
  // Formato: una línea "iroute <red> <máscara>" por cada subred.
  // El archivo dicta al servidor OpenVPN cómo enrutar tráfico
  // hacia las redes LAN del router, independientemente del nombre comercial.

  async escribirArchivoCcd(commonName: string, subnets: string[], vpnIp?: string): Promise<void> {
    const filePath = path.join(CCD_DIR, commonName);
    const lines: string[] = [];
    if (vpnIp) lines.push(`ifconfig-push ${vpnIp} 255.255.255.0`);
    for (const sn of (subnets || []).filter(Boolean)) {
      const [ip, prefix] = sn.split('/');
      const mask = this._prefixToMask(parseInt(prefix ?? '24', 10));
      lines.push(`iroute ${ip} ${mask}`);
    }
    await fs.mkdir(CCD_DIR, { recursive: true });
    await fs.writeFile(filePath, lines.join('\n') + (lines.length ? '\n' : ''), { encoding: 'utf8', mode: 0o644 });
    this.logger.log(`[VPN-CCD] Escrito: ${filePath} vpnIp=${vpnIp ?? 'N/A'} → [${lines.join(', ') || 'vacío'}]`);
  }

  // ── Sincronizar CCD y forzar reconexión del túnel ───────────
  // Escribe el CCD para el CN guardado en BD Y para el CN real conectado
  // (si difieren), sincroniza la BD y mata la sesión para que al
  // reconectar OpenVPN cargue las nuevas rutas al instante.
  async sincronizarCcdYReconectar(router: Router): Promise<void> {
    const subnets  = router.subnetsLocales || [];
    const storedCn = router.vpnCommonName;
    const vpnIp    = router.vpnIp || router.ipGestion;

    // 1. Escribir CCD para el CN almacenado en BD
    if (storedCn) {
      await this.escribirArchivoCcd(storedCn, subnets, vpnIp);
    }

    // 2. Detectar CN real via management (el que OpenVPN usa para buscar CCD)
    const actualCn = vpnIp ? await this._getActualCnByVpnIp(vpnIp) : null;

    if (actualCn && actualCn !== storedCn) {
      this.logger.warn(
        `[VPN-CCD] Mismatch: stored="${storedCn}" actual="${actualCn}" | ` +
        `router="${router.nombre}" | Sincronizando CCD y BD`,
      );
      // Escribir CCD para el CN real (es el que OpenVPN efectivamente lee)
      await this.escribirArchivoCcd(actualCn, subnets, vpnIp);

      // Actualizar routers.vpn_common_name al CN real
      await this.routerRepo.update(router.id, { vpnCommonName: actualCn });

      // Actualizar vpn_clientes: vincular el registro del cert real al router
      // e inactivar el registro huérfano UUID-based si existe
      await this._sincronizarRegistroVpn(router.id, router.empresaId, actualCn, storedCn);

      this.logger.log(`[VPN-CCD] BD sincronizada: vpn_common_name → "${actualCn}"`);
    }

    // 3. Delay: garantizar que el CCD ya está en disco y PG commitó antes de
    //    expulsar el túnel. El kill del management NO toca la CRL ni revoca certs.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const cnToKill = actualCn || storedCn;
    if (cnToKill) {
      await this.killClienteVpnManagement(cnToKill);
      this.logger.log(`[VPN-CCD] Reconexión forzada: kill "${cnToKill}" → CCD recargará en el próximo handshake`);
    }
  }

  // ── Helpers privados ──────────────────────────────────────────

  // Consulta el management interface y retorna los clientes conectados
  private _leerManagement(): Promise<VpnConnectedClient[]> {
    return new Promise<VpnConnectedClient[]>((resolve) => {
      const clients: VpnConnectedClient[] = [];
      const socket  = new net.Socket();
      let   buffer  = '';
      let   asked   = false;

      const done = () => { socket.destroy(); resolve(clients); };
      socket.setTimeout(4000);
      socket.on('timeout', done);
      socket.on('error',   done);

      socket.connect(7505, '127.0.0.1', () => {
        socket.on('data', (buf) => {
          buffer += buf.toString();
          if (!asked && buffer.includes('>INFO:')) {
            asked = true;
            socket.write('status 2\r\n');
          }
          if (asked && (buffer.includes('\nEND\r\n') || buffer.includes('\nEND\n'))) {
            for (const line of buffer.split('\n')) {
              if (!line.startsWith('CLIENT_LIST,')) continue;
              const p = line.split(',');
              if (p.length >= 7) {
                clients.push({
                  commonName:     p[1],
                  realAddress:    p[2],
                  vpnAddress:     p[3],
                  bytesReceived:  parseInt(p[5], 10) || 0,
                  bytesSent:      parseInt(p[6], 10) || 0,
                  connectedSince: p[7] || '',
                });
              }
            }
            done();
          }
        });
      });
    });
  }

  // Retorna el CN real conectado para una VPN IP dada
  private async _getActualCnByVpnIp(vpnIp: string): Promise<string | null> {
    try {
      const clients = await this._leerManagement();
      const found   = clients.find(c => c.vpnAddress === vpnIp);
      return found?.commonName ?? null;
    } catch {
      return null;
    }
  }

  // Vincula el registro del cert real al router y desactiva el huérfano UUID
  private async _sincronizarRegistroVpn(
    routerId:   string,
    empresaId:  string,
    actualCn:   string,
    orphanCn:   string | undefined,
  ): Promise<void> {
    // Vincular registro del cert real al router
    const realRecord = await this.repo.findOne({ where: { nombreCert: actualCn } });
    if (realRecord) {
      await this.repo.update(realRecord.id, { routerId, empresaId });
    }
    // Desactivar el registro UUID huérfano si existe y está sin router conectado
    if (orphanCn && orphanCn !== actualCn) {
      const orphan = await this.repo.findOne({ where: { nombreCert: orphanCn } });
      if (orphan && !orphan.vpnIp) {
        await this.repo.update(orphan.id, { activo: false, estado: 'revocado' as EstadoVpnCliente });
        this.logger.log(`[VPN-CCD] Registro huérfano inactivado: ${orphanCn}`);
      }
    }
  }

  // Devuelve la próxima IP libre en 10.8.1.0/24 (pool del servidor MikroTik).
  // Consulta tanto la BD como los CCD files para evitar colisiones con IPs
  // asignadas vía ifconfig-push (que el pool de OpenVPN no registra en ipp.txt).
  private async _preasignarIpVpn(): Promise<string> {
    const usedIps = new Set<string>();

    // IPs reservadas por certs activos en BD
    const activeCerts = await this.repo.find({
      where: { activo: true, vpnIp: Not(IsNull()) },
      select: ['vpnIp'],
    });
    for (const c of activeCerts) {
      if (c.vpnIp) usedIps.add(c.vpnIp);
    }

    // IPs reservadas en CCD files existentes (ifconfig-push)
    try {
      const files = await fs.readdir(CCD_DIR);
      for (const file of files) {
        try {
          const content = await fs.readFile(path.join(CCD_DIR, file), 'utf8');
          const m = content.match(/ifconfig-push (\d+\.\d+\.\d+\.\d+)/);
          if (m) usedIps.add(m[1]);
        } catch {}
      }
    } catch {}

    // Buscar la primera IP libre en 10.8.1.2 – 10.8.1.254
    for (let i = 2; i <= 254; i++) {
      const candidate = `10.8.1.${i}`;
      if (!usedIps.has(candidate)) return candidate;
    }
    throw new BadRequestException('No hay IPs VPN disponibles en el pool 10.8.1.0/24');
  }

  private killClienteVpnManagement(nombreCert: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const socket = new net.Socket();
      let sent = false;

      const done = () => { socket.destroy(); resolve(); };

      socket.setTimeout(3000);
      socket.on('timeout', done);
      socket.on('error',   done);
      socket.on('close',   done);

      socket.connect(7505, '127.0.0.1', () => {
        socket.on('data', (buf) => {
          const text = buf.toString();
          if (!sent && text.includes('>INFO:')) {
            sent = true;
            socket.write(`kill ${nombreCert}\r\n`);
          } else if (sent) {
            this.logger.log(`OpenVPN kill [${nombreCert}]: ${text.trim()}`);
            done();
          }
        });
      });
    });
  }

  // Decide si permitir una nueva conexión VPN para un CN dado.
  // Lógica:
  //   1. CN no registrado → denegar
  //   2. Sin sesión activa → permitir
  //   3. Sesión activa:
  //      a. Router asociado responde TCP en su API → sesión legítima → denegar + alerta
  //      b. Router no responde → impostor → matar sesión → permitir + alerta
  async verificarSesionCn(cn: string, ipNueva?: string): Promise<boolean> {
    const cliente = await this.repo.findOne({
      where: [{ nombreCert: cn, activo: true }, { vpnUsuario: cn, activo: true }],
    });
    if (!cliente || cliente.estado === 'revocado') return false;

    const sessions = await this._leerManagement();
    const sesionActiva = sessions.find(s => s.commonName === cn);
    if (!sesionActiva) return true;

    const ipSesion = sesionActiva.realAddress.includes(':')
      ? sesionActiva.realAddress.split(':')[0]
      : sesionActiva.realAddress;

    const router = cliente.routerId
      ? await this.routerRepo.findOne({ where: { id: cliente.routerId } })
      : null;

    if (router?.vpnIp) {
      const port = router.puertoApi ?? 8728;
      const responde = await this._testTcpPort(router.vpnIp, port, 3000);
      if (responde) {
        this.logger.log(`[VPN] CN ${cn}: sesión legítima activa en ${router.vpnIp}:${port} — nueva conexión rechazada (IP entrante: ${ipNueva ?? '?'})`);
        this._crearAlerta({
          empresaId:    cliente.empresaId,
          cn,
          routerId:     router.id,
          routerNombre: router.nombre,
          tipo:         'conexion_bloqueada',
          ipNueva:      ipNueva ?? null,
          ipSesion,
          mensaje:      `Se bloqueó intento de conexión duplicada para "${router.nombre}" (CN: ${cn}). La sesión activa desde ${ipSesion} respondió correctamente. Intento rechazado desde ${ipNueva ?? 'IP desconocida'}.`,
        });
        return false;
      }
    }

    await this.killClienteVpnManagement(cn);
    this.logger.log(`[VPN] CN ${cn}: sesión previa (${ipSesion}) no respondió — eliminada. Nueva conexión permitida desde ${ipNueva ?? '?'}`);
    this._crearAlerta({
      empresaId:    cliente.empresaId,
      cn,
      routerId:     router?.id ?? null,
      routerNombre: router?.nombre ?? null,
      tipo:         'sesion_eliminada',
      ipNueva:      ipNueva ?? null,
      ipSesion,
      mensaje:      `La sesión VPN de "${router?.nombre ?? cn}" (CN: ${cn}) fue eliminada porque no respondió al API. La sesión activa era desde ${ipSesion}. Nueva conexión permitida desde ${ipNueva ?? 'IP desconocida'}.`,
    });
    return true;
  }

  // ── Alertas VPN ───────────────────────────────────────────────

  async listarAlertas(empresaId: string): Promise<VpnAlerta[]> {
    return this.alertaRepo.find({
      where:  { empresaId, leida: false },
      order:  { createdAt: 'DESC' },
      take:   50,
    });
  }

  async descartarAlerta(id: string, empresaId: string): Promise<void> {
    await this.alertaRepo.update({ id, empresaId }, { leida: true });
  }

  private _crearAlerta(data: {
    empresaId:    string;
    cn:           string;
    routerId:     string | null;
    routerNombre: string | null;
    tipo:         'conexion_bloqueada' | 'sesion_eliminada';
    ipNueva:      string | null;
    ipSesion:     string;
    mensaje:      string;
  }): void {
    this.alertaRepo.save(
      this.alertaRepo.create({
        empresaId:    data.empresaId,
        cn:           data.cn,
        routerId:     data.routerId ?? undefined,
        routerNombre: data.routerNombre ?? undefined,
        tipo:         data.tipo,
        ipNueva:      data.ipNueva ?? undefined,
        ipSesion:     data.ipSesion,
        mensaje:      data.mensaje,
        leida:        false,
      }),
    ).catch(err => this.logger.error(`[VPN] Error guardando alerta: ${err.message}`));
  }

  private _testTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error',   () => { socket.destroy(); resolve(false); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.connect(port, host);
    });
  }

  // Mata la sesión activa de un router si la ocupa un impostor.
  // Retorna true si se mató una sesión, false si no había sesión activa.
  async matarSesionImpostora(routerId: string, empresaId: string): Promise<boolean> {
    const cliente = await this.repo.findOne({
      where: { routerId, empresaId, activo: true },
    });
    if (!cliente) return false;

    const cn = cliente.vpnUsuario ?? cliente.nombreCert;

    const sessions = await this._leerManagement();
    if (!sessions.find(s => s.commonName === cn)) return false;

    await this.killClienteVpnManagement(cn);
    this.logger.log(`[VPN] Sesión impostora terminada para CN ${cn} (router ${routerId})`);
    return true;
  }

  private async _getCliente(id: string, empresaId: string): Promise<VpnCliente> {
    const c = await this.repo.findOne({ where: { id, empresaId } });
    if (!c) throw new NotFoundException('Cliente VPN no encontrado');
    return c;
  }

  private async _autoRegistrarRouter(
    cliente:    VpnCliente,
    vpnIp:      string,
    ipReal:     string,
    empresaId:  string,
  ): Promise<Router> {
    const existing = await this.routerRepo.findOne({
      where: { vpnIp, empresaId },
    });
    if (existing) return existing;


    const router = this.routerRepo.create({
      empresaId,
      nombre:          cliente.nombre,
      descripcion:     cliente.descripcion,
      ubicacion:       cliente.ubicacion,
      ipGestion:       vpnIp,
      vpnIp,
      usuario:         'admin',
      passwordCifrado: encrypt(''),
      metodoConexion:  MetodoConexion.VPN_TUNNEL,
      estado:          EstadoEquipo.DESCONOCIDO,
      versionRos:      VersionRouterOS.DESCONOCIDA,
      activo:          true,
      puertoApi:       8728,
      puertoApiSsl:    8729,
      puertoSsh:       22,
      usarSsl:         false,
      timeoutConexion: 10,
      reintentos:      3,
    });
    await this.routerRepo.save(router);
    this.logger.log(`Router auto-registrado: ${router.id} | VPN IP: ${vpnIp}`);
    return router;
  }

  // ── Resolver compatibilidad cipher/auth ───────────────────────

  private _resolveParams(
    versionRos: 'v6' | 'v7',
    cipher: string,
    authAlg: string,
  ): { cipher: string; authAlg: string } {
    // RouterOS v6 no soporta GCM → downgrade a CBC equivalente
    if (versionRos === 'v6') {
      if (cipher === 'aes256-gcm') cipher = 'aes256';
      if (cipher === 'aes128-gcm') cipher = 'aes128';
    }
    return { cipher, authAlg };
  }

  // Convierte el cipher interno (estilo v6: 'aes256') al formato que espera
  // el comando OVPN de RouterOS según la versión:
  //   v6: 'aes256'      v7: 'aes256-cbc'
  //   v6: 'aes128'      v7: 'aes128-cbc'
  private _cipherForRos(cipher: string, version: 'v6' | 'v7'): string {
    if (version === 'v7') {
      const map: Record<string, string> = {
        aes128: 'aes128-cbc',
        aes192: 'aes192-cbc',
        aes256: 'aes256-cbc',
      };
      return map[cipher] ?? cipher;
    }
    return cipher;
  }

  private _prefixToMask(prefix: number): string {
    const p = Math.min(32, Math.max(0, prefix || 24));
    const mask = p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0;
    return [(mask >>> 24) & 0xFF, (mask >>> 16) & 0xFF, (mask >>> 8) & 0xFF, mask & 0xFF].join('.');
  }

  private _generarMac(): string {
    const h = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    return `FE:${h()}:${h()}:${h()}:${h()}:${h()}`;
  }

  private async _decryptPassword(encrypted?: string): Promise<string> {
    if (!encrypted) return '';
    const { decrypt } = await import('../../../common/utils/encryption.util');
    return decrypt(encrypted);
  }

  // ── Verificar credenciales VPN (llamado por vpn-auth.sh) ─────
  async verifyAuth(username: string, password: string): Promise<boolean> {
    const byUser = await this.repo.findOne({
      where: { vpnUsuario: username, activo: true },
    });
    if (!byUser) return false;
    const plain = await this._decryptPassword(byUser.vpnPasswordCifrado);
    return plain === password;
  }

  // ── Generador de script ───────────────────────────────────────

  private async _generarScript(cliente: VpnCliente): Promise<string> {
    const pass = await this._decryptPassword(cliente.vpnPasswordCifrado);
    return cliente.versionRos === 'v6'
      ? this._scriptV6NoCert(cliente, pass)
      : this._scriptV7NoCert(cliente, pass);
  }

  private _scriptV6NoCert(cliente: VpnCliente, pass: string): string {
    const vpnUser   = cliente.vpnUsuario || '';
    const mac       = this._generarMac();
    const fetchPath = `/api/v1/openvpn/mikrotik-clients/certs/${cliente.tokenDescarga}`;
    const urlCa     = `http://${VPS_IP}${fetchPath}/ca.crt`;
    const prefix    = `df-${cliente.nombreCert}`;
    return `{
:local fCa "${prefix}-ca.crt"
:do { /interface ovpn-client disable [find name=vpndatafast] } on-error={}
:delay 1s
:do { /interface ovpn-client remove  [find name=vpndatafast] } on-error={}
:delay 1s
:do { /certificate remove [find name~"${prefix}"] } on-error={}
/tool fetch url="${urlCa}" dst-path=$fCa
:delay 3s
/certificate import file-name=$fCa passphrase=""
:delay 2s
/interface ovpn-client add name=vpndatafast connect-to=${VPS_IP} port=${VPN_PORT} cipher=${cliente.cipher} auth=${cliente.authAlg} user=${vpnUser} password=${pass} mac-address=${mac} disabled=yes
:delay 1s
/interface ovpn-client enable vpndatafast
}`;
  }

  private _scriptV7NoCert(cliente: VpnCliente, pass: string): string {
    const vpnUser    = cliente.vpnUsuario || '';
    const mac        = this._generarMac();
    const fetchPath  = `/api/v1/openvpn/mikrotik-clients/certs/${cliente.tokenDescarga}`;
    const urlCa      = `http://${VPS_IP}${fetchPath}/ca.crt`;
    const prefix     = `df-${cliente.nombreCert}`;
    const verifyLine = cliente.verifyServerCert
      ? `\n/interface ovpn-client set vpndatafast verify-server-certificate=yes`
      : '';
    return `{
:local fCa "${prefix}-ca.crt"
:do { /interface ovpn-client disable [find name=vpndatafast] } on-error={}
:delay 1s
:do { /interface ovpn-client remove  [find name=vpndatafast] } on-error={}
:delay 1s
:do { /certificate remove [find name~"${prefix}"] } on-error={}
/tool fetch url="${urlCa}" dst-path=$fCa
:delay 3s
/certificate import file-name=$fCa passphrase=""
:delay 2s
/interface ovpn-client add cipher=${this._cipherForRos(cliente.cipher, 'v7')} connect-to=${VPS_IP} port=${VPN_PORT} name=vpndatafast user=${vpnUser} password=${pass} mac-address=${mac} disabled=yes${verifyLine}
:delay 1s
/interface ovpn-client enable vpndatafast
}`;
  }
}
