import {
  Injectable, Logger, NotFoundException,
  ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { execFile }         from 'child_process';
import { promisify }        from 'util';
import * as fs              from 'fs/promises';
import * as path            from 'path';
import { Response }         from 'express';

import { VpnCliente, EstadoVpnCliente } from '../entities/vpn-cliente.entity';
import { CrearVpnClienteDto }           from '../dto/vpn-cliente.dto';
import { JwtPayload }                   from '../../../common/decorators/current-user.decorator';
import { generateToken, encrypt }       from '../../../common/utils/encryption.util';
import { Router, MetodoConexion, EstadoEquipo, VersionRouterOS } from '../../mikrotik/entities/router.entity';

const execFileAsync = promisify(execFile);

// ── Rutas del sistema VPN ─────────────────────────────────────
const EASYRSA_DIR = '/etc/openvpn/easy-rsa';
const PKI_DIR     = '/etc/openvpn/easy-rsa/pki';
const CA_CRT      = '/etc/openvpn/server/ca.crt';
const STATUS_LOG  = '/var/log/openvpn/status-mikrotik.log';
const VPS_IP      = '149.34.48.224';
const VPN_PORT    = 1195;
const API_BASE    = `http://${VPS_IP}/api/v1`;

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

  constructor(
    @InjectRepository(VpnCliente)
    private readonly repo: Repository<VpnCliente>,
    @InjectRepository(Router)
    private readonly routerRepo: Repository<Router>,
  ) {}

  // ── Crear cliente VPN ─────────────────────────────────────────

  async crearCliente(dto: CrearVpnClienteDto, user: JwtPayload): Promise<{
    cliente: VpnCliente;
    script:  string;
  }> {
    const usarCerts  = dto.usarCertificados !== false;
    const versionRos = dto.versionRos ?? 'v7';
    const { cipher, authAlg } = this._resolveParams(
      versionRos,
      dto.cipher  ?? 'aes256',
      dto.authAlg ?? 'sha256',
    );

    const slug = dto.nombre
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40);
    const shortId = generateToken(3);

    let nombreCert:      string;
    let autoVpnUsuario:  string | undefined;
    let autoVpnPassword: string | undefined;

    if (usarCerts) {
      nombreCert = `mt-${slug}-${shortId}`;
      this.logger.log(`Generando certificado: ${nombreCert}`);
      try {
        await execFileAsync(
          `${EASYRSA_DIR}/easyrsa`,
          ['build-client-full', nombreCert, 'nopass'],
          {
            cwd:     EASYRSA_DIR,
            env:     {
              ...process.env,
              EASYRSA_BATCH:      'yes',
              EASYRSA_VARS_FILE:  `${EASYRSA_DIR}/vars-clients`,
            },
            timeout: 60_000,
          },
        );
      } catch (err: any) {
        if (err.stderr?.includes('already exists') || err.message?.includes('already exists')) {
          throw new ConflictException('Nombre de certificado duplicado, intenta nuevamente');
        }
        this.logger.error(`easyrsa error: ${err.stderr || err.message}`);
        throw new BadRequestException(`Error generando certificado: ${err.message}`);
      }
    } else {
      nombreCert         = `user-${slug}-${shortId}`;
      autoVpnUsuario     = `df-${slug}-${shortId}`;
      autoVpnPassword    = generateToken(12); // 24-char hex — 96 bits de entropía
    }

    const tokenDescarga  = generateToken(32);
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const cliente = this.repo.create({
      empresaId:          user.empresaId,
      nombre:             dto.nombre,
      ubicacion:          dto.ubicacion,
      descripcion:        dto.descripcion,
      nombreCert,
      versionRos,
      usarCertificados:   usarCerts,
      vpnUsuario:         autoVpnUsuario,
      vpnPasswordCifrado: autoVpnPassword ? encrypt(autoVpnPassword) : undefined,
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

    const script = await this._generarScript(cliente);
    return { cliente, script };
  }

  // ── Listar clientes ───────────────────────────────────────────

  async listar(empresaId: string): Promise<VpnCliente[]> {
    return this.repo.find({
      where: { empresaId, activo: true },
      order: { createdAt: 'DESC' },
    });
  }

  // ── Obtener cliente ───────────────────────────────────────────

  async obtener(id: string, empresaId: string): Promise<VpnCliente> {
    return this._getCliente(id, empresaId);
  }

  // ── Obtener script (regenerar con token actualizado) ──────────

  async obtenerScript(id: string, empresaId: string): Promise<string> {
    const cliente = await this._getCliente(id, empresaId);
    return this._generarScript(cliente);
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

    // Para modo sin certificados, el CN en status.log es el vpnUsuario
    const cn = (!cliente.usarCertificados && cliente.vpnUsuario)
      ? cliente.vpnUsuario
      : cliente.nombreCert;

    const connectedClients = await this._leerStatusLog();
    const found = connectedClients.find(c => c.commonName === cn);

    if (!found) {
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

    let routerRegistrado = false;
    let routerId = cliente.routerId;

    if (!cliente.routerId) {
      try {
        const router = await this._autoRegistrarRouter(cliente, found.vpnAddress, ipReal, empresaId);
        updates.routerId = router.id;
        routerId         = router.id;
        routerRegistrado = true;
      } catch (err: any) {
        this.logger.warn(`Auto-registro fallido (${cliente.nombreCert}): ${err.message}`);
      }
    }

    await this.repo.update(cliente.id, updates);

    return {
      conectado:        true,
      vpnIp:            found.vpnAddress,
      ipReal,
      routerRegistrado,
      routerId:         routerId ?? undefined,
      mensaje:          `Túnel activo | IP VPN: ${found.vpnAddress} | Conectado desde: ${found.connectedSince}`,
    };
  }

  // ── Revocar certificado ───────────────────────────────────────

  async revocar(id: string, empresaId: string): Promise<void> {
    const cliente = await this._getCliente(id, empresaId);
    if (cliente.estado === 'revocado') throw new ConflictException('Ya revocado');

    if (cliente.usarCertificados) {
      const easyrsaEnv = {
        ...process.env,
        EASYRSA_BATCH:     'yes',
        EASYRSA_VARS_FILE: `${EASYRSA_DIR}/vars-clients`,
      };
      try {
        await execFileAsync(
          `${EASYRSA_DIR}/easyrsa`,
          ['revoke', cliente.nombreCert],
          { cwd: EASYRSA_DIR, env: easyrsaEnv, timeout: 30_000 },
        );
        await execFileAsync(
          `${EASYRSA_DIR}/easyrsa`,
          ['gen-crl'],
          { cwd: EASYRSA_DIR, env: easyrsaEnv, timeout: 30_000 },
        );
      } catch (err: any) {
        this.logger.warn(`Error revocando ${cliente.nombreCert}: ${err.message}`);
      }
    }

    await this.repo.update(cliente.id, { estado: 'revocado', activo: false });
    this.logger.log(`VPN cliente revocado: ${cliente.id}`);
  }

  // ── Servir certificado (endpoint público protegido por token) ─

  async servirCertificado(token: string, filename: string, res: Response): Promise<void> {
    const allowed = ['ca.crt', 'client.crt', 'client.key'];
    if (!allowed.includes(filename)) {
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

    let filePath: string;
    if (filename === 'ca.crt') {
      filePath = CA_CRT;
    } else if (filename === 'client.crt') {
      filePath = path.join(PKI_DIR, 'issued', `${cliente.nombreCert}.crt`);
    } else {
      filePath = path.join(PKI_DIR, 'private', `${cliente.nombreCert}.key`);
    }

    try {
      const content = await fs.readFile(filePath);
      res.setHeader('Content-Type', 'application/x-pem-file');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch {
      res.status(404).json({ message: `Certificado no disponible: ${filename}` });
    }
  }

  // ── Helpers privados ──────────────────────────────────────────

  private async _getCliente(id: string, empresaId: string): Promise<VpnCliente> {
    const c = await this.repo.findOne({ where: { id, empresaId } });
    if (!c) throw new NotFoundException('Cliente VPN no encontrado');
    return c;
  }

  private async _leerStatusLog(): Promise<VpnConnectedClient[]> {
    try {
      const log     = await fs.readFile(STATUS_LOG, 'utf8');
      const clients: VpnConnectedClient[] = [];
      for (const line of log.split('\n')) {
        if (!line.startsWith('CLIENT_LIST,')) continue;
        const parts = line.split(',');
        if (parts.length < 8) continue;
        clients.push({
          commonName:     parts[1],
          realAddress:    parts[2],
          vpnAddress:     parts[3],
          bytesReceived:  parseInt(parts[5], 10) || 0,
          bytesSent:      parseInt(parts[6], 10) || 0,
          connectedSince: parts[7],
        });
      }
      return clients;
    } catch {
      this.logger.warn('status-mikrotik.log no disponible');
      return [];
    }
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

    const { encrypt: enc } = await import('../../../common/utils/encryption.util');

    const router = this.routerRepo.create({
      empresaId,
      nombre:          cliente.nombre,
      descripcion:     cliente.descripcion,
      ubicacion:       cliente.ubicacion,
      ipGestion:       vpnIp,
      vpnIp,
      usuario:         'admin',
      passwordCifrado: enc(''),
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
    // No-cert: buscar por vpnUsuario
    const byUser = await this.repo.findOne({
      where: { vpnUsuario: username, activo: true },
    });
    if (byUser) {
      if (byUser.usarCertificados) return true; // cert client — TLS ya lo verificó
      const plain = await this._decryptPassword(byUser.vpnPasswordCifrado);
      return plain === password;
    }
    // Cert client: buscar por nombreCert
    const byCert = await this.repo.findOne({
      where: { nombreCert: username, activo: true },
    });
    return !!(byCert && byCert.usarCertificados);
  }

  // ── Generador de script ───────────────────────────────────────

  private async _generarScript(cliente: VpnCliente): Promise<string> {
    if (cliente.usarCertificados) {
      return cliente.versionRos === 'v6'
        ? this._scriptV6Cert(cliente)
        : this._scriptV7Cert(cliente);
    }
    const pass = await this._decryptPassword(cliente.vpnPasswordCifrado);
    return cliente.versionRos === 'v6'
      ? this._scriptV6NoCert(cliente, pass)
      : this._scriptV7NoCert(cliente, pass);
  }

  private _bloqueComun(cliente: VpnCliente): { cn: string; prefix: string; fetchPath: string } {
    return {
      cn:        cliente.nombreCert,
      prefix:    `df-${cliente.nombreCert}`,
      fetchPath: `/api/v1/openvpn/mikrotik-clients/certs/${cliente.tokenDescarga}`,
    };
  }

  private _scriptV6Cert(cliente: VpnCliente): string {
    const { cn, prefix, fetchPath } = this._bloqueComun(cliente);
    const mac = this._generarMac();
    return `:local certCN "${cn}"
:local certPrefix "${prefix}"
:local fetchHost "${VPS_IP}"
:local fetchPath "${fetchPath}"
:local fCa ($certPrefix . "-ca.crt")
:local fCert ($certPrefix . "-client.crt")
:local fKey ($certPrefix . "-client.key")
/tool fetch address=$fetchHost mode=http port=80 src-path=($fetchPath . "/ca.crt") dst-path=$fCa
:delay 3
/tool fetch address=$fetchHost mode=http port=80 src-path=($fetchPath . "/client.crt") dst-path=$fCert
:delay 3
/tool fetch address=$fetchHost mode=http port=80 src-path=($fetchPath . "/client.key") dst-path=$fKey
:delay 3
/certificate import file-name=$fCa passphrase=""
:delay 3
/certificate import file-name=$fCert passphrase=""
:delay 3
/certificate import file-name=$fKey passphrase=""
:delay 5
:local certEntry [/certificate find where common-name=$certCN]
:local certName [/certificate get $certEntry name]
/interface ovpn-client add name=vpndatafast connect-to=${VPS_IP} port=${VPN_PORT} cipher=aes256 auth=sha256 user=$certCN certificate=$certName mac-address=${mac}
/interface ovpn-client enable vpndatafast`;
  }

  private _scriptV6NoCert(cliente: VpnCliente, pass: string): string {
    const vpnUser = cliente.vpnUsuario || '';
    const mac     = this._generarMac();
    return `/interface ovpn-client add name=vpndatafast connect-to=${VPS_IP} port=${VPN_PORT} cipher=aes256 auth=sha256 disabled=yes
/interface ovpn-client set vpndatafast user=${vpnUser}
/interface ovpn-client set vpndatafast password=${pass}
/interface ovpn-client set vpndatafast mac-address=${mac}
/interface ovpn-client enable vpndatafast`;
  }

  private _scriptV7Cert(cliente: VpnCliente): string {
    const { cn, prefix, fetchPath } = this._bloqueComun(cliente);
    const mac        = this._generarMac();
    const verifyLine = cliente.verifyServerCert
      ? `\n/interface ovpn-client set vpndatafast verify-server-certificate=yes`
      : '';
    return `:local certCN "${cn}"
:local certPrefix "${prefix}"
:local fetchHost "${VPS_IP}"
:local fetchPath "${fetchPath}"
:local fCa ($certPrefix . "-ca.crt")
:local fCert ($certPrefix . "-client.crt")
:local fKey ($certPrefix . "-client.key")
:local urlCa ("http://" . $fetchHost . $fetchPath . "/ca.crt")
:local urlCert ("http://" . $fetchHost . $fetchPath . "/client.crt")
:local urlKey ("http://" . $fetchHost . $fetchPath . "/client.key")
/tool fetch url=$urlCa dst-path=$fCa
:delay 3
/tool fetch url=$urlCert dst-path=$fCert
:delay 3
/tool fetch url=$urlKey dst-path=$fKey
:delay 3
/certificate import file-name=$fCa passphrase=""
:delay 3
/certificate import file-name=$fCert passphrase=""
:delay 3
/certificate import file-name=$fKey passphrase=""
:delay 5
:local certEntry [/certificate find where common-name=$certCN]
:local certName [/certificate get $certEntry name]
/interface ovpn-client
add certificate=$certName cipher=aes256-cbc connect-to=${VPS_IP} port=${VPN_PORT} name=vpndatafast user=$certCN mac-address=${mac}${verifyLine}`;
  }

  private _scriptV7NoCert(cliente: VpnCliente, pass: string): string {
    const vpnUser    = cliente.vpnUsuario || '';
    const mac        = this._generarMac();
    const verifyLine = cliente.verifyServerCert
      ? `\n/interface ovpn-client set vpndatafast verify-server-certificate=yes`
      : '';
    return `/interface ovpn-client
add cipher=aes256-cbc connect-to=${VPS_IP} port=${VPN_PORT} name=vpndatafast user=${vpnUser} password=${pass} mac-address=${mac}${verifyLine}`;
  }
}
