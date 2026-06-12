import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { promisify }        from 'util';
import { execFile }         from 'child_process';
import * as fs              from 'fs/promises';
import * as path            from 'path';

import { OpenvpnConfig }          from './entities/openvpn-config.entity';
import { CreateOpenvpnConfigDto, UpdateOpenvpnConfigDto } from './dto/openvpn.dto';
import { JwtPayload }             from '../../common/decorators/current-user.decorator';

const execFileAsync = promisify(execFile);

const PKI_DIR    = '/etc/openvpn/server';
const PKI_META   = '/etc/openvpn/server/pki-meta.json';
const CLIENTS_DIR = '/etc/openvpn/server/clients';
const STATUS_LOG  = '/var/log/openvpn/status-mikrotik.log';
const OPENVPN_LOG = '/var/log/openvpn/openvpn.log';
const CLIENT_SCRIPT = '/opt/datafast/scripts/openvpn-client.sh';

export interface VpnConnectedClient {
  commonName: string;
  realAddress: string;
  vpnAddress: string;
  bytesReceived: number;
  bytesSent: number;
  connectedSince: string;
}

export interface VpnSystemStatus {
  installed: boolean;
  serviceActive: boolean;
  serviceEnabled: boolean;
  openvpnVersion: string;
  port: number;
  protocol: string;
  network: string;
  serverIp: string;
  connectedClients: VpnConnectedClient[];
  tunInterface: string | null;
  tunIp: string | null;
  caExpiry: string | null;
  serverExpiry: string | null;
  installedAt: string | null;
  lastError: string | null;
}

export interface VpnClientResult {
  name: string;
  ovpnContent?: string;
  certPath?: string;
}

@Injectable()
export class OpenvpnService {
  constructor(
    @InjectRepository(OpenvpnConfig)
    private readonly repo: Repository<OpenvpnConfig>,
  ) {}

  // ── CRUD config ──────────────────────────────────────────────

  async getConfig(empresaId: string): Promise<OpenvpnConfig | null> {
    return this.repo.findOne({
      where: { empresaId, activo: true, deletedAt: null as any },
    });
  }

  async upsertConfig(
    dto:  CreateOpenvpnConfigDto | UpdateOpenvpnConfigDto,
    user: JwtPayload,
  ): Promise<OpenvpnConfig> {
    const existing = await this.getConfig(user.empresaId);

    if (existing) {
      await this.repo.update(existing.id, dto as any);
      return this.repo.findOne({ where: { id: existing.id } }) as Promise<OpenvpnConfig>;
    }

    const config = this.repo.create({ ...dto, empresaId: user.empresaId } as any);
    return this.repo.save(config) as unknown as Promise<OpenvpnConfig>;
  }

  async deleteConfig(empresaId: string): Promise<void> {
    const config = await this.getConfig(empresaId);
    if (!config) throw new NotFoundException('No hay configuración OpenVPN');
    await this.repo.update(config.id, { activo: false, deletedAt: new Date() });
  }

  // ── Estado del sistema VPN ───────────────────────────────────

  async getSystemStatus(): Promise<VpnSystemStatus> {
    const status: VpnSystemStatus = {
      installed: false,
      serviceActive: false,
      serviceEnabled: false,
      openvpnVersion: '',
      port: 1195,
      protocol: 'tcp',
      network: '10.8.1.0/24',
      serverIp: '',
      connectedClients: [],
      tunInterface: null,
      tunIp: null,
      caExpiry: null,
      serverExpiry: null,
      installedAt: null,
      lastError: null,
    };

    // Verificar instalación
    try {
      const { stdout } = await execFileAsync('which', ['openvpn']);
      status.installed = stdout.trim().length > 0;
    } catch {
      return status;
    }

    // Versión de OpenVPN
    try {
      const { stdout } = await execFileAsync('openvpn', ['--version']);
      const match = stdout.match(/OpenVPN\s+([\d.]+)/);
      status.openvpnVersion = match ? match[1] : 'unknown';
    } catch { /* ignore */ }

    // Estado del servicio systemd
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', 'openvpn-server@mikrotik']);
      status.serviceActive = stdout.trim() === 'active';
    } catch { status.serviceActive = false; }

    try {
      const { stdout } = await execFileAsync('systemctl', ['is-enabled', 'openvpn-server@mikrotik']);
      status.serviceEnabled = stdout.trim() === 'enabled';
    } catch { status.serviceEnabled = false; }

    // Metadatos PKI
    try {
      const raw = await fs.readFile(PKI_META, 'utf8');
      const meta = JSON.parse(raw);
      status.port        = meta.mikrotikPort     ?? meta.vpnPort     ?? meta.port     ?? status.port;
      status.protocol    = meta.mikrotikProtocol ?? meta.vpnProtocol ?? meta.protocol ?? status.protocol;
      status.network     = meta.mikrotikNetwork  ?? meta.vpnNetwork  ?? meta.network  ?? status.network;
      status.serverIp    = meta.publicIp     ?? meta.server_ip ?? '';
      status.caExpiry    = meta.caExpiry     ?? meta.ca_expiry ?? null;
      status.serverExpiry = meta.serverExpiry ?? meta.server_expiry ?? null;
      status.installedAt = meta.installedAt  ?? meta.installed_at ?? null;
    } catch { /* PKI no instalada */ }

    // Clientes conectados (status.log formato v2)
    if (status.serviceActive) {
      try {
        const log = await fs.readFile(STATUS_LOG, 'utf8');
        status.connectedClients = this._parseStatusLog(log);
      } catch { /* log no disponible */ }
    }

    // Interfaz tun0
    try {
      const { stdout } = await execFileAsync('ip', ['addr', 'show', 'tun0']);
      status.tunInterface = 'tun0';
      const ipMatch = stdout.match(/inet\s+([\d.]+)/);
      status.tunIp = ipMatch ? ipMatch[1] : null;
    } catch { /* sin tun0 */ }

    return status;
  }

  private _parseStatusLog(log: string): VpnConnectedClient[] {
    const clients: VpnConnectedClient[] = [];
    for (const line of log.split('\n')) {
      if (!line.startsWith('CLIENT_LIST,')) continue;
      const parts = line.split(',');
      // CLIENT_LIST,cn,real_addr,vpn_addr,vpn_ipv6,bytes_recv,bytes_sent,since_ts,since_unix,username,client_id,peer_id,data_channel
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
  }

  // ── Control del servicio systemd ─────────────────────────────

  async controlService(action: 'start' | 'stop' | 'restart' | 'reload'): Promise<{ ok: boolean; output: string }> {
    const allowed = ['start', 'stop', 'restart', 'reload'];
    if (!allowed.includes(action)) throw new BadRequestException('Acción no permitida');

    try {
      const { stdout, stderr } = await execFileAsync('systemctl', [action, 'openvpn-server@mikrotik']);
      return { ok: true, output: (stdout + stderr).trim() };
    } catch (err: any) {
      return { ok: false, output: err.message };
    }
  }

  // ── Gestión de certificados de cliente ───────────────────────

  async generateClientConfig(nombre: string): Promise<VpnClientResult> {
    this._validateClientName(nombre);

    try {
      const { stdout } = await execFileAsync('bash', [CLIENT_SCRIPT, nombre]);
      return { name: nombre, ovpnContent: stdout };
    } catch (err: any) {
      throw new BadRequestException(`Error generando certificado: ${err.message}`);
    }
  }

  async revokeClientCert(nombre: string): Promise<void> {
    this._validateClientName(nombre);

    try {
      await execFileAsync('bash', [CLIENT_SCRIPT, nombre, '--revoke']);
    } catch (err: any) {
      throw new BadRequestException(`Error revocando certificado: ${err.message}`);
    }
  }

  async listClients(): Promise<string[]> {
    try {
      const entries = await fs.readdir(CLIENTS_DIR);
      return entries
        .filter(e => e.endsWith('.ovpn'))
        .map(e => e.replace(/\.ovpn$/, ''));
    } catch {
      return [];
    }
  }

  async getClientOvpnPath(nombre: string): Promise<string> {
    this._validateClientName(nombre);
    const filePath = path.join(CLIENTS_DIR, `${nombre}.ovpn`);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      throw new NotFoundException(`Certificado no encontrado para: ${nombre}`);
    }
  }

  async getClientOvpnContent(nombre: string): Promise<string> {
    const filePath = await this.getClientOvpnPath(nombre);
    return fs.readFile(filePath, 'utf8');
  }

  // ── Sincronizar certs del filesystem → BD ───────────────────

  async syncCertsFromFilesystem(empresaId: string): Promise<OpenvpnConfig> {
    const config = await this.getConfig(empresaId);
    if (!config) throw new NotFoundException('No hay configuración OpenVPN en BD');

    const updates: Partial<OpenvpnConfig> = {};

    const readFile = async (p: string): Promise<string | null> => {
      try { return await fs.readFile(p, 'utf8'); } catch { return null; }
    };

    updates.caCert     = await readFile(path.join(PKI_DIR, 'ca.crt'))        ?? config.caCert;
    updates.serverCert = await readFile(path.join(PKI_DIR, 'server.crt'))    ?? config.serverCert;
    updates.serverKey  = await readFile(path.join(PKI_DIR, 'server.key'))    ?? config.serverKey;
    updates.dhParams   = await readFile(path.join(PKI_DIR, 'dh.pem'))        ?? config.dhParams;
    updates.taKey      = await readFile(path.join(PKI_DIR, 'ta.key'))        ?? config.taKey;

    // Leer metadatos para fechas de expiración
    const metaStr = await readFile(PKI_META);
    if (metaStr) {
      try {
        const meta = JSON.parse(metaStr);
        updates.caExpiry      = meta.ca_expiry     ?? config.caExpiry;
        updates.serverExpiry  = meta.server_expiry ?? config.serverExpiry;
        updates.installedAt   = meta.installed_at  ? new Date(meta.installed_at) : config.installedAt;
      } catch { /* ignore parse errors */ }
    }

    await this.repo.update(config.id, updates as any);
    return this.repo.findOne({ where: { id: config.id } }) as Promise<OpenvpnConfig>;
  }

  // ── Logs del servidor ────────────────────────────────────────

  async getServerLogs(lines = 100): Promise<string> {
    const n = Math.min(Math.max(lines, 10), 500);
    try {
      const { stdout } = await execFileAsync('tail', ['-n', String(n), OPENVPN_LOG]);
      return stdout;
    } catch {
      return '';
    }
  }

  // ── Generar contenido server.conf ────────────────────────────

  generarServerConf(config: OpenvpnConfig): string {
    const lines = [
      `port ${config.puerto}`,
      `proto ${config.protocolo}`,
      `dev ${config.dispositivo}`,
      ``,
      `ca   ${PKI_DIR}/ca.crt`,
      `cert ${PKI_DIR}/server.crt`,
      `key  ${PKI_DIR}/server.key`,
      `dh   ${PKI_DIR}/dh.pem`,
      ``,
      `topology subnet`,
      `server ${config.vpnNetwork} ${config.vpnNetmask}`,
      `ifconfig-pool-persist /var/log/openvpn/ipp.txt`,
      ``,
      `# Rutas de gestión — sin redirect-gateway (ISP management)`,
      `push "route ${config.vpnNetwork} ${config.vpnNetmask}"`,
      `client-to-client`,
      ``,
      `keepalive 10 120`,
      `cipher AES-256-CBC`,
      `ncp-ciphers AES-256-GCM:AES-128-GCM:AES-256-CBC`,
      `auth SHA256`,
      `tls-version-min 1.2`,
    ];

    if (config.taKey) {
      lines.push(`tls-crypt ${PKI_DIR}/ta.key 0`);
    }

    lines.push(
      ``,
      `persist-key`,
      `persist-tun`,
      `user nobody`,
      `group nogroup`,
      ``,
      `status /var/log/openvpn/openvpn-status.log 30`,
      `status-version 2`,
      `log-append /var/log/openvpn/openvpn.log`,
      `verb 3`,
    );

    if (config.protocolo === 'tcp') {
      lines.push(`explicit-exit-notify 0`);
    } else {
      lines.push(`explicit-exit-notify 1`);
    }

    return lines.join('\n');
  }

  // ── Generar .ovpn para cliente ───────────────────────────────

  generarClienteOvpn(config: OpenvpnConfig, routerNombre: string, clientCert?: string, clientKey?: string): string {
    const lines = [
      `client`,
      `dev ${config.dispositivo}`,
      `proto ${config.protocolo}`,
      `remote ${config.servidorIp} ${config.puerto}`,
      `resolv-retry infinite`,
      `nobind`,
      `persist-key`,
      `persist-tun`,
      `cipher AES-256-CBC`,
      `ncp-ciphers AES-256-GCM:AES-128-GCM:AES-256-CBC`,
      `auth SHA256`,
      `tls-version-min 1.2`,
      `verb 3`,
      ``,
    ];

    if (config.caCert) {
      lines.push(`<ca>`, config.caCert.trim(), `</ca>`);
    }

    if (clientCert) {
      lines.push(`<cert>`, clientCert.trim(), `</cert>`);
    }

    if (clientKey) {
      lines.push(`<key>`, clientKey.trim(), `</key>`);
    }

    if (config.taKey) {
      lines.push(`<tls-crypt>`, config.taKey.trim(), `</tls-crypt>`);
    }

    lines.push(``, `# Router: ${routerNombre}`, `# Generado por DATAFAST CRM`);
    return lines.join('\n');
  }

  // ── Instrucciones manuales (legacy) ──────────────────────────

  generarInstrucciones(config: OpenvpnConfig): string {
    return `
# ═══════════════════════════════════════════════════
#  DATAFAST CRM — Instalación OpenVPN (referencia)
#  Usa el instalador automático: bash scripts/openvpn-setup.sh
# ═══════════════════════════════════════════════════

# Red VPN: ${config.vpnNetwork}/${config.vpnNetmask}
# Puerto:  ${config.puerto}/${config.protocolo}

sudo bash /opt/datafast/scripts/openvpn-setup.sh
`.trim();
  }

  // ── Helpers ──────────────────────────────────────────────────

  private _validateClientName(nombre: string): void {
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(nombre)) {
      throw new BadRequestException('Nombre de cliente inválido (2-64 chars, alfanumérico, _ -)');
    }
  }
}
