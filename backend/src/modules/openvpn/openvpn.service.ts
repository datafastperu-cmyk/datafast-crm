import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';

import { OpenvpnConfig }          from './entities/openvpn-config.entity';
import { CreateOpenvpnConfigDto, UpdateOpenvpnConfigDto } from './dto/openvpn.dto';
import { JwtPayload }             from '../../common/decorators/current-user.decorator';

@Injectable()
export class OpenvpnService {
  constructor(
    @InjectRepository(OpenvpnConfig)
    private readonly repo: Repository<OpenvpnConfig>,
  ) {}

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

    const config = this.repo.create({
      ...dto,
      empresaId: user.empresaId,
    } as any);
    return this.repo.save(config) as unknown as Promise<OpenvpnConfig>;
  }

  async deleteConfig(empresaId: string): Promise<void> {
    const config = await this.getConfig(empresaId);
    if (!config) throw new NotFoundException('No hay configuración OpenVPN');
    await this.repo.update(config.id, { activo: false, deletedAt: new Date() });
  }

  // ── Generar contenido del archivo .conf del servidor ────────
  generarServerConf(config: OpenvpnConfig): string {
    return [
      `port ${config.puerto}`,
      `proto ${config.protocolo}`,
      `dev ${config.dispositivo}`,
      ``,
      `ca ca.crt`,
      `cert server.crt`,
      `key server.key`,
      `dh dh.pem`,
      ``,
      `server ${config.vpnNetwork} ${config.vpnNetmask}`,
      `ifconfig-pool-persist /var/log/openvpn/ipp.txt`,
      ``,
      `keepalive 10 120`,
      `cipher AES-256-CBC`,
      `persist-key`,
      `persist-tun`,
      ``,
      `status /var/log/openvpn/openvpn-status.log`,
      `log-append /var/log/openvpn/openvpn.log`,
      `verb 3`,
      ``,
      `# Rutas push para que los clientes accedan a la red del servidor`,
      `push "redirect-gateway def1 bypass-dhcp"`,
      `push "dhcp-option DNS 8.8.8.8"`,
    ].join('\n');
  }

  // ── Generar .ovpn para importar en MikroTik ──────────────────
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
      `verb 3`,
      ``,
      `# Certificados — reemplazar con los generados por EasyRSA`,
    ];

    if (config.caCert) {
      lines.push(`<ca>`, config.caCert.trim(), `</ca>`);
    } else {
      lines.push(`# <ca>`, `# Pegar aquí el contenido de ca.crt`, `# </ca>`);
    }

    if (clientCert) {
      lines.push(`<cert>`, clientCert.trim(), `</cert>`);
    } else {
      lines.push(`# <cert>`, `# Pegar aquí el contenido del certificado del cliente`, `# </cert>`);
    }

    if (clientKey) {
      lines.push(`<key>`, clientKey.trim(), `</key>`);
    } else {
      lines.push(`# <key>`, `# Pegar aquí la clave privada del cliente`, `# </key>`);
    }

    lines.push(``);
    lines.push(`# Router: ${routerNombre}`);
    lines.push(`# Generado por DATAFAST CRM`);

    return lines.join('\n');
  }

  // ── Instrucciones de instalación del servidor ─────────────────
  generarInstrucciones(config: OpenvpnConfig): string {
    return `
# ═══════════════════════════════════════════════════
#  Instalación de OpenVPN en el VPS (Ubuntu/Debian)
# ═══════════════════════════════════════════════════

# 1. Instalar OpenVPN y EasyRSA
sudo apt update && sudo apt install -y openvpn easy-rsa

# 2. Configurar la CA con EasyRSA
make-cadir ~/easy-rsa
cd ~/easy-rsa
./easyrsa init-pki
./easyrsa build-ca nopass
./easyrsa gen-req server nopass
./easyrsa sign-req server server
./easyrsa gen-dh
openvpn --genkey secret ta.key

# 3. Copiar archivos al directorio de OpenVPN
sudo cp pki/ca.crt          /etc/openvpn/
sudo cp pki/issued/server.crt /etc/openvpn/
sudo cp pki/private/server.key /etc/openvpn/
sudo cp pki/dh.pem          /etc/openvpn/

# 4. Crear la config del servidor (pegar contenido de "server.conf")
sudo nano /etc/openvpn/server.conf

# 5. Para cada router MikroTik, generar un certificado de cliente:
./easyrsa gen-req router-<nombre> nopass
./easyrsa sign-req client router-<nombre>

# 6. Habilitar y arrancar el servicio
sudo systemctl enable openvpn@server
sudo systemctl start openvpn@server

# 7. Habilitar IP forwarding
echo 'net.ipv4.ip_forward=1' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Red VPN: ${config.vpnNetwork}/${config.vpnNetmask}
# Puerto:  ${config.puerto}/${config.protocolo}
`.trim();
  }
}
