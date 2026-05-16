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
    if (versionRos === 'v6') {
      // RouterOS v6 no soporta GCM → downgrade a CBC equivalente
      if (cipher === 'aes256-gcm') cipher = 'aes256';
      if (cipher === 'aes128-gcm') cipher = 'aes128';
    } else {
      // RouterOS v7: preferir GCM (AEAD, sin auth separado, evita ambigüedad)
      if (!cipher.endsWith('-gcm')) cipher = 'aes256-gcm';
    }
    return { cipher, authAlg };
  }

  private async _decryptPassword(encrypted?: string): Promise<string> {
    if (!encrypted) return '';
    const { decrypt } = await import('../../../common/utils/encryption.util');
    return decrypt(encrypted);
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

  private _header(cliente: VpnCliente, modo: string): string {
    const fecha = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });
    return `# ================================================================
# DATAFAST ISP - Configuracion Tunel VPN MikroTik
# ================================================================
# Router     : ${cliente.nombre}
# Ubicacion  : ${cliente.ubicacion || 'Sin especificar'}
# Servidor   : ${VPS_IP}:${VPN_PORT}
# Modo       : ${modo}
# Generado   : ${fecha}
# ----------------------------------------------------------------
# INSTRUCCIONES:
#  1. Abrir Terminal MikroTik (Winbox > New Terminal o SSH)
#  2. Copiar y pegar TODO el script
#  3. Presionar Enter y esperar el mensaje de confirmacion
#  4. Volver al panel DATAFAST y presionar CONECTAR
# ================================================================`;
  }

  private _bloqueComun(cliente: VpnCliente): { cn: string; prefix: string; fetchPath: string } {
    return {
      cn:        cliente.nombreCert,
      prefix:    `df-${cliente.nombreCert}`,
      fetchPath: `/api/v1/openvpn/mikrotik-clients/${cliente.tokenDescarga}/certs`,
    };
  }

  // ── RouterOS v6 + Certificados ────────────────────────────────
  // fetch: address + src-path (v6 no parsea host desde variable en url=)
  // cipher/auth: solo en add, no en set (limitacion v6)
  // Líneas ≤122 chars para evitar syntax error del parser v6
  private _scriptV6Cert(cliente: VpnCliente): string {
    const { cn, prefix, fetchPath } = this._bloqueComun(cliente);
    const cipher  = cliente.cipher  || 'aes256';
    const authAlg = cliente.authAlg || 'sha256';
    return `${this._header(cliente, `RouterOS v6 + Certificados | ${cipher}/${authAlg}`)}

:local vpnServer "${VPS_IP}"
:local certCN "${cn}"
:local tunnelName "datafast-vpn"
:local certPrefix "${prefix}"
:local fetchHost "${VPS_IP}"
:local fetchPath "${fetchPath}"
:local c "${cipher}"
:local a "${authAlg}"

:log info "DATAFAST-VPN: === Iniciando configuracion (v6 + certs) ==="

# Eliminar interfaz OVPN previa
:if ([:len [/interface ovpn-client find where name=$tunnelName]] > 0) do={
/interface ovpn-client disable [find where name=$tunnelName]
:delay 2
/interface ovpn-client remove [find where name=$tunnelName]
:log info "DATAFAST-VPN: Interfaz previa eliminada"
}

# Eliminar certificados previos
:foreach cert in=[/certificate find where common-name=$certCN] do={ /certificate remove $cert }
:delay 1

# Descargar certificados (sintaxis v6: address + src-path)
:local fCa   ($certPrefix . "-ca.crt")
:local fCert ($certPrefix . "-client.crt")
:local fKey  ($certPrefix . "-client.key")
:log info "DATAFAST-VPN: Descargando certificados..."
/tool fetch address=$fetchHost mode=http port=80 src-path=($fetchPath . "/ca.crt") dst-path=$fCa
:delay 3
/tool fetch address=$fetchHost mode=http port=80 src-path=($fetchPath . "/client.crt") dst-path=$fCert
:delay 3
/tool fetch address=$fetchHost mode=http port=80 src-path=($fetchPath . "/client.key") dst-path=$fKey
:delay 3
:log info "DATAFAST-VPN: Certificados descargados"

# Importar CA (solo si no existe)
:if ([:len [/certificate find where common-name="DATAFAST-CA"]] = 0) do={
:log info "DATAFAST-VPN: Importando CA..."
/certificate import file-name=$fCa passphrase=""
:delay 3
}

# Importar certificado y clave del cliente
:log info "DATAFAST-VPN: Importando certificado cliente..."
/certificate import file-name=$fCert passphrase=""
:delay 3
/certificate import file-name=$fKey passphrase=""
:delay 3

# Verificar importacion
:if ([:len [/certificate find where common-name=$certCN]] = 0) do={
:log error "DATAFAST-VPN: Error - certificado no importado"
:error "Certificado no importado. Verificar descarga e importacion."
}

# Crear interfaz OVPN (cipher/auth van en add — limitacion v6)
:log info "DATAFAST-VPN: Creando interfaz OVPN..."
/interface ovpn-client add name=$tunnelName connect-to=$vpnServer port=1195 mode=ip cipher=$c auth=$a disabled=yes
/interface ovpn-client set $tunnelName user=$certCN certificate=$certCN
/interface ovpn-client set $tunnelName add-default-route=no comment="DATAFAST-VPN"
/interface ovpn-client enable $tunnelName

:log info "DATAFAST-VPN: === Configuracion completada (v6 + certs) ==="
:log info "DATAFAST-VPN: Estado: /interface ovpn-client print"`;
  }

  // ── RouterOS v6 + Usuario/Contraseña ─────────────────────────
  private _scriptV6NoCert(cliente: VpnCliente, pass: string): string {
    const cipher  = cliente.cipher  || 'aes256';
    const authAlg = cliente.authAlg || 'sha256';
    const vpnUser = cliente.vpnUsuario || '';
    return `${this._header(cliente, `RouterOS v6 + Usuario/Contraseña | ${cipher}/${authAlg}`)}

:local vpnServer "${VPS_IP}"
:local tunnelName "datafast-vpn"
:local vpnUser "${vpnUser}"
:local vpnPass "${pass}"
:local c "${cipher}"
:local a "${authAlg}"

:log info "DATAFAST-VPN: === Iniciando configuracion (v6 + user/pass) ==="

# Eliminar interfaz OVPN previa
:if ([:len [/interface ovpn-client find where name=$tunnelName]] > 0) do={
/interface ovpn-client disable [find where name=$tunnelName]
:delay 2
/interface ovpn-client remove [find where name=$tunnelName]
:log info "DATAFAST-VPN: Interfaz previa eliminada"
}

# Crear interfaz OVPN con usuario/contraseña (sin certificados)
:log info "DATAFAST-VPN: Creando interfaz OVPN..."
/interface ovpn-client add name=$tunnelName connect-to=$vpnServer port=1195 mode=ip cipher=$c auth=$a disabled=yes
/interface ovpn-client set $tunnelName user=$vpnUser password=$vpnPass
/interface ovpn-client set $tunnelName add-default-route=no comment="DATAFAST-VPN"
/interface ovpn-client enable $tunnelName

:log info "DATAFAST-VPN: === Configuracion completada (v6 + user/pass) ==="
:log info "DATAFAST-VPN: Estado: /interface ovpn-client print"`;
  }

  // ── RouterOS v7 + Certificados ────────────────────────────────
  // fetch: url= con variable pre-construida (v7 parsea host correctamente)
  // auth= omitido: RouterOS v7 trata "sha256" como ambiguo con "sha256-96" en prefix matching
  private _scriptV7Cert(cliente: VpnCliente): string {
    const { cn, prefix, fetchPath } = this._bloqueComun(cliente);
    const cipher    = cliente.cipher  || 'aes256';
    const authAlg   = cliente.authAlg || 'sha256';
    const fetchUrl  = `http://${VPS_IP}${fetchPath}`;
    const verifyLine = cliente.verifyServerCert
      ? '\n/interface ovpn-client set $tunnelName verify-server-certificate=yes'
      : '';
    return `${this._header(cliente, `RouterOS v7 + Certificados | ${cipher}/${authAlg}`)}

:local vpnServer "${VPS_IP}"
:local certCN "${cn}"
:local tunnelName "datafast-vpn"
:local certPrefix "${prefix}"
:local fetchUrl "${fetchUrl}"
:local vpnCipher "${cipher}"

:log info "DATAFAST-VPN: === Iniciando configuracion (v7 + certs) ==="

# Eliminar interfaz OVPN previa
:if ([:len [/interface ovpn-client find where name=$tunnelName]] > 0) do={
/interface ovpn-client disable [find where name=$tunnelName]
:delay 2
/interface ovpn-client remove [find where name=$tunnelName]
:log info "DATAFAST-VPN: Interfaz previa eliminada"
}

# Eliminar certificados previos
:foreach cert in=[/certificate find where common-name=$certCN] do={ /certificate remove $cert }
:delay 1

# Descargar certificados (sintaxis v7: url= con variable pre-construida)
:local fCa   ($certPrefix . "-ca.crt")
:local fCert ($certPrefix . "-client.crt")
:local fKey  ($certPrefix . "-client.key")
:local urlCa   ($fetchUrl . "/ca.crt")
:local urlCert ($fetchUrl . "/client.crt")
:local urlKey  ($fetchUrl . "/client.key")
:log info "DATAFAST-VPN: Descargando certificados..."
/tool fetch url=$urlCa dst-path=$fCa
:delay 3
/tool fetch url=$urlCert dst-path=$fCert
:delay 3
/tool fetch url=$urlKey dst-path=$fKey
:delay 3
:log info "DATAFAST-VPN: Certificados descargados"

# Importar CA (solo si no existe)
:if ([:len [/certificate find where common-name="DATAFAST-CA"]] = 0) do={
:log info "DATAFAST-VPN: Importando CA..."
/certificate import file-name=$fCa passphrase=""
:delay 3
}

# Importar certificado y clave del cliente
:log info "DATAFAST-VPN: Importando certificado cliente..."
/certificate import file-name=$fCert passphrase=""
:delay 3
/certificate import file-name=$fKey passphrase=""
:delay 3

# Verificar importacion
:if ([:len [/certificate find where common-name=$certCN]] = 0) do={
:log error "DATAFAST-VPN: Error - certificado no importado"
:error "Certificado no importado. Verificar descarga e importacion."
}

# Crear interfaz OVPN
# auth= omitido: v7 lo negocia via TLS (sha256/sha256-96 son ambiguos en v7)
:log info "DATAFAST-VPN: Creando interfaz OVPN..."
/interface ovpn-client add name=$tunnelName connect-to=$vpnServer port=1195 mode=ip cipher=$vpnCipher disabled=yes
/interface ovpn-client set $tunnelName user=$certCN certificate=$certCN${verifyLine}
/interface ovpn-client set $tunnelName add-default-route=no comment="DATAFAST-VPN"
/interface ovpn-client enable $tunnelName

:log info "DATAFAST-VPN: === Configuracion completada (v7 + certs) ==="
:log info "DATAFAST-VPN: Estado: /interface ovpn-client print"`;
  }

  // ── RouterOS v7 + Usuario/Contraseña ─────────────────────────
  private _scriptV7NoCert(cliente: VpnCliente, pass: string): string {
    const cipher    = cliente.cipher  || 'aes256';
    const authAlg   = cliente.authAlg || 'sha256';
    const vpnUser   = cliente.vpnUsuario || '';
    const verifyLine = cliente.verifyServerCert
      ? '\n/interface ovpn-client set $tunnelName verify-server-certificate=yes'
      : '';
    return `${this._header(cliente, `RouterOS v7 + Usuario/Contraseña | ${cipher}/${authAlg}`)}

:local vpnServer "${VPS_IP}"
:local tunnelName "datafast-vpn"
:local vpnUser "${vpnUser}"
:local vpnPass "${pass}"
:local vpnCipher "${cipher}"

:log info "DATAFAST-VPN: === Iniciando configuracion (v7 + user/pass) ==="

# Eliminar interfaz OVPN previa
:if ([:len [/interface ovpn-client find where name=$tunnelName]] > 0) do={
/interface ovpn-client disable [find where name=$tunnelName]
:delay 2
/interface ovpn-client remove [find where name=$tunnelName]
:log info "DATAFAST-VPN: Interfaz previa eliminada"
}

# Crear interfaz OVPN con usuario/contraseña (sin certificados)
# auth= omitido: v7 lo negocia via TLS (sha256/sha256-96 son ambiguos en v7)
:log info "DATAFAST-VPN: Creando interfaz OVPN..."
/interface ovpn-client add name=$tunnelName connect-to=$vpnServer port=1195 mode=ip cipher=$vpnCipher disabled=yes
/interface ovpn-client set $tunnelName user=$vpnUser password=$vpnPass${verifyLine}
/interface ovpn-client set $tunnelName add-default-route=no comment="DATAFAST-VPN"
/interface ovpn-client enable $tunnelName

:log info "DATAFAST-VPN: === Configuracion completada (v7 + user/pass) ==="
:log info "DATAFAST-VPN: Estado: /interface ovpn-client print"`;
  }
}
