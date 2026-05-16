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
import { generateToken }                from '../../../common/utils/encryption.util';
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
    // Cert name: mt-{slug}-{6hex}  (max 64 chars, safe for PKI CN)
    const slug = dto.nombre
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40);
    const shortId    = generateToken(3);           // 6 hex chars
    const nombreCert = `mt-${slug}-${shortId}`;

    // Generate PKI certificate via easyrsa
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

    const tokenDescarga  = generateToken(32);  // 64-char hex token
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);  // 24h

    const cliente = this.repo.create({
      empresaId:    user.empresaId,
      nombre:       dto.nombre,
      ubicacion:    dto.ubicacion,
      descripcion:  dto.descripcion,
      nombreCert,
      estado:       'pendiente',
      tokenDescarga,
      tokenExpiresAt,
      activo:       true,
    });
    await this.repo.save(cliente);
    this.logger.log(`VPN cliente creado: ${cliente.id} | cert: ${nombreCert}`);

    const script = this._generarScript(cliente);
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

    const connectedClients = await this._leerStatusLog();
    const found = connectedClients.find(c => c.commonName === cliente.nombreCert);

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
      estado:           'conectado',
      vpnIp:            found.vpnAddress,
      ipReal,
      ultimoHandshake:  new Date(),
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
      conectado:         true,
      vpnIp:             found.vpnAddress,
      ipReal,
      routerRegistrado,
      routerId:          routerId ?? undefined,
      mensaje:           `Túnel activo | IP VPN: ${found.vpnAddress} | Conectado desde: ${found.connectedSince}`,
    };
  }

  // ── Revocar certificado ───────────────────────────────────────

  async revocar(id: string, empresaId: string): Promise<void> {
    const cliente = await this._getCliente(id, empresaId);
    if (cliente.estado === 'revocado') throw new ConflictException('Ya revocado');

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
    // Evitar duplicados por vpnIp
    const existing = await this.routerRepo.findOne({
      where: { vpnIp, empresaId },
    });
    if (existing) return existing;

    const { encrypt } = await import('../../../common/utils/encryption.util');

    const router = this.routerRepo.create({
      empresaId,
      nombre:          cliente.nombre,
      descripcion:     cliente.descripcion,
      ubicacion:       cliente.ubicacion,
      ipGestion:       vpnIp,       // Usar vpnIp como IP de gestión principal
      vpnIp,
      usuario:         'admin',
      passwordCifrado: encrypt(''),  // Sin credenciales aún — admin configura después
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

  // ── Generador de script RouterOS ──────────────────────────────

  private _generarScript(cliente: VpnCliente): string {
    const fecha     = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });
    const fetchUrl  = `${API_BASE}/openvpn/mikrotik-clients/${cliente.tokenDescarga}/certs`;
    const cn        = cliente.nombreCert;
    const prefix    = `df-${cn}`;

    return `# ================================================================
# DATAFAST ISP - Configuracion Tunel VPN MikroTik
# ================================================================
# Router     : ${cliente.nombre}
# Ubicacion  : ${cliente.ubicacion || 'Sin especificar'}
# Servidor   : ${VPS_IP}:${VPN_PORT}
# Certificado: ${cn}
# Generado   : ${fecha}
# ----------------------------------------------------------------
# INSTRUCCIONES:
#  1. Abrir Terminal MikroTik (Winbox > New Terminal o SSH)
#  2. Copiar y pegar TODO el script
#  3. Presionar Enter y esperar el mensaje de confirmacion
#  4. Volver al panel DATAFAST y presionar CONECTAR
# ================================================================

:local vpnServer "${VPS_IP}"
:local vpnPort ${VPN_PORT}
:local certCN "${cn}"
:local tunnelName "datafast-vpn"
:local certPrefix "${prefix}"
:local fetchUrl "${fetchUrl}"

:log info "DATAFAST-VPN: === Iniciando configuracion ==="

# Eliminar interfaz OVPN previa
:if ([:len [/interface ovpn-client find where name=$tunnelName]] > 0) do={
/interface ovpn-client disable [find where name=$tunnelName]
:delay 2
/interface ovpn-client remove [find where name=$tunnelName]
:log info "DATAFAST-VPN: Interfaz previa eliminada"
}

# Eliminar certificados previos de este cliente
:foreach c in=[/certificate find where common-name=$certCN] do={ /certificate remove $c }
:delay 1

# Descargar certificados desde servidor DATAFAST
:local fCa   ($certPrefix . "-ca.crt")
:local fCert ($certPrefix . "-client.crt")
:local fKey  ($certPrefix . "-client.key")
:log info "DATAFAST-VPN: Descargando certificados..."
/tool fetch mode=http url=($fetchUrl . "/ca.crt") dst-path=$fCa
:delay 3
/tool fetch mode=http url=($fetchUrl . "/client.crt") dst-path=$fCert
:delay 3
/tool fetch mode=http url=($fetchUrl . "/client.key") dst-path=$fKey
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

# Verificar que el certificado fue importado
:if ([:len [/certificate find where common-name=$certCN]] = 0) do={
:log error "DATAFAST-VPN: Error - certificado no importado correctamente"
:error "Certificado no importado. Verificar descarga e importacion."
}

# Crear interfaz OVPN (dividido en lineas cortas — compatibilidad v6/v7)
:log info "DATAFAST-VPN: Creando interfaz OVPN..."
/interface ovpn-client add name=$tunnelName connect-to=$vpnServer port=$vpnPort mode=ip disabled=yes
/interface ovpn-client set [find name=$tunnelName] user=$certCN certificate=$certCN
/interface ovpn-client set [find name=$tunnelName] cipher=aes256 auth=sha256
/interface ovpn-client set [find name=$tunnelName] add-default-route=no comment="DATAFAST-VPN"
/interface ovpn-client enable [find name=$tunnelName]

:log info "DATAFAST-VPN: === Configuracion completada exitosamente ==="
:log info "DATAFAST-VPN: Estado: /interface ovpn-client print"`;
  }
}
