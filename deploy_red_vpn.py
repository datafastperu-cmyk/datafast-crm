#!/usr/bin/env python3
"""
Deploy: GESTIÓN DE RED (Routers + OpenVPN)
Corre este script en el VPS: python3 deploy_red_vpn.py
"""
import os, subprocess, sys

BASE = os.environ.get('APP_BASE', '/opt/datafast')
BE   = f'{BASE}/backend'
FE   = f'{BASE}/frontend'

def w(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(content)
    print(f'  ✓ {path}')

def run(*cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:] if r.stdout else '')
        print(r.stderr[-2000:] if r.stderr else '')
        sys.exit(f'FALLO: {" ".join(cmd)}')
    return r.stdout

print('── 1. Escribiendo archivos backend ──')

# ── router.entity.ts ──────────────────────────────────────────────
w(f'{BE}/src/modules/mikrotik/entities/router.entity.ts', '''import { Entity, Column, Index } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

export enum VersionRouterOS {
  V6          = 'v6',
  V7          = 'v7',
  DESCONOCIDA = 'desconocida',
}

export enum MetodoConexion {
  API     = 'api',
  API_SSL = 'api_ssl',
  SSH     = 'ssh',
  SNMP    = 'snmp',
}

export enum EstadoEquipo {
  ONLINE        = 'online',
  OFFLINE       = 'offline',
  DEGRADADO     = 'degradado',
  MANTENIMIENTO = 'mantenimiento',
  DESCONOCIDO   = 'desconocido',
}

export enum TipoControl {
  NINGUNA            = 'ninguna',
  AMARRE_IP_MAC      = 'amarre_ip_mac',
  AMARRE_IP_MAC_DHCP = 'amarre_ip_mac_dhcp',
}

@Entity('routers')
@Index(['empresaId', 'activo'])
@Index(['empresaId', 'estado'])
@Index(['ipGestion'])
export class Router extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ length: 100 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ length: 200, nullable: true })
  ubicacion: string;

  @Column({ length: 100, nullable: true })
  modelo: string;

  @Column({ name: 'ip_gestion', type: 'inet' })
  ipGestion: string;

  @Column({ name: 'puerto_api', type: 'smallint', default: 8728 })
  puertoApi: number;

  @Column({ name: 'puerto_api_ssl', type: 'smallint', default: 8729 })
  puertoApiSsl: number;

  @Column({ name: 'puerto_ssh', type: 'smallint', default: 22 })
  puertoSsh: number;

  @Column({ length: 100 })
  usuario: string;

  @Column({ name: 'password_cifrado', length: 500 })
  passwordCifrado: string;

  @Column({
    name: 'version_ros',
    type: 'enum',
    enum: VersionRouterOS,
    default: VersionRouterOS.DESCONOCIDA,
  })
  versionRos: VersionRouterOS;

  @Column({
    name: 'metodo_conexion',
    type: 'enum',
    enum: MetodoConexion,
    default: MetodoConexion.API,
  })
  metodoConexion: MetodoConexion;

  @Column({ name: 'usar_ssl', default: false })
  usarSsl: boolean;

  @Column({ name: 'timeout_conexion', type: 'smallint', default: 10 })
  timeoutConexion: number;

  @Column({
    type: 'enum',
    enum: EstadoEquipo,
    default: EstadoEquipo.DESCONOCIDO,
  })
  estado: EstadoEquipo;

  @Column({ name: 'ultimo_ping', type: 'timestamptz', nullable: true })
  ultimoPing: Date;

  @Column({ name: 'latencia_ms', type: 'decimal', precision: 8, scale: 2, nullable: true })
  latenciaMs: number;

  @Column({ name: 'uptime_segundos', type: 'bigint', nullable: true })
  uptimeSegundos: number;

  @Column({ name: 'version_firmware', length: 50, nullable: true })
  versionFirmware: string;

  @Column({ name: 'identity_routeros', length: 100, nullable: true })
  identityRouteros: string;

  @Column({ name: 'cpu_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  cpuUsoPct: number;

  @Column({ name: 'memoria_uso_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  memoriaUsoPct: number;

  @Column({ name: 'temperatura_c', type: 'decimal', precision: 5, scale: 1, nullable: true })
  temperaturaC: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitud: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitud: number;

  @Column({ name: 'auto_configurar_queues',   default: true })
  autoConfigurarQueues: boolean;

  @Column({ name: 'auto_configurar_pppoe',    default: true })
  autoConfigurarPppoe: boolean;

  @Column({ name: 'auto_configurar_firewall', default: true })
  autoConfigurarFirewall: boolean;

  @Column({ name: 'snmp_community', length: 100, default: 'public' })
  snmpCommunity: string;

  @Column({ name: 'snmp_version', type: 'smallint', default: 2 })
  snmpVersion: number;

  @Column({ name: 'vpn_ip', length: 50, nullable: true })
  vpnIp: string;

  @Column({
    name: 'tipo_control',
    type: 'enum',
    enum: TipoControl,
    default: TipoControl.NINGUNA,
  })
  tipoControl: TipoControl;

  @Column({ default: true })
  activo: boolean;
}
''')

# ── migration 1778900000003 ────────────────────────────────────────
w(f'{BE}/src/database/migrations/1778900000003-AddRouterVpnAndOpenVPN.ts', """import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRouterVpnAndOpenVPN1778900000003 implements MigrationInterface {
  name = 'AddRouterVpnAndOpenVPN1778900000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'routers_tipo_control_enum') THEN
          CREATE TYPE routers_tipo_control_enum AS ENUM (
            'ninguna', 'amarre_ip_mac', 'amarre_ip_mac_dhcp'
          );
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE routers
        ADD COLUMN IF NOT EXISTS vpn_ip       VARCHAR(50),
        ADD COLUMN IF NOT EXISTS tipo_control routers_tipo_control_enum NOT NULL DEFAULT 'ninguna'
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS openvpn_config (
        id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id    UUID        NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nombre        VARCHAR(100) NOT NULL DEFAULT 'Servidor VPN',
        servidor_ip   VARCHAR(100) NOT NULL,
        puerto        SMALLINT    NOT NULL DEFAULT 1194,
        protocolo     VARCHAR(10)  NOT NULL DEFAULT 'udp',
        dispositivo   VARCHAR(10)  NOT NULL DEFAULT 'tun',
        vpn_network   VARCHAR(20)  NOT NULL DEFAULT '10.8.0.0',
        vpn_netmask   VARCHAR(20)  NOT NULL DEFAULT '255.255.255.0',
        ca_cert       TEXT,
        server_cert   TEXT,
        server_key    TEXT,
        dh_params     TEXT,
        activo        BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_openvpn_empresa
        ON openvpn_config (empresa_id) WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS openvpn_config CASCADE`);
    await queryRunner.query(`ALTER TABLE routers DROP COLUMN IF EXISTS vpn_ip`);
    await queryRunner.query(`ALTER TABLE routers DROP COLUMN IF EXISTS tipo_control`);
    await queryRunner.query(`DROP TYPE IF EXISTS routers_tipo_control_enum CASCADE`);
  }
}
""")

# ── openvpn entity ────────────────────────────────────────────────
w(f'{BE}/src/modules/openvpn/entities/openvpn-config.entity.ts', """import { Entity, Column } from 'typeorm';
import { BaseModel }      from '../../../common/entities/base.entity';

@Entity('openvpn_config')
export class OpenvpnConfig extends BaseModel {

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ length: 100, default: 'Servidor VPN' })
  nombre: string;

  @Column({ name: 'servidor_ip', length: 100 })
  servidorIp: string;

  @Column({ type: 'smallint', default: 1194 })
  puerto: number;

  @Column({ length: 10, default: 'udp' })
  protocolo: string;

  @Column({ length: 10, default: 'tun' })
  dispositivo: string;

  @Column({ name: 'vpn_network', length: 20, default: '10.8.0.0' })
  vpnNetwork: string;

  @Column({ name: 'vpn_netmask', length: 20, default: '255.255.255.0' })
  vpnNetmask: string;

  @Column({ name: 'ca_cert', type: 'text', nullable: true })
  caCert: string;

  @Column({ name: 'server_cert', type: 'text', nullable: true })
  serverCert: string;

  @Column({ name: 'server_key', type: 'text', nullable: true })
  serverKey: string;

  @Column({ name: 'dh_params', type: 'text', nullable: true })
  dhParams: string;

  @Column({ default: true })
  activo: boolean;
}
""")

# ── openvpn dto ───────────────────────────────────────────────────
w(f'{BE}/src/modules/openvpn/dto/openvpn.dto.ts', """import {
  IsString, IsOptional, IsInt, IsNotEmpty,
  Min, Max, MaxLength, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateOpenvpnConfigDto {
  @ApiPropertyOptional({ default: 'Servidor VPN' })
  @IsOptional() @IsString() @MaxLength(100)
  nombre?: string;

  @ApiProperty({ example: '149.34.48.224' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  servidorIp: string;

  @ApiPropertyOptional({ default: 1194 })
  @IsOptional() @IsInt() @Min(1) @Max(65535) @Type(() => Number)
  puerto?: number;

  @ApiPropertyOptional({ enum: ['udp', 'tcp'], default: 'udp' })
  @IsOptional() @IsIn(['udp', 'tcp'])
  protocolo?: string;

  @ApiPropertyOptional({ enum: ['tun', 'tap'], default: 'tun' })
  @IsOptional() @IsIn(['tun', 'tap'])
  dispositivo?: string;

  @ApiPropertyOptional({ example: '10.8.0.0' })
  @IsOptional() @IsString() @MaxLength(20)
  vpnNetwork?: string;

  @ApiPropertyOptional({ example: '255.255.255.0' })
  @IsOptional() @IsString() @MaxLength(20)
  vpnNetmask?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  caCert?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  serverCert?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  serverKey?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  dhParams?: string;
}

export class UpdateOpenvpnConfigDto extends PartialType(CreateOpenvpnConfigDto) {}
""")

# ── openvpn service ───────────────────────────────────────────────
w(f'{BE}/src/modules/openvpn/openvpn.service.ts', """import { Injectable, NotFoundException } from '@nestjs/common';
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
    return this.repo.save(config);
  }

  async deleteConfig(empresaId: string): Promise<void> {
    const config = await this.getConfig(empresaId);
    if (!config) throw new NotFoundException('No hay configuracion OpenVPN');
    await this.repo.update(config.id, { activo: false, deletedAt: new Date() } as any);
  }

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
      `push "redirect-gateway def1 bypass-dhcp"`,
      `push "dhcp-option DNS 8.8.8.8"`,
    ].join('\\n');
  }

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
      lines.push(`# <ca>`, `# Pegar aqui el contenido de ca.crt`, `# </ca>`);
    }

    if (clientCert) {
      lines.push(`<cert>`, clientCert.trim(), `</cert>`);
    } else {
      lines.push(`# <cert>`, `# Pegar aqui el certificado del cliente`, `# </cert>`);
    }

    if (clientKey) {
      lines.push(`<key>`, clientKey.trim(), `</key>`);
    } else {
      lines.push(`# <key>`, `# Pegar aqui la clave privada del cliente`, `# </key>`);
    }

    lines.push(``, `# Router: ${routerNombre}`, `# Generado por DATAFAST CRM`);
    return lines.join('\\n');
  }

  generarInstrucciones(config: OpenvpnConfig): string {
    return `# Instalacion de OpenVPN en el VPS
sudo apt update && sudo apt install -y openvpn easy-rsa
make-cadir ~/easy-rsa && cd ~/easy-rsa
./easyrsa init-pki
./easyrsa build-ca nopass
./easyrsa gen-req server nopass
./easyrsa sign-req server server
./easyrsa gen-dh
sudo cp pki/ca.crt pki/issued/server.crt pki/private/server.key pki/dh.pem /etc/openvpn/
# Copiar server.conf a /etc/openvpn/server.conf
sudo systemctl enable openvpn@server && sudo systemctl start openvpn@server
echo 'net.ipv4.ip_forward=1' | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
# Red VPN: ${config.vpnNetwork}/${config.vpnNetmask} | Puerto: ${config.puerto}/${config.protocolo}`.trim();
  }
}
""")

# ── openvpn controller ────────────────────────────────────────────
w(f'{BE}/src/modules/openvpn/openvpn.controller.ts', """import {
  Controller, Get, Post, Put, Delete,
  Body, Param, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { Response }       from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { OpenvpnService }          from './openvpn.service';
import { CreateOpenvpnConfigDto, UpdateOpenvpnConfigDto } from './dto/openvpn.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse } from '../../common/dto/response.dto';

@ApiTags('OpenVPN')
@ApiBearerAuth('JWT')
@Controller('openvpn')
export class OpenvpnController {
  constructor(private readonly svc: OpenvpnService) {}

  @Get('config')
  @RequirePermission('mikrotik:view')
  async getConfig(@CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.getConfig(user.empresaId));
  }

  @Post('config')
  @RequirePermission('mikrotik:manage')
  async upsertConfig(@Body() dto: CreateOpenvpnConfigDto, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.upsertConfig(dto, user), 'Configuracion guardada');
  }

  @Put('config')
  @RequirePermission('mikrotik:manage')
  async updateConfig(@Body() dto: UpdateOpenvpnConfigDto, @CurrentUser() user: JwtPayload) {
    return StdResponse.ok(await this.svc.upsertConfig(dto, user), 'Configuracion actualizada');
  }

  @Delete('config')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConfig(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.svc.deleteConfig(user.empresaId);
  }

  @Get('config/download/server-conf')
  @RequirePermission('mikrotik:manage')
  async downloadServerConf(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) return res.status(404).json({ message: 'Sin configuracion' });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="server.conf"');
    return res.send(this.svc.generarServerConf(config));
  }

  @Get('config/download/instrucciones')
  @RequirePermission('mikrotik:manage')
  async downloadInstrucciones(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) return res.status(404).json({ message: 'Sin configuracion' });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="instalacion-openvpn.sh"');
    return res.send(this.svc.generarInstrucciones(config));
  }

  @Get('config/cliente/:routerNombre')
  @RequirePermission('mikrotik:manage')
  async generarClienteOvpn(
    @Param('routerNombre') routerNombre: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const config = await this.svc.getConfig(user.empresaId);
    if (!config) return res.status(404).json({ message: 'Sin configuracion' });
    res.setHeader('Content-Type', 'application/x-openvpn-profile');
    res.setHeader('Content-Disposition', `attachment; filename="router-${routerNombre}.ovpn"`);
    return res.send(this.svc.generarClienteOvpn(config, routerNombre));
  }
}
""")

# ── openvpn module ────────────────────────────────────────────────
w(f'{BE}/src/modules/openvpn/openvpn.module.ts', """import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OpenvpnConfig }    from './entities/openvpn-config.entity';
import { OpenvpnService }   from './openvpn.service';
import { OpenvpnController } from './openvpn.controller';

@Module({
  imports:     [TypeOrmModule.forFeature([OpenvpnConfig])],
  controllers: [OpenvpnController],
  providers:   [OpenvpnService],
  exports:     [OpenvpnService],
})
export class OpenvpnModule {}
""")

print('── 2. Leyendo y parcheando archivos existentes ──')

# ── Parchear app.module.ts ────────────────────────────────────────
app_module_path = f'{BE}/src/app.module.ts'
with open(app_module_path) as f:
    content = f.read()

if "OpenvpnModule" not in content:
    content = content.replace(
        "import { WorkersModule }          from './modules/workers/workers.module';",
        "import { WorkersModule }          from './modules/workers/workers.module';\nimport { OpenvpnModule }          from './modules/openvpn/openvpn.module';",
        1
    )
    content = content.replace(
        "    WorkersModule,\n  ],",
        "    WorkersModule,\n    OpenvpnModule,\n  ],"
    )
    with open(app_module_path, 'w') as f:
        f.write(content)
    print(f'  ✓ app.module.ts (OpenvpnModule agregado)')
else:
    print(f'  - app.module.ts (OpenvpnModule ya presente)')

# ── Parchear mikrotik.dto.ts ──────────────────────────────────────
dto_path = f'{BE}/src/modules/mikrotik/dto/mikrotik.dto.ts'
with open(dto_path) as f:
    dto = f.read()

if 'AmareIpMacDto' not in dto:
    dto = dto.replace(
        "  MetodoConexion, VersionRouterOS,",
        "  MetodoConexion, VersionRouterOS, TipoControl,"
    )
    # Add vpnIp + tipoControl to CreateRouterDto
    dto = dto.replace(
        "  @ApiPropertyOptional({ default: 'public' })\n  @IsOptional() @IsString() @MaxLength(100)\n  snmpCommunity?: string;",
        """  @ApiPropertyOptional({ example: '10.8.0.2' })
  @IsOptional() @IsString() @MaxLength(50)
  vpnIp?: string;

  @ApiPropertyOptional({ enum: TipoControl, default: TipoControl.NINGUNA })
  @IsOptional() @IsEnum(TipoControl)
  tipoControl?: TipoControl;

  @ApiPropertyOptional({ default: 'public' })
  @IsOptional() @IsString() @MaxLength(100)
  snmpCommunity?: string;"""
    )
    # Add AmareIpMacDto before PingDto
    dto = dto.replace(
        "// ─── Ping desde el router ─────────────────────────────────────",
        """// ─── Amarre IP-MAC ──────────────────────────────────────────────────────
export class AmareIpMacDto {
  @ApiProperty({ example: '192.168.1.10' })
  @IsIP()
  ip: string;

  @ApiProperty({ example: 'AA:BB:CC:DD:EE:FF' })
  @IsString() @IsNotEmpty() @MaxLength(17)
  mac: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  hostname?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ example: 'dhcp1' })
  @IsOptional() @IsString() @MaxLength(100)
  dhcpServer?: string;
}

// ─── Ping desde el router ─────────────────────────────────────"""
    )
    with open(dto_path, 'w') as f:
        f.write(dto)
    print(f'  ✓ mikrotik.dto.ts (AmareIpMacDto + vpnIp/tipoControl)')
else:
    print(f'  - mikrotik.dto.ts (ya actualizado)')

# ── Parchear mikrotik.service.ts ──────────────────────────────────
svc_path = f'{BE}/src/modules/mikrotik/mikrotik.service.ts'
with open(svc_path) as f:
    svc = f.read()

if 'aplicarAmareIpMac' not in svc:
    svc = svc.replace(
        "import { Router, VersionRouterOS, EstadoEquipo } from './entities/router.entity';",
        "import { Router, VersionRouterOS, EstadoEquipo, TipoControl } from './entities/router.entity';"
    )
    svc = svc.replace(
        "  CreateRouterDto, UpdateRouterDto, ProvisionarClienteDto,\n  SuspenderClienteDto, ReactivarClienteDto,",
        "  CreateRouterDto, UpdateRouterDto, ProvisionarClienteDto,\n  SuspenderClienteDto, ReactivarClienteDto, AmareIpMacDto,"
    )
    # Update getCredentials to use vpnIp
    svc = svc.replace(
        "    const port   = router.usarSsl ? router.puertoApiSsl : router.puertoApi;\n    return {\n      id:              router.id,\n      ip:              router.ipGestion,",
        "    const port   = router.usarSsl ? router.puertoApiSsl : router.puertoApi;\n    const ip = router.vpnIp || router.ipGestion;\n    return {\n      id:              router.id,\n      ip,"
    )
    # Add aplicarAmareIpMac before configurarFirewallControl
    svc = svc.replace(
        "  // ── Configurar reglas de firewall en un router nuevo ─────",
        '''  // ── Amarre IP + MAC (ARP estático + opcionalmente DHCP lease) ─────────
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
      const arpExistente = await api.write('/ip/arp/print', [
        `?address=${dto.ip}`, `?mac-address=${dto.mac}`,
      ]);
      if (!arpExistente.length) {
        await api.write('/ip/arp/add', [
          `=address=${dto.ip}`, `=mac-address=${dto.mac}`, `=comment=${comment}`,
        ]);
      }
      if (router.tipoControl === TipoControl.AMARRE_IP_MAC_DHCP || dto.dhcpServer) {
        const server = dto.dhcpServer || 'dhcp1';
        const leaseExistente = await api.write('/ip/dhcp-server/lease/print', [`?address=${dto.ip}`]);
        if (!leaseExistente.length) {
          await api.write('/ip/dhcp-server/lease/add', [
            `=address=${dto.ip}`, `=mac-address=${dto.mac}`,
            `=server=${server}`, `=comment=${comment}`,
          ]);
        }
        dhcpAdded = true;
      }
    });

    await this.auditoria.log({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      accion: 'AMARRE_IP_MAC', modulo: 'mikrotik', entidadId: dto.clienteId || routerId,
      descripcion: `Amarre IP ${dto.ip} <-> MAC ${dto.mac} en ${creds.ip}${dhcpAdded ? ' + DHCP lease' : ''}`,
    });
    return { arp: true, dhcp: dhcpAdded };
  }

  // ── Configurar reglas de firewall en un router nuevo ─────'''
    )
    with open(svc_path, 'w') as f:
        f.write(svc)
    print(f'  ✓ mikrotik.service.ts (aplicarAmareIpMac + vpnIp en getCredentials)')
else:
    print(f'  - mikrotik.service.ts (ya actualizado)')

# ── Parchear mikrotik.controller.ts ──────────────────────────────
ctrl_path = f'{BE}/src/modules/mikrotik/mikrotik.controller.ts'
with open(ctrl_path) as f:
    ctrl = f.read()

if 'AmareIpMacDto' not in ctrl:
    ctrl = ctrl.replace(
        "  ActualizarQueueDto, PingDto,",
        "  ActualizarQueueDto, PingDto, AmareIpMacDto,"
    )
    # Replace the stub DHCP binding with the proper amarre endpoint
    old_dhcp = """  // ─── DHCP BINDINGS ────────────────────────────────────────

  @Post('routers/:id/dhcp/binding')
  @RequirePermission('mikrotik:manage')
  @ApiOperation({ summary: 'Crear binding estático DHCP (amarre IP-MAC)' })
  @ApiParam({ name: 'id' })
  async crearDhcpBinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DhcpBindingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const router = await this.svc.findOne(id, user.empresaId);
    // Delegamos directamente al servicio de firewall vía MikrotikService
    return StdResponse.ok({ mensaje: 'DHCP binding creado' }, 'Binding creado');
  }"""
    new_amarre = """  // ─── AMARRE IP + MAC ──────────────────────────────────────

  @Post('routers/:id/amarre-ip-mac')
  @RequirePermission('mikrotik:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aplicar amarre IP-MAC (ARP estático + opcionalmente DHCP lease)' })
  @ApiParam({ name: 'id' })
  async aplicarAmareIpMac(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AmareIpMacDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.svc.aplicarAmareIpMac(id, dto, user);
    return StdResponse.ok(result, `Amarre IP ${dto.ip} - MAC ${dto.mac} aplicado`);
  }"""
    ctrl = ctrl.replace(old_dhcp, new_amarre)
    with open(ctrl_path, 'w') as f:
        f.write(ctrl)
    print(f'  ✓ mikrotik.controller.ts (amarre-ip-mac endpoint)')
else:
    print(f'  - mikrotik.controller.ts (ya actualizado)')

# ── Sidebar.tsx ───────────────────────────────────────────────────
sidebar_path = f'{FE}/src/components/layout/Sidebar.tsx'
with open(sidebar_path) as f:
    sidebar = f.read()

if 'Gestión de Red' not in sidebar:
    sidebar = sidebar.replace(
        "  Wifi, Activity, Settings, BarChart2,\n  ChevronRight, Router, Zap,",
        "  Wifi, Activity, Settings, BarChart2,\n  ChevronRight, Router, Zap, Shield,"
    )
    sidebar = sidebar.replace(
        "  {\n    grupo: 'Sistema',",
        """  {
    grupo: 'Gestión de Red',
    items: [
      { href: '/red/routers', label: 'Routers',  icon: Router, permiso: 'mikrotik:view'   },
      { href: '/red/vpn',     label: 'OpenVPN',  icon: Shield, permiso: 'mikrotik:manage' },
    ],
  },
  {
    grupo: 'Sistema',"""
    )
    with open(sidebar_path, 'w') as f:
        f.write(sidebar)
    print(f'  ✓ Sidebar.tsx (Gestión de Red agregada)')
else:
    print(f'  - Sidebar.tsx (ya actualizada)')

print('── 3. Escribiendo archivos frontend ──')

w(f'{FE}/src/lib/api/mikrotik.ts', """import api from '@/lib/api';

export interface Router {
  id: string; nombre: string; descripcion?: string; ubicacion?: string;
  modelo?: string; ipGestion: string; vpnIp?: string; puertoApi: number;
  usuario: string; metodoConexion: string; usarSsl: boolean; estado: string;
  ultimoPing?: string; latenciaMs?: number; versionFirmware?: string;
  identityRouteros?: string; cpuUsoPct?: number; memoriaUsoPct?: number;
  tipoControl: 'ninguna' | 'amarre_ip_mac' | 'amarre_ip_mac_dhcp';
  activo: boolean; createdAt: string;
}

export interface CreateRouterDto {
  nombre: string; descripcion?: string; ubicacion?: string; modelo?: string;
  ipGestion: string; vpnIp?: string; puertoApi?: number; usuario: string;
  password: string; metodoConexion?: string; usarSsl?: boolean;
  timeoutConexion?: number; tipoControl?: 'ninguna' | 'amarre_ip_mac' | 'amarre_ip_mac_dhcp';
}

export interface UpdateRouterDto extends Partial<CreateRouterDto> {}

export interface AmareIpMacDto {
  ip: string; mac: string; hostname?: string; clienteId?: string; dhcpServer?: string;
}

export const mikrotikApi = {
  listar: async (): Promise<Router[]> => {
    const { data } = await api.get('/mikrotik/routers');
    return data.data;
  },
  obtener: async (id: string): Promise<Router> => {
    const { data } = await api.get(`/mikrotik/routers/${id}`);
    return data.data;
  },
  crear: async (dto: CreateRouterDto): Promise<Router> => {
    const { data } = await api.post('/mikrotik/routers', dto);
    return data.data;
  },
  actualizar: async (id: string, dto: UpdateRouterDto): Promise<Router> => {
    const { data } = await api.put(`/mikrotik/routers/${id}`, dto);
    return data.data;
  },
  eliminar: async (id: string): Promise<void> => {
    await api.delete(`/mikrotik/routers/${id}`);
  },
  testConexion: async (id: string): Promise<{ exitoso: boolean; mensaje: string; latenciaMs?: number }> => {
    const { data } = await api.post(`/mikrotik/routers/${id}/test`);
    return data.data;
  },
  aplicarAmareIpMac: async (id: string, dto: AmareIpMacDto): Promise<{ arp: boolean; dhcp: boolean }> => {
    const { data } = await api.post(`/mikrotik/routers/${id}/amarre-ip-mac`, dto);
    return data.data;
  },
};
""")

w(f'{FE}/src/lib/api/openvpn.ts', """import api from '@/lib/api';

async function downloadBlob(url: string, filename: string) {
  const response = await api.get(url, { responseType: 'blob' });
  const blob = new Blob([response.data], { type: 'text/plain' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.download = filename; a.click();
  URL.revokeObjectURL(href);
}

export interface OpenvpnConfig {
  id: string; nombre: string; servidorIp: string; puerto: number;
  protocolo: string; dispositivo: string; vpnNetwork: string; vpnNetmask: string;
  caCert?: string; serverCert?: string; serverKey?: string; dhParams?: string; activo: boolean;
}

export interface UpsertOpenvpnDto {
  nombre?: string; servidorIp: string; puerto?: number; protocolo?: string;
  dispositivo?: string; vpnNetwork?: string; vpnNetmask?: string;
  caCert?: string; serverCert?: string; serverKey?: string; dhParams?: string;
}

export const openvpnApi = {
  getConfig: async (): Promise<OpenvpnConfig | null> => {
    const { data } = await api.get('/openvpn/config');
    return data.data;
  },
  upsertConfig: async (dto: UpsertOpenvpnDto): Promise<OpenvpnConfig> => {
    const { data } = await api.post('/openvpn/config', dto);
    return data.data;
  },
  deleteConfig: async (): Promise<void> => { await api.delete('/openvpn/config'); },
  downloadServerConf: () => downloadBlob('/openvpn/config/download/server-conf', 'server.conf'),
  downloadInstrucciones: () => downloadBlob('/openvpn/config/download/instrucciones', 'instalacion-openvpn.sh'),
  downloadClienteOvpn: (routerNombre: string) =>
    downloadBlob(`/openvpn/config/cliente/${encodeURIComponent(routerNombre)}`, `router-${routerNombre}.ovpn`),
};
""")

# ── Páginas ───────────────────────────────────────────────────────
w(f'{FE}/src/app/(dashboard)/red/routers/page.tsx',
  "import type { Metadata } from 'next';\nimport { RoutersContent } from '@/components/red/RoutersContent';\nexport const metadata: Metadata = { title: 'Routers MikroTik' };\nexport default function RoutersPage() { return <RoutersContent />; }\n")

w(f'{FE}/src/app/(dashboard)/red/vpn/page.tsx',
  "import type { Metadata } from 'next';\nimport { VpnContent } from '@/components/red/VpnContent';\nexport const metadata: Metadata = { title: 'OpenVPN' };\nexport default function VpnPage() { return <VpnContent />; }\n")

# RoutersContent.tsx y VpnContent.tsx — embedded inline
import base64 as _b64

w(f'{FE}/src/components/red/RoutersContent.tsx',
  _b64.b64decode(b'J3VzZSBjbGllbnQnOwoKaW1wb3J0IHsgdXNlU3RhdGUgfSAgICAgICAgICAgICAgZnJvbSAncmVhY3QnOwppbXBvcnQgeyB1c2VRdWVyeSwgdXNlTXV0YXRpb24sIHVzZVF1ZXJ5Q2xpZW50IH0gZnJvbSAnQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5JzsKaW1wb3J0IHsKICBSb3V0ZXIsIFBsdXMsIFBlbmNpbCwgVHJhc2gyLCBXaWZpLCBXaWZpT2ZmLAogIFJlZnJlc2hDdywgQ2hlY2tDaXJjbGUyLCBYQ2lyY2xlLCBMb2FkZXIyLCBBbGVydFRyaWFuZ2xlLAogIExvY2ssIFNoaWVsZCwgU2hpZWxkT2ZmLAp9IGZyb20gJ2x1Y2lkZS1yZWFjdCc7CgppbXBvcnQgeyBtaWtyb3Rpa0FwaSB9ICBmcm9tICdAL2xpYi9hcGkvbWlrcm90aWsnOwppbXBvcnQgeyB1c2VUb2FzdCB9ICAgICBmcm9tICdAL2NvbXBvbmVudHMvdWkvdG9hc3Rlcic7CmltcG9ydCB7IHBhcnNlQXBpRXJyb3IsIGNuIH0gZnJvbSAnQC9saWIvdXRpbHMnOwppbXBvcnQgdHlwZSB7IFJvdXRlciBhcyBSb3V0ZXJUeXBlLCBDcmVhdGVSb3V0ZXJEdG8gfSBmcm9tICdAL2xpYi9hcGkvbWlrcm90aWsnOwoKY29uc3QgVElQT19DT05UUk9MX0xBQkVMUyA9IHsKICBuaW5ndW5hOiAgICAgICAgICAgICB7IGxhYmVsOiAnU2luIGNvbnRyb2wnLCAgICAgICAgICAgaWNvbjogU2hpZWxkT2ZmLCAgY29sb3I6ICd0ZXh0LWdyYXktNDAwJyB9LAogIGFtYXJyZV9pcF9tYWM6ICAgICAgIHsgbGFiZWw6ICdBbWFycmUgSVAgKyBNQUMnLCAgICAgICBpY29uOiBTaGllbGQsICAgICBjb2xvcjogJ3RleHQtYmx1ZS00MDAnIH0sCiAgYW1hcnJlX2lwX21hY19kaGNwOiAgeyBsYWJlbDogJ0lQICsgTUFDICsgREhDUCBMZWFzZScsIGljb246IExvY2ssICAgICAgIGNvbG9yOiAndGV4dC12aW9sZXQtNDAwJyB9LAp9OwoKY29uc3QgRVNUQURPX0NPTE9SUyA9IHsKICBvbmxpbmU6ICAgICAgICAndGV4dC1ncmVlbi00MDAnLAogIG9mZmxpbmU6ICAgICAgICd0ZXh0LXJlZC00MDAnLAogIGRlZ3JhZGFkbzogICAgICd0ZXh0LXllbGxvdy00MDAnLAogIG1hbnRlbmltaWVudG86ICd0ZXh0LW9yYW5nZS00MDAnLAogIGRlc2Nvbm9jaWRvOiAgICd0ZXh0LWdyYXktNDAwJywKfTsKCi8vIOKUgOKUgOKUgCBNb2RhbCBkZSBhZ3JlZ2FyIC8gZWRpdGFyIHJvdXRlciDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKaW50ZXJmYWNlIFJvdXRlck1vZGFsUHJvcHMgewogIHJvdXRlcj86IFJvdXRlclR5cGUgfCBudWxsOwogIG9uQ2xvc2U6ICgpID0+IHZvaWQ7CiAgb25TYXZlZDogKCkgPT4gdm9pZDsKfQoKZnVuY3Rpb24gUm91dGVyTW9kYWwoeyByb3V0ZXIsIG9uQ2xvc2UsIG9uU2F2ZWQgfTogUm91dGVyTW9kYWxQcm9wcykgewogIGNvbnN0IHsgdG9hc3QgfSA9IHVzZVRvYXN0KCk7CiAgY29uc3QgW2Zvcm0sIHNldEZvcm1dID0gdXNlU3RhdGU8Q3JlYXRlUm91dGVyRHRvPih7CiAgICBub21icmU6ICAgICAgICByb3V0ZXI/Lm5vbWJyZSAgICAgICAgPz8gJycsCiAgICBkZXNjcmlwY2lvbjogICByb3V0ZXI/LmRlc2NyaXBjaW9uICAgPz8gJycsCiAgICB1YmljYWNpb246ICAgICByb3V0ZXI/LnViaWNhY2lvbiAgICAgPz8gJycsCiAgICBtb2RlbG86ICAgICAgICByb3V0ZXI/Lm1vZGVsbyAgICAgICAgPz8gJycsCiAgICBpcEdlc3Rpb246ICAgICByb3V0ZXI/LmlwR2VzdGlvbiAgICAgPz8gJycsCiAgICB2cG5JcDogICAgICAgICByb3V0ZXI/LnZwbklwICAgICAgICAgPz8gJycsCiAgICBwdWVydG9BcGk6ICAgICByb3V0ZXI/LnB1ZXJ0b0FwaSAgICAgPz8gODcyOCwKICAgIHVzdWFyaW86ICAgICAgIHJvdXRlcj8udXN1YXJpbyAgICAgICA/PyAnYWRtaW4nLAogICAgcGFzc3dvcmQ6ICAgICAgJycsCiAgICBtZXRvZG9Db25leGlvbjogcm91dGVyPy5tZXRvZG9Db25leGlvbiA/PyAnYXBpJywKICAgIHVzYXJTc2w6ICAgICAgIHJvdXRlcj8udXNhclNzbCAgICAgICA/PyBmYWxzZSwKICAgIHRpcG9Db250cm9sOiAgIHJvdXRlcj8udGlwb0NvbnRyb2wgICA/PyAnbmluZ3VuYScsCiAgfSk7CiAgY29uc3QgW2xvYWRpbmcsIHNldExvYWRpbmddID0gdXNlU3RhdGUoZmFsc2UpOwoKICBjb25zdCBoYW5kbGVTYXZlID0gYXN5bmMgKCkgPT4gewogICAgaWYgKCFmb3JtLm5vbWJyZSB8fCAhZm9ybS5pcEdlc3Rpb24gfHwgIWZvcm0udXN1YXJpbykgewogICAgICB0b2FzdCgnTm9tYnJlLCBJUCBkZSBnZXN0acOzbiB5IHVzdWFyaW8gc29uIG9ibGlnYXRvcmlvcycsIHsgdHlwZTogJ2Vycm9yJyB9KTsKICAgICAgcmV0dXJuOwogICAgfQogICAgaWYgKCFyb3V0ZXIgJiYgIWZvcm0ucGFzc3dvcmQpIHsKICAgICAgdG9hc3QoJ0xhIGNvbnRyYXNlw7FhIGVzIG9ibGlnYXRvcmlhIGFsIGNyZWFyIHVuIHJvdXRlcicsIHsgdHlwZTogJ2Vycm9yJyB9KTsKICAgICAgcmV0dXJuOwogICAgfQogICAgc2V0TG9hZGluZyh0cnVlKTsKICAgIHRyeSB7CiAgICAgIGNvbnN0IGR0byA9IHsgLi4uZm9ybSB9OwogICAgICAvLyBTaSBubyBzZSBjYW1iacOzIGxhIGNvbnRyYXNlw7FhIGVuIGVkaWNpw7NuLCBubyBlbnZpYXJsYQogICAgICBpZiAocm91dGVyICYmICFkdG8ucGFzc3dvcmQpIGRlbGV0ZSBkdG8ucGFzc3dvcmQ7CiAgICAgIGlmIChyb3V0ZXIpIHsKICAgICAgICBhd2FpdCBtaWtyb3Rpa0FwaS5hY3R1YWxpemFyKHJvdXRlci5pZCwgZHRvKTsKICAgICAgICB0b2FzdCgnUm91dGVyIGFjdHVhbGl6YWRvJywgeyB0eXBlOiAnc3VjY2VzcycgfSk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgYXdhaXQgbWlrcm90aWtBcGkuY3JlYXIoZHRvKTsKICAgICAgICB0b2FzdCgnUm91dGVyIHJlZ2lzdHJhZG8nLCB7IHR5cGU6ICdzdWNjZXNzJyB9KTsKICAgICAgfQogICAgICBvblNhdmVkKCk7CiAgICAgIG9uQ2xvc2UoKTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICB0b2FzdChwYXJzZUFwaUVycm9yKGVyciksIHsgdHlwZTogJ2Vycm9yJyB9KTsKICAgIH0gZmluYWxseSB7CiAgICAgIHNldExvYWRpbmcoZmFsc2UpOwogICAgfQogIH07CgogIGNvbnN0IHNldCA9IChrZXk6IGtleW9mIENyZWF0ZVJvdXRlckR0bywgdmFsOiBhbnkpID0+CiAgICBzZXRGb3JtKChmKSA9PiAoeyAuLi5mLCBba2V5XTogdmFsIH0pKTsKCiAgcmV0dXJuICgKICAgIDxkaXYgY2xhc3NOYW1lPSJmaXhlZCBpbnNldC0wIHotNTAgZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1jZW50ZXIgYmctYmxhY2svNjAiPgogICAgICA8ZGl2IGNsYXNzTmFtZT0iYmctW2hzbCh2YXIoLS1zaWRlYmFyLWJnKSldIGJvcmRlciBib3JkZXItd2hpdGUvMTAgcm91bmRlZC14bCB3LWZ1bGwgbWF4LXctbGcgbXgtNCBtYXgtaC1bOTB2aF0gb3ZlcmZsb3cteS1hdXRvIj4KICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIHAtNSBib3JkZXItYiBib3JkZXItd2hpdGUvMTAiPgogICAgICAgICAgPGgyIGNsYXNzTmFtZT0iZm9udC1zZW1pYm9sZCB0ZXh0LXdoaXRlIj4KICAgICAgICAgICAge3JvdXRlciA/ICdFZGl0YXIgUm91dGVyJyA6ICdBZ3JlZ2FyIFJvdXRlcid9CiAgICAgICAgICA8L2gyPgogICAgICAgICAgPGJ1dHRvbiBvbkNsaWNrPXtvbkNsb3NlfSBjbGFzc05hbWU9InRleHQtZ3JheS00MDAgaG92ZXI6dGV4dC13aGl0ZSB0cmFuc2l0aW9uLWNvbG9ycyI+CiAgICAgICAgICAgIDxYQ2lyY2xlIGNsYXNzTmFtZT0idy01IGgtNSIgLz4KICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgIDwvZGl2PgoKICAgICAgICA8ZGl2IGNsYXNzTmFtZT0icC01IHNwYWNlLXktNCI+CiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZ3JpZCBncmlkLWNvbHMtMiBnYXAtMyI+CiAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJjb2wtc3Bhbi0yIj4KICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtZ3JheS00MDAgbWItMSBibG9jayI+Tm9tYnJlICo8L2xhYmVsPgogICAgICAgICAgICAgIDxpbnB1dAogICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJ3LWZ1bGwgYmctd2hpdGUvNSBib3JkZXIgYm9yZGVyLXdoaXRlLzEwIHJvdW5kZWQtbGcgcHgtMyBweS0yIHRleHQtc20gdGV4dC13aGl0ZSBmb2N1czpvdXRsaW5lLW5vbmUgZm9jdXM6Ym9yZGVyLXByaW1hcnkvNTAiCiAgICAgICAgICAgICAgICB2YWx1ZT17Zm9ybS5ub21icmV9CiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgnbm9tYnJlJywgZS50YXJnZXQudmFsdWUpfQogICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI9IlJvdXRlciBDYXN0aWxsYSBOb3J0ZSIKICAgICAgICAgICAgICAvPgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgPGRpdj4KICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtZ3JheS00MDAgbWItMSBibG9jayI+SVAgZGUgR2VzdGnDs24gKjwvbGFiZWw+CiAgICAgICAgICAgICAgPGlucHV0CiAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBiZy13aGl0ZS81IGJvcmRlciBib3JkZXItd2hpdGUvMTAgcm91bmRlZC1sZyBweC0zIHB5LTIgdGV4dC1zbSB0ZXh0LXdoaXRlIGZvY3VzOm91dGxpbmUtbm9uZSBmb2N1czpib3JkZXItcHJpbWFyeS81MCIKICAgICAgICAgICAgICAgIHZhbHVlPXtmb3JtLmlwR2VzdGlvbn0KICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc2V0KCdpcEdlc3Rpb24nLCBlLnRhcmdldC52YWx1ZSl9CiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcj0iMTkyLjE2OC4xLjEiCiAgICAgICAgICAgICAgLz4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDxkaXY+CiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNDAwIG1iLTEgYmxvY2siPklQIFZQTiAob3BjaW9uYWwpPC9sYWJlbD4KICAgICAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0idy1mdWxsIGJnLXdoaXRlLzUgYm9yZGVyIGJvcmRlci13aGl0ZS8xMCByb3VuZGVkLWxnIHB4LTMgcHktMiB0ZXh0LXNtIHRleHQtd2hpdGUgZm9jdXM6b3V0bGluZS1ub25lIGZvY3VzOmJvcmRlci1wcmltYXJ5LzUwIgogICAgICAgICAgICAgICAgdmFsdWU9e2Zvcm0udnBuSXAgPz8gJyd9CiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgndnBuSXAnLCBlLnRhcmdldC52YWx1ZSl9CiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcj0iMTAuOC4wLjIiCiAgICAgICAgICAgICAgLz4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDxkaXY+CiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNDAwIG1iLTEgYmxvY2siPlVzdWFyaW8gKjwvbGFiZWw+CiAgICAgICAgICAgICAgPGlucHV0CiAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBiZy13aGl0ZS81IGJvcmRlciBib3JkZXItd2hpdGUvMTAgcm91bmRlZC1sZyBweC0zIHB5LTIgdGV4dC1zbSB0ZXh0LXdoaXRlIGZvY3VzOm91dGxpbmUtbm9uZSBmb2N1czpib3JkZXItcHJpbWFyeS81MCIKICAgICAgICAgICAgICAgIHZhbHVlPXtmb3JtLnVzdWFyaW99CiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgndXN1YXJpbycsIGUudGFyZ2V0LnZhbHVlKX0KICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyPSJhZG1pbiIKICAgICAgICAgICAgICAvPgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgPGRpdj4KICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtZ3JheS00MDAgbWItMSBibG9jayI+CiAgICAgICAgICAgICAgICBDb250cmFzZcOxYSB7cm91dGVyID8gJyhkZWphciB2YWPDrW8gPSBubyBjYW1iaWFyKScgOiAnKid9CiAgICAgICAgICAgICAgPC9sYWJlbD4KICAgICAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgICAgIHR5cGU9InBhc3N3b3JkIgogICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJ3LWZ1bGwgYmctd2hpdGUvNSBib3JkZXIgYm9yZGVyLXdoaXRlLzEwIHJvdW5kZWQtbGcgcHgtMyBweS0yIHRleHQtc20gdGV4dC13aGl0ZSBmb2N1czpvdXRsaW5lLW5vbmUgZm9jdXM6Ym9yZGVyLXByaW1hcnkvNTAiCiAgICAgICAgICAgICAgICB2YWx1ZT17Zm9ybS5wYXNzd29yZH0KICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc2V0KCdwYXNzd29yZCcsIGUudGFyZ2V0LnZhbHVlKX0KICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyPSLigKLigKLigKLigKLigKLigKLigKLigKIiCiAgICAgICAgICAgICAgLz4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDxkaXY+CiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNDAwIG1iLTEgYmxvY2siPlB1ZXJ0byBBUEk8L2xhYmVsPgogICAgICAgICAgICAgIDxpbnB1dAogICAgICAgICAgICAgICAgdHlwZT0ibnVtYmVyIgogICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJ3LWZ1bGwgYmctd2hpdGUvNSBib3JkZXIgYm9yZGVyLXdoaXRlLzEwIHJvdW5kZWQtbGcgcHgtMyBweS0yIHRleHQtc20gdGV4dC13aGl0ZSBmb2N1czpvdXRsaW5lLW5vbmUgZm9jdXM6Ym9yZGVyLXByaW1hcnkvNTAiCiAgICAgICAgICAgICAgICB2YWx1ZT17Zm9ybS5wdWVydG9BcGl9CiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgncHVlcnRvQXBpJywgcGFyc2VJbnQoZS50YXJnZXQudmFsdWUpKX0KICAgICAgICAgICAgICAvPgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgPGRpdj4KICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtZ3JheS00MDAgbWItMSBibG9jayI+TW9kZWxvPC9sYWJlbD4KICAgICAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0idy1mdWxsIGJnLXdoaXRlLzUgYm9yZGVyIGJvcmRlci13aGl0ZS8xMCByb3VuZGVkLWxnIHB4LTMgcHktMiB0ZXh0LXNtIHRleHQtd2hpdGUgZm9jdXM6b3V0bGluZS1ub25lIGZvY3VzOmJvcmRlci1wcmltYXJ5LzUwIgogICAgICAgICAgICAgICAgdmFsdWU9e2Zvcm0ubW9kZWxvID8/ICcnfQogICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXQoJ21vZGVsbycsIGUudGFyZ2V0LnZhbHVlKX0KICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyPSJDQ1IxMDM2LTEyRy00UyIKICAgICAgICAgICAgICAvPgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgPGRpdj4KICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtZ3JheS00MDAgbWItMSBibG9jayI+VWJpY2FjacOzbjwvbGFiZWw+CiAgICAgICAgICAgICAgPGlucHV0CiAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBiZy13aGl0ZS81IGJvcmRlciBib3JkZXItd2hpdGUvMTAgcm91bmRlZC1sZyBweC0zIHB5LTIgdGV4dC1zbSB0ZXh0LXdoaXRlIGZvY3VzOm91dGxpbmUtbm9uZSBmb2N1czpib3JkZXItcHJpbWFyeS81MCIKICAgICAgICAgICAgICAgIHZhbHVlPXtmb3JtLnViaWNhY2lvbiA/PyAnJ30KICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc2V0KCd1YmljYWNpb24nLCBlLnRhcmdldC52YWx1ZSl9CiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcj0iQXYuIFPDoW5jaGV6IENlcnJvIDEyMzQiCiAgICAgICAgICAgICAgLz4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICA8L2Rpdj4KCiAgICAgICAgICB7LyogQ29udHJvbCBkZSBTZWd1cmlkYWQgKi99CiAgICAgICAgICA8ZGl2PgogICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtZ3JheS00MDAgbWItMiBibG9jayI+VGlwbyBkZSBDb250cm9sIGRlIFNlZ3VyaWRhZDwvbGFiZWw+CiAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJzcGFjZS15LTIiPgogICAgICAgICAgICAgIHsoT2JqZWN0LmVudHJpZXMoVElQT19DT05UUk9MX0xBQkVMUykgYXMgQXJyYXk8W3N0cmluZywgdHlwZW9mIFRJUE9fQ09OVFJPTF9MQUJFTFNbJ25pbmd1bmEnXV0+KS5tYXAoKFt2YWwsIGNmZ10pID0+IHsKICAgICAgICAgICAgICAgIGNvbnN0IEljb24gPSBjZmcuaWNvbjsKICAgICAgICAgICAgICAgIHJldHVybiAoCiAgICAgICAgICAgICAgICAgIDxsYWJlbAogICAgICAgICAgICAgICAgICAgIGtleT17dmFsfQogICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT17Y24oCiAgICAgICAgICAgICAgICAgICAgICAnZmxleCBpdGVtcy1zdGFydCBnYXAtMyBwLTMgcm91bmRlZC1sZyBib3JkZXIgY3Vyc29yLXBvaW50ZXIgdHJhbnNpdGlvbi1jb2xvcnMnLAogICAgICAgICAgICAgICAgICAgICAgZm9ybS50aXBvQ29udHJvbCA9PT0gdmFsCiAgICAgICAgICAgICAgICAgICAgICAgID8gJ2JvcmRlci1wcmltYXJ5LzUwIGJnLXByaW1hcnkvMTAnCiAgICAgICAgICAgICAgICAgICAgICAgIDogJ2JvcmRlci13aGl0ZS8xMCBob3Zlcjpib3JkZXItd2hpdGUvMjAnLAogICAgICAgICAgICAgICAgICAgICl9CiAgICAgICAgICAgICAgICAgID4KICAgICAgICAgICAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgICAgICAgICAgIHR5cGU9InJhZGlvIgogICAgICAgICAgICAgICAgICAgICAgbmFtZT0idGlwb0NvbnRyb2wiCiAgICAgICAgICAgICAgICAgICAgICB2YWx1ZT17dmFsfQogICAgICAgICAgICAgICAgICAgICAgY2hlY2tlZD17Zm9ybS50aXBvQ29udHJvbCA9PT0gdmFsfQogICAgICAgICAgICAgICAgICAgICAgb25DaGFuZ2U9eygpID0+IHNldCgndGlwb0NvbnRyb2wnLCB2YWwpfQogICAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJtdC0wLjUiCiAgICAgICAgICAgICAgICAgICAgLz4KICAgICAgICAgICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9e2NuKCd0ZXh0LXNtIGZvbnQtbWVkaXVtIGZsZXggaXRlbXMtY2VudGVyIGdhcC0xLjUnLCBjZmcuY29sb3IpfT4KICAgICAgICAgICAgICAgICAgICAgICAgPEljb24gY2xhc3NOYW1lPSJ3LTMuNSBoLTMuNSIgLz4KICAgICAgICAgICAgICAgICAgICAgICAge2NmZy5sYWJlbH0KICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9InRleHQteHMgdGV4dC1ncmF5LTQwMCBtdC0wLjUiPgogICAgICAgICAgICAgICAgICAgICAgICB7dmFsID09PSAnbmluZ3VuYScgJiYgJ05vIGFwbGljYSBjb250cm9sZXMgZGUgc2VndXJpZGFkIElQLU1BQyd9CiAgICAgICAgICAgICAgICAgICAgICAgIHt2YWwgPT09ICdhbWFycmVfaXBfbWFjJyAmJiAnQWdyZWdhIGVudHJhZGEgZXN0w6F0aWNhIGVuIElQID4gQVJQIGFsIHByb3Zpc2lvbmFyIGNsaWVudGVzJ30KICAgICAgICAgICAgICAgICAgICAgICAge3ZhbCA9PT0gJ2FtYXJyZV9pcF9tYWNfZGhjcCcgJiYgJ0FncmVnYSBBUlAgZXN0w6F0aWNvICsgbGVhc2UgZXN0w6F0aWNvIGVuIElQID4gREhDUCBTZXJ2ZXIgPiBMZWFzZXMnfQogICAgICAgICAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgICAgIDwvbGFiZWw+CiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICAgIH0pfQogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiI+CiAgICAgICAgICAgIDxpbnB1dAogICAgICAgICAgICAgIHR5cGU9ImNoZWNrYm94IgogICAgICAgICAgICAgIGlkPSJ1c2FyU3NsIgogICAgICAgICAgICAgIGNoZWNrZWQ9e2Zvcm0udXNhclNzbH0KICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgndXNhclNzbCcsIGUudGFyZ2V0LmNoZWNrZWQpfQogICAgICAgICAgICAgIGNsYXNzTmFtZT0icm91bmRlZCIKICAgICAgICAgICAgLz4KICAgICAgICAgICAgPGxhYmVsIGh0bWxGb3I9InVzYXJTc2wiIGNsYXNzTmFtZT0idGV4dC1zbSB0ZXh0LWdyYXktMzAwIj5Vc2FyIFNTTCAocHVlcnRvIDg3MjkpPC9sYWJlbD4KICAgICAgICAgIDwvZGl2PgogICAgICAgIDwvZGl2PgoKICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZmxleCBqdXN0aWZ5LWVuZCBnYXAtMyBweC01IHBiLTUiPgogICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICBvbkNsaWNrPXtvbkNsb3NlfQogICAgICAgICAgICBjbGFzc05hbWU9InB4LTQgcHktMiB0ZXh0LXNtIHRleHQtZ3JheS00MDAgaG92ZXI6dGV4dC13aGl0ZSB0cmFuc2l0aW9uLWNvbG9ycyIKICAgICAgICAgID4KICAgICAgICAgICAgQ2FuY2VsYXIKICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICBvbkNsaWNrPXtoYW5kbGVTYXZlfQogICAgICAgICAgICBkaXNhYmxlZD17bG9hZGluZ30KICAgICAgICAgICAgY2xhc3NOYW1lPSJweC01IHB5LTIgdGV4dC1zbSBmb250LW1lZGl1bSBiZy1wcmltYXJ5IHRleHQtd2hpdGUgcm91bmRlZC1sZyBob3ZlcjpiZy1wcmltYXJ5LzgwIGRpc2FibGVkOm9wYWNpdHktNTAgZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTIiCiAgICAgICAgICA+CiAgICAgICAgICAgIHtsb2FkaW5nICYmIDxMb2FkZXIyIGNsYXNzTmFtZT0idy00IGgtNCBhbmltYXRlLXNwaW4iIC8+fQogICAgICAgICAgICB7cm91dGVyID8gJ0d1YXJkYXIgY2FtYmlvcycgOiAnQWdyZWdhciByb3V0ZXInfQogICAgICAgICAgPC9idXR0b24+CiAgICAgICAgPC9kaXY+CiAgICAgIDwvZGl2PgogICAgPC9kaXY+CiAgKTsKfQoKLy8g4pSA4pSA4pSAIENvbXBvbmVudGUgcHJpbmNpcGFsIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgApleHBvcnQgZnVuY3Rpb24gUm91dGVyc0NvbnRlbnQoKSB7CiAgY29uc3QgeyB0b2FzdCB9ICAgICAgPSB1c2VUb2FzdCgpOwogIGNvbnN0IHF1ZXJ5Q2xpZW50ICAgID0gdXNlUXVlcnlDbGllbnQoKTsKICBjb25zdCBbc2hvd01vZGFsLCBzZXRTaG93TW9kYWxdICAgICA9IHVzZVN0YXRlKGZhbHNlKTsKICBjb25zdCBbZWRpdFJvdXRlciwgc2V0RWRpdFJvdXRlcl0gICA9IHVzZVN0YXRlPFJvdXRlclR5cGUgfCBudWxsPihudWxsKTsKICBjb25zdCBbdGVzdGluZ0lkLCBzZXRUZXN0aW5nSWRdICAgICA9IHVzZVN0YXRlPHN0cmluZyB8IG51bGw+KG51bGwpOwoKICBjb25zdCB7IGRhdGE6IHJvdXRlcnMgPSBbXSwgaXNMb2FkaW5nIH0gPSB1c2VRdWVyeTxSb3V0ZXJUeXBlW10+KHsKICAgIHF1ZXJ5S2V5OiAgICAgICAgWydyb3V0ZXJzJ10sCiAgICBxdWVyeUZuOiAgICAgICAgIG1pa3JvdGlrQXBpLmxpc3RhciwKICAgIHJlZmV0Y2hJbnRlcnZhbDogNjBfMDAwLAogIH0pOwoKICBjb25zdCBkZWxldGVNdXQgPSB1c2VNdXRhdGlvbih7CiAgICBtdXRhdGlvbkZuOiAoaWQ6IHN0cmluZykgPT4gbWlrcm90aWtBcGkuZWxpbWluYXIoaWQpLAogICAgb25TdWNjZXNzOiAoKSA9PiB7CiAgICAgIHF1ZXJ5Q2xpZW50LmludmFsaWRhdGVRdWVyaWVzKHsgcXVlcnlLZXk6IFsncm91dGVycyddIH0pOwogICAgICB0b2FzdCgnUm91dGVyIGVsaW1pbmFkbycsIHsgdHlwZTogJ3N1Y2Nlc3MnIH0pOwogICAgfSwKICAgIG9uRXJyb3I6IChlcnIpID0+IHRvYXN0KHBhcnNlQXBpRXJyb3IoZXJyKSwgeyB0eXBlOiAnZXJyb3InIH0pLAogIH0pOwoKICBjb25zdCB0ZXN0Q29uZXhpb24gPSBhc3luYyAocm91dGVyOiBSb3V0ZXJUeXBlKSA9PiB7CiAgICBzZXRUZXN0aW5nSWQocm91dGVyLmlkKTsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG1pa3JvdGlrQXBpLnRlc3RDb25leGlvbihyb3V0ZXIuaWQpOwogICAgICBpZiAocmVzdWx0LmV4aXRvc28pIHsKICAgICAgICB0b2FzdChgQ29uZWN0YWRvIGVuICR7cmVzdWx0LmxhdGVuY2lhTXN9bXMg4oCUICR7cmVzdWx0Lm1lbnNhamV9YCwgeyB0eXBlOiAnc3VjY2VzcycgfSk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgdG9hc3QocmVzdWx0Lm1lbnNhamUsIHsgdHlwZTogJ2Vycm9yJyB9KTsKICAgICAgfQogICAgICBxdWVyeUNsaWVudC5pbnZhbGlkYXRlUXVlcmllcyh7IHF1ZXJ5S2V5OiBbJ3JvdXRlcnMnXSB9KTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICB0b2FzdChwYXJzZUFwaUVycm9yKGVyciksIHsgdHlwZTogJ2Vycm9yJyB9KTsKICAgIH0gZmluYWxseSB7CiAgICAgIHNldFRlc3RpbmdJZChudWxsKTsKICAgIH0KICB9OwoKICBjb25zdCBoYW5kbGVEZWxldGUgPSAocm91dGVyOiBSb3V0ZXJUeXBlKSA9PiB7CiAgICBpZiAoIWNvbmZpcm0oYMK/RWxpbWluYXIgZWwgcm91dGVyICIke3JvdXRlci5ub21icmV9Ij9gKSkgcmV0dXJuOwogICAgZGVsZXRlTXV0Lm11dGF0ZShyb3V0ZXIuaWQpOwogIH07CgogIGNvbnN0IG9uU2F2ZWQgPSAoKSA9PiBxdWVyeUNsaWVudC5pbnZhbGlkYXRlUXVlcmllcyh7IHF1ZXJ5S2V5OiBbJ3JvdXRlcnMnXSB9KTsKCiAgcmV0dXJuICgKICAgIDxkaXYgY2xhc3NOYW1lPSJwLTYgc3BhY2UteS02Ij4KICAgICAgey8qIEhlYWRlciAqL30KICAgICAgPGRpdiBjbGFzc05hbWU9ImZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlbiI+CiAgICAgICAgPGRpdj4KICAgICAgICAgIDxoMSBjbGFzc05hbWU9InRleHQteGwgZm9udC1ib2xkIHRleHQtd2hpdGUgZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTIiPgogICAgICAgICAgICA8Um91dGVyIGNsYXNzTmFtZT0idy01IGgtNSB0ZXh0LXByaW1hcnkiIC8+CiAgICAgICAgICAgIFJvdXRlcnMgTWlrcm9UaWsKICAgICAgICAgIDwvaDE+CiAgICAgICAgICA8cCBjbGFzc05hbWU9InRleHQtc20gdGV4dC1ncmF5LTQwMCBtdC0xIj4KICAgICAgICAgICAge3JvdXRlcnMubGVuZ3RofSByb3V0ZXJ7cm91dGVycy5sZW5ndGggIT09IDEgPyAncycgOiAnJ30gcmVnaXN0cmFkb3tyb3V0ZXJzLmxlbmd0aCAhPT0gMSA/ICdzJyA6ICcnfQogICAgICAgICAgPC9wPgogICAgICAgIDwvZGl2PgogICAgICAgIDxidXR0b24KICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHsgc2V0RWRpdFJvdXRlcihudWxsKTsgc2V0U2hvd01vZGFsKHRydWUpOyB9fQogICAgICAgICAgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiBweC00IHB5LTIgdGV4dC1zbSBmb250LW1lZGl1bSBiZy1wcmltYXJ5IHRleHQtd2hpdGUgcm91bmRlZC1sZyBob3ZlcjpiZy1wcmltYXJ5LzgwIHRyYW5zaXRpb24tY29sb3JzIgogICAgICAgID4KICAgICAgICAgIDxQbHVzIGNsYXNzTmFtZT0idy00IGgtNCIgLz4KICAgICAgICAgIEFncmVnYXIgcm91dGVyCiAgICAgICAgPC9idXR0b24+CiAgICAgIDwvZGl2PgoKICAgICAgey8qIFRhYmxlICovfQogICAgICB7aXNMb2FkaW5nID8gKAogICAgICAgIDxkaXYgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBqdXN0aWZ5LWNlbnRlciBoLTQ4Ij4KICAgICAgICAgIDxMb2FkZXIyIGNsYXNzTmFtZT0idy04IGgtOCBhbmltYXRlLXNwaW4gdGV4dC1wcmltYXJ5IiAvPgogICAgICAgIDwvZGl2PgogICAgICApIDogcm91dGVycy5sZW5ndGggPT09IDAgPyAoCiAgICAgICAgPGRpdiBjbGFzc05hbWU9ImZsZXggZmxleC1jb2wgaXRlbXMtY2VudGVyIGp1c3RpZnktY2VudGVyIGgtNDggdGV4dC1ncmF5LTQwMCI+CiAgICAgICAgICA8Um91dGVyIGNsYXNzTmFtZT0idy0xMiBoLTEyIG1iLTMgb3BhY2l0eS0zMCIgLz4KICAgICAgICAgIDxwPk5vIGhheSByb3V0ZXJzIHJlZ2lzdHJhZG9zPC9wPgogICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiB7IHNldEVkaXRSb3V0ZXIobnVsbCk7IHNldFNob3dNb2RhbCh0cnVlKTsgfX0KICAgICAgICAgICAgY2xhc3NOYW1lPSJtdC0zIHRleHQtcHJpbWFyeSB0ZXh0LXNtIGhvdmVyOnVuZGVybGluZSIKICAgICAgICAgID4KICAgICAgICAgICAgQWdyZWdhciBlbCBwcmltZXIgcm91dGVyCiAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICA8L2Rpdj4KICAgICAgKSA6ICgKICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ib3ZlcmZsb3cteC1hdXRvIHJvdW5kZWQteGwgYm9yZGVyIGJvcmRlci13aGl0ZS8xMCI+CiAgICAgICAgICA8dGFibGUgY2xhc3NOYW1lPSJ3LWZ1bGwgdGV4dC1zbSI+CiAgICAgICAgICAgIDx0aGVhZD4KICAgICAgICAgICAgICA8dHIgY2xhc3NOYW1lPSJib3JkZXItYiBib3JkZXItd2hpdGUvMTAgdGV4dC14cyB0ZXh0LWdyYXktNDAwIHVwcGVyY2FzZSB0cmFja2luZy13aWRlciI+CiAgICAgICAgICAgICAgICA8dGggY2xhc3NOYW1lPSJ0ZXh0LWxlZnQgcHgtNCBweS0zIj5Sb3V0ZXI8L3RoPgogICAgICAgICAgICAgICAgPHRoIGNsYXNzTmFtZT0idGV4dC1sZWZ0IHB4LTQgcHktMyI+SVAgR2VzdGnDs248L3RoPgogICAgICAgICAgICAgICAgPHRoIGNsYXNzTmFtZT0idGV4dC1sZWZ0IHB4LTQgcHktMyI+SVAgVlBOPC90aD4KICAgICAgICAgICAgICAgIDx0aCBjbGFzc05hbWU9InRleHQtbGVmdCBweC00IHB5LTMiPkNvbnRyb2w8L3RoPgogICAgICAgICAgICAgICAgPHRoIGNsYXNzTmFtZT0idGV4dC1sZWZ0IHB4LTQgcHktMyI+RXN0YWRvPC90aD4KICAgICAgICAgICAgICAgIDx0aCBjbGFzc05hbWU9InRleHQtbGVmdCBweC00IHB5LTMiPkxhdGVuY2lhPC90aD4KICAgICAgICAgICAgICAgIDx0aCBjbGFzc05hbWU9InRleHQtcmlnaHQgcHgtNCBweS0zIj5BY2Npb25lczwvdGg+CiAgICAgICAgICAgICAgPC90cj4KICAgICAgICAgICAgPC90aGVhZD4KICAgICAgICAgICAgPHRib2R5PgogICAgICAgICAgICAgIHtyb3V0ZXJzLm1hcCgocikgPT4gewogICAgICAgICAgICAgICAgY29uc3QgZXN0YWRvQ29sb3IgPSBFU1RBRE9fQ09MT1JTW3IuZXN0YWRvIGFzIGtleW9mIHR5cGVvZiBFU1RBRE9fQ09MT1JTXSA/PyAndGV4dC1ncmF5LTQwMCc7CiAgICAgICAgICAgICAgICBjb25zdCBjdHJsICAgICAgICA9IFRJUE9fQ09OVFJPTF9MQUJFTFNbci50aXBvQ29udHJvbF07CiAgICAgICAgICAgICAgICBjb25zdCBDdHJsSWNvbiAgICA9IGN0cmw/Lmljb24gPz8gU2hpZWxkT2ZmOwogICAgICAgICAgICAgICAgY29uc3QgaXNUZXN0aW5nICAgPSB0ZXN0aW5nSWQgPT09IHIuaWQ7CgogICAgICAgICAgICAgICAgcmV0dXJuICgKICAgICAgICAgICAgICAgICAgPHRyIGtleT17ci5pZH0gY2xhc3NOYW1lPSJib3JkZXItYiBib3JkZXItd2hpdGUvNSBob3ZlcjpiZy13aGl0ZS8zIHRyYW5zaXRpb24tY29sb3JzIj4KICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3NOYW1lPSJweC00IHB5LTMiPgogICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImZvbnQtbWVkaXVtIHRleHQtd2hpdGUiPntyLm5vbWJyZX08L2Rpdj4KICAgICAgICAgICAgICAgICAgICAgIHtyLm1vZGVsbyAmJiA8ZGl2IGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNDAwIj57ci5tb2RlbG99PC9kaXY+fQogICAgICAgICAgICAgICAgICAgICAge3IuaWRlbnRpdHlSb3V0ZXJvcyAmJiA8ZGl2IGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNTAwIj57ci5pZGVudGl0eVJvdXRlcm9zfTwvZGl2Pn0KICAgICAgICAgICAgICAgICAgICA8L3RkPgogICAgICAgICAgICAgICAgICAgIDx0ZCBjbGFzc05hbWU9InB4LTQgcHktMyBmb250LW1vbm8gdGV4dC1ncmF5LTMwMCI+e3IuaXBHZXN0aW9ufTwvdGQ+CiAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzTmFtZT0icHgtNCBweS0zIGZvbnQtbW9ubyI+CiAgICAgICAgICAgICAgICAgICAgICB7ci52cG5JcCA/ICgKICAgICAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJ0ZXh0LWJsdWUtNDAwIj57ci52cG5JcH08L3NwYW4+CiAgICAgICAgICAgICAgICAgICAgICApIDogKAogICAgICAgICAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9InRleHQtZ3JheS02MDAiPuKAlDwvc3Bhbj4KICAgICAgICAgICAgICAgICAgICAgICl9CiAgICAgICAgICAgICAgICAgICAgPC90ZD4KICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3NOYW1lPSJweC00IHB5LTMiPgogICAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPXtjbignZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTEgdGV4dC14cycsIGN0cmw/LmNvbG9yID8/ICd0ZXh0LWdyYXktNDAwJyl9PgogICAgICAgICAgICAgICAgICAgICAgICA8Q3RybEljb24gY2xhc3NOYW1lPSJ3LTMuNSBoLTMuNSIgLz4KICAgICAgICAgICAgICAgICAgICAgICAge2N0cmw/LmxhYmVsID8/IHIudGlwb0NvbnRyb2x9CiAgICAgICAgICAgICAgICAgICAgICA8L3NwYW4+CiAgICAgICAgICAgICAgICAgICAgPC90ZD4KICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3NOYW1lPSJweC00IHB5LTMiPgogICAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPXtjbignZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTEuNSBjYXBpdGFsaXplJywgZXN0YWRvQ29sb3IpfT4KICAgICAgICAgICAgICAgICAgICAgICAge3IuZXN0YWRvID09PSAnb25saW5lJyA/ICgKICAgICAgICAgICAgICAgICAgICAgICAgICA8V2lmaSBjbGFzc05hbWU9InctMy41IGgtMy41IiAvPgogICAgICAgICAgICAgICAgICAgICAgICApIDogKAogICAgICAgICAgICAgICAgICAgICAgICAgIDxXaWZpT2ZmIGNsYXNzTmFtZT0idy0zLjUgaC0zLjUiIC8+CiAgICAgICAgICAgICAgICAgICAgICAgICl9CiAgICAgICAgICAgICAgICAgICAgICAgIHtyLmVzdGFkb30KICAgICAgICAgICAgICAgICAgICAgIDwvc3Bhbj4KICAgICAgICAgICAgICAgICAgICA8L3RkPgogICAgICAgICAgICAgICAgICAgIDx0ZCBjbGFzc05hbWU9InB4LTQgcHktMyB0ZXh0LWdyYXktNDAwIj4KICAgICAgICAgICAgICAgICAgICAgIHtyLmxhdGVuY2lhTXMgIT0gbnVsbCA/IGAke3IubGF0ZW5jaWFNc31tc2AgOiAn4oCUJ30KICAgICAgICAgICAgICAgICAgICA8L3RkPgogICAgICAgICAgICAgICAgICAgIDx0ZCBjbGFzc05hbWU9InB4LTQgcHktMyI+CiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1lbmQgZ2FwLTEiPgogICAgICAgICAgICAgICAgICAgICAgICB7LyogVGVzdCBjb25leGnDs24gKi99CiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiB0ZXN0Q29uZXhpb24ocil9CiAgICAgICAgICAgICAgICAgICAgICAgICAgZGlzYWJsZWQ9e2lzVGVzdGluZ30KICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZT0iUHJvYmFyIGNvbmV4acOzbiIKICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InAtMS41IHJvdW5kZWQtbGcgaG92ZXI6Ymctd2hpdGUvMTAgdGV4dC1ncmF5LTQwMCBob3Zlcjp0ZXh0LWdyZWVuLTQwMCB0cmFuc2l0aW9uLWNvbG9ycyBkaXNhYmxlZDpvcGFjaXR5LTUwIgogICAgICAgICAgICAgICAgICAgICAgICA+CiAgICAgICAgICAgICAgICAgICAgICAgICAge2lzVGVzdGluZyA/ICgKICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxMb2FkZXIyIGNsYXNzTmFtZT0idy00IGgtNCBhbmltYXRlLXNwaW4iIC8+CiAgICAgICAgICAgICAgICAgICAgICAgICAgKSA6ICgKICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxSZWZyZXNoQ3cgY2xhc3NOYW1lPSJ3LTQgaC00IiAvPgogICAgICAgICAgICAgICAgICAgICAgICAgICl9CiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgICAgICAgICAgICAgICB7LyogRWRpdGFyICovfQogICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uCiAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4geyBzZXRFZGl0Um91dGVyKHIpOyBzZXRTaG93TW9kYWwodHJ1ZSk7IH19CiAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU9IkVkaXRhciIKICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InAtMS41IHJvdW5kZWQtbGcgaG92ZXI6Ymctd2hpdGUvMTAgdGV4dC1ncmF5LTQwMCBob3Zlcjp0ZXh0LWJsdWUtNDAwIHRyYW5zaXRpb24tY29sb3JzIgogICAgICAgICAgICAgICAgICAgICAgICA+CiAgICAgICAgICAgICAgICAgICAgICAgICAgPFBlbmNpbCBjbGFzc05hbWU9InctNCBoLTQiIC8+CiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgICAgICAgICAgICAgICB7LyogRWxpbWluYXIgKi99CiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiBoYW5kbGVEZWxldGUocil9CiAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU9IkVsaW1pbmFyIgogICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0icC0xLjUgcm91bmRlZC1sZyBob3ZlcjpiZy13aGl0ZS8xMCB0ZXh0LWdyYXktNDAwIGhvdmVyOnRleHQtcmVkLTQwMCB0cmFuc2l0aW9uLWNvbG9ycyIKICAgICAgICAgICAgICAgICAgICAgICAgPgogICAgICAgICAgICAgICAgICAgICAgICAgIDxUcmFzaDIgY2xhc3NOYW1lPSJ3LTQgaC00IiAvPgogICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICAgICAgIDwvdGQ+CiAgICAgICAgICAgICAgICAgIDwvdHI+CiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICAgIH0pfQogICAgICAgICAgICA8L3Rib2R5PgogICAgICAgICAgPC90YWJsZT4KICAgICAgICA8L2Rpdj4KICAgICAgKX0KCiAgICAgIHsvKiBJbmZvIHNvYnJlIGNvbnRyb2xlcyBkZSBzZWd1cmlkYWQgKi99CiAgICAgIDxkaXYgY2xhc3NOYW1lPSJiZy1ibHVlLTUwMC8xMCBib3JkZXIgYm9yZGVyLWJsdWUtNTAwLzIwIHJvdW5kZWQteGwgcC00IHRleHQtc20gdGV4dC1ibHVlLTMwMCI+CiAgICAgICAgPGRpdiBjbGFzc05hbWU9ImZsZXggaXRlbXMtc3RhcnQgZ2FwLTIiPgogICAgICAgICAgPEFsZXJ0VHJpYW5nbGUgY2xhc3NOYW1lPSJ3LTQgaC00IG10LTAuNSBmbGV4LXNocmluay0wIiAvPgogICAgICAgICAgPGRpdj4KICAgICAgICAgICAgPHAgY2xhc3NOYW1lPSJmb250LW1lZGl1bSBtYi0xIj5Db250cm9sIGRlIHNlZ3VyaWRhZCBJUCtNQUM8L3A+CiAgICAgICAgICAgIDxwIGNsYXNzTmFtZT0idGV4dC1ibHVlLTMwMC83MCB0ZXh0LXhzIj4KICAgICAgICAgICAgICBBbCBwcm92aXNpb25hciB1biBjbGllbnRlIGVuIHVuIHJvdXRlciBjb24gY29udHJvbCBkZSBhbWFycmUgSVArTUFDLCBlbCBzaXN0ZW1hCiAgICAgICAgICAgICAgYXV0b23DoXRpY2FtZW50ZSBhZ3JlZ2EgbGEgZW50cmFkYSBlbiA8c3Ryb25nPklQICZndDsgQVJQPC9zdHJvbmc+IGRlbCBNaWtyb1Rpay4KICAgICAgICAgICAgICBDb24gIklQK01BQytESENQIExlYXNlIiB0YW1iacOpbiByZWdpc3RyYSBlbCBlcXVpcG8gZW4gPHN0cm9uZz5JUCAmZ3Q7IERIQ1AgU2VydmVyICZndDsgTGVhc2VzPC9zdHJvbmc+LgogICAgICAgICAgICA8L3A+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+CgogICAgICB7c2hvd01vZGFsICYmICgKICAgICAgICA8Um91dGVyTW9kYWwKICAgICAgICAgIHJvdXRlcj17ZWRpdFJvdXRlcn0KICAgICAgICAgIG9uQ2xvc2U9eygpID0+IHNldFNob3dNb2RhbChmYWxzZSl9CiAgICAgICAgICBvblNhdmVkPXtvblNhdmVkfQogICAgICAgIC8+CiAgICAgICl9CiAgICA8L2Rpdj4KICApOwp9Cg==').decode('utf-8'))

w(f'{FE}/src/components/red/VpnContent.tsx',
  _b64.b64decode(b'J3VzZSBjbGllbnQnOwoKaW1wb3J0IHsgdXNlU3RhdGUgfSAgICAgICAgICAgICAgZnJvbSAncmVhY3QnOwppbXBvcnQgeyB1c2VRdWVyeSwgdXNlTXV0YXRpb24sIHVzZVF1ZXJ5Q2xpZW50IH0gZnJvbSAnQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5JzsKaW1wb3J0IHsKICBTaGllbGQsIERvd25sb2FkLCBTYXZlLCBMb2FkZXIyLCBJbmZvLAogIENoZWNrQ2lyY2xlMiwgWENpcmNsZSwgU2VydmVyLCBSb3V0ZXIsCiAgUmVmcmVzaEN3LCBDaGV2cm9uRG93biwgQ2hldnJvblVwLAp9IGZyb20gJ2x1Y2lkZS1yZWFjdCc7CgppbXBvcnQgeyBvcGVudnBuQXBpIH0gICBmcm9tICdAL2xpYi9hcGkvb3BlbnZwbic7CmltcG9ydCB7IG1pa3JvdGlrQXBpIH0gIGZyb20gJ0AvbGliL2FwaS9taWtyb3Rpayc7CmltcG9ydCB7IHVzZVRvYXN0IH0gICAgIGZyb20gJ0AvY29tcG9uZW50cy91aS90b2FzdGVyJzsKaW1wb3J0IHsgcGFyc2VBcGlFcnJvciwgY24gfSBmcm9tICdAL2xpYi91dGlscyc7CmltcG9ydCB0eXBlIHsgVXBzZXJ0T3BlbnZwbkR0byB9IGZyb20gJ0AvbGliL2FwaS9vcGVudnBuJzsKCmNvbnN0IERFRkFVTFRTOiBVcHNlcnRPcGVudnBuRHRvID0gewogIG5vbWJyZTogICAgICAnU2Vydmlkb3IgVlBOJywKICBzZXJ2aWRvcklwOiAgJycsCiAgcHVlcnRvOiAgICAgIDExOTQsCiAgcHJvdG9jb2xvOiAgICd1ZHAnLAogIGRpc3Bvc2l0aXZvOiAndHVuJywKICB2cG5OZXR3b3JrOiAgJzEwLjguMC4wJywKICB2cG5OZXRtYXNrOiAgJzI1NS4yNTUuMjU1LjAnLAp9OwoKZXhwb3J0IGZ1bmN0aW9uIFZwbkNvbnRlbnQoKSB7CiAgY29uc3QgeyB0b2FzdCB9ICAgPSB1c2VUb2FzdCgpOwogIGNvbnN0IHF1ZXJ5Q2xpZW50ID0gdXNlUXVlcnlDbGllbnQoKTsKICBjb25zdCBbc2hvd0NlcnRzLCBzZXRTaG93Q2VydHNdID0gdXNlU3RhdGUoZmFsc2UpOwoKICBjb25zdCB7IGRhdGE6IGNvbmZpZywgaXNMb2FkaW5nOiBsb2FkaW5nQ29uZmlnIH0gPSB1c2VRdWVyeSh7CiAgICBxdWVyeUtleTogWydvcGVudnBuLWNvbmZpZyddLAogICAgcXVlcnlGbjogIG9wZW52cG5BcGkuZ2V0Q29uZmlnLAogIH0pOwoKICBjb25zdCB7IGRhdGE6IHJvdXRlcnMgPSBbXSB9ID0gdXNlUXVlcnkoewogICAgcXVlcnlLZXk6IFsncm91dGVycyddLAogICAgcXVlcnlGbjogIG1pa3JvdGlrQXBpLmxpc3RhciwKICB9KTsKCiAgY29uc3QgW2Zvcm0sIHNldEZvcm1dID0gdXNlU3RhdGU8VXBzZXJ0T3BlbnZwbkR0bz4oREVGQVVMVFMpOwogIGNvbnN0IFtpbml0aWFsaXplZCwgc2V0SW5pdGlhbGl6ZWRdID0gdXNlU3RhdGUoZmFsc2UpOwoKICBpZiAoY29uZmlnICYmICFpbml0aWFsaXplZCkgewogICAgc2V0Rm9ybSh7CiAgICAgIG5vbWJyZTogICAgICBjb25maWcubm9tYnJlLAogICAgICBzZXJ2aWRvcklwOiAgY29uZmlnLnNlcnZpZG9ySXAsCiAgICAgIHB1ZXJ0bzogICAgICBjb25maWcucHVlcnRvLAogICAgICBwcm90b2NvbG86ICAgY29uZmlnLnByb3RvY29sbywKICAgICAgZGlzcG9zaXRpdm86IGNvbmZpZy5kaXNwb3NpdGl2bywKICAgICAgdnBuTmV0d29yazogIGNvbmZpZy52cG5OZXR3b3JrLAogICAgICB2cG5OZXRtYXNrOiAgY29uZmlnLnZwbk5ldG1hc2ssCiAgICAgIGNhQ2VydDogICAgICBjb25maWcuY2FDZXJ0ID8/ICcnLAogICAgICBzZXJ2ZXJDZXJ0OiAgY29uZmlnLnNlcnZlckNlcnQgPz8gJycsCiAgICAgIHNlcnZlcktleTogICBjb25maWcuc2VydmVyS2V5ID8/ICcnLAogICAgICBkaFBhcmFtczogICAgY29uZmlnLmRoUGFyYW1zID8/ICcnLAogICAgfSk7CiAgICBzZXRJbml0aWFsaXplZCh0cnVlKTsKICB9CgogIGNvbnN0IHNhdmVNdXQgPSB1c2VNdXRhdGlvbih7CiAgICBtdXRhdGlvbkZuOiAoZHRvOiBVcHNlcnRPcGVudnBuRHRvKSA9PiBvcGVudnBuQXBpLnVwc2VydENvbmZpZyhkdG8pLAogICAgb25TdWNjZXNzOiAoKSA9PiB7CiAgICAgIHF1ZXJ5Q2xpZW50LmludmFsaWRhdGVRdWVyaWVzKHsgcXVlcnlLZXk6IFsnb3BlbnZwbi1jb25maWcnXSB9KTsKICAgICAgdG9hc3QoJ0NvbmZpZ3VyYWNpw7NuIE9wZW5WUE4gZ3VhcmRhZGEnLCB7IHR5cGU6ICdzdWNjZXNzJyB9KTsKICAgIH0sCiAgICBvbkVycm9yOiAoZXJyKSA9PiB0b2FzdChwYXJzZUFwaUVycm9yKGVyciksIHsgdHlwZTogJ2Vycm9yJyB9KSwKICB9KTsKCiAgY29uc3Qgc2V0ID0gKGtleToga2V5b2YgVXBzZXJ0T3BlbnZwbkR0bywgdmFsOiBhbnkpID0+CiAgICBzZXRGb3JtKChmKSA9PiAoeyAuLi5mLCBba2V5XTogdmFsIH0pKTsKCiAgY29uc3QgaGFuZGxlU2F2ZSA9ICgpID0+IHsKICAgIGlmICghZm9ybS5zZXJ2aWRvcklwKSB7CiAgICAgIHRvYXN0KCdMYSBJUCBkZWwgc2Vydmlkb3IgZXMgb2JsaWdhdG9yaWEnLCB7IHR5cGU6ICdlcnJvcicgfSk7CiAgICAgIHJldHVybjsKICAgIH0KICAgIHNhdmVNdXQubXV0YXRlKGZvcm0pOwogIH07CgogIHJldHVybiAoCiAgICA8ZGl2IGNsYXNzTmFtZT0icC02IHNwYWNlLXktNiBtYXgtdy00eGwiPgogICAgICB7LyogSGVhZGVyICovfQogICAgICA8ZGl2PgogICAgICAgIDxoMSBjbGFzc05hbWU9InRleHQteGwgZm9udC1ib2xkIHRleHQtd2hpdGUgZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTIiPgogICAgICAgICAgPFNoaWVsZCBjbGFzc05hbWU9InctNSBoLTUgdGV4dC1wcmltYXJ5IiAvPgogICAgICAgICAgU2Vydmlkb3IgT3BlblZQTgogICAgICAgIDwvaDE+CiAgICAgICAgPHAgY2xhc3NOYW1lPSJ0ZXh0LXNtIHRleHQtZ3JheS00MDAgbXQtMSI+CiAgICAgICAgICBDb25maWd1cmEgZWwgdMO6bmVsIFZQTiBwYXJhIGNvbmVjdGFyIGxvcyByb3V0ZXJzIE1pa3JvVGlrIGFsIFZQUyBkZSBmb3JtYSBzZWd1cmEuCiAgICAgICAgPC9wPgogICAgICA8L2Rpdj4KCiAgICAgIHsvKiBJbmZvIGJhbm5lciAqL30KICAgICAgPGRpdiBjbGFzc05hbWU9ImJnLWJsdWUtNTAwLzEwIGJvcmRlciBib3JkZXItYmx1ZS01MDAvMjAgcm91bmRlZC14bCBwLTQgdGV4dC1zbSB0ZXh0LWJsdWUtMzAwIj4KICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZmxleCBpdGVtcy1zdGFydCBnYXAtMiI+CiAgICAgICAgICA8SW5mbyBjbGFzc05hbWU9InctNCBoLTQgbXQtMC41IGZsZXgtc2hyaW5rLTAiIC8+CiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0idGV4dC14cyI+CiAgICAgICAgICAgIDxwIGNsYXNzTmFtZT0iZm9udC1tZWRpdW0gbWItMSI+wr9Dw7NtbyBmdW5jaW9uYT88L3A+CiAgICAgICAgICAgIDxvbCBjbGFzc05hbWU9Imxpc3QtZGVjaW1hbCBsaXN0LWluc2lkZSBzcGFjZS15LTAuNSB0ZXh0LWJsdWUtMzAwLzgwIj4KICAgICAgICAgICAgICA8bGk+Q29uZmlndXJhIGxvcyBwYXLDoW1ldHJvcyBkZWwgc2Vydmlkb3IgeSBndWFyZGEuPC9saT4KICAgICAgICAgICAgICA8bGk+RGVzY2FyZ2EgZWwgPGNvZGU+c2VydmVyLmNvbmY8L2NvZGU+IHkgY29waWEgbG9zIGNlcnRpZmljYWRvcyBhbCBWUFMuPC9saT4KICAgICAgICAgICAgICA8bGk+UGFyYSBjYWRhIHJvdXRlciBNaWtyb1RpaywgZGVzY2FyZ2Egc3UgYXJjaGl2byA8Y29kZT4ub3ZwbjwvY29kZT4sIGFncmVnYSBsb3MgY2VydGlmaWNhZG9zIHkgY8OhcmdhbG8gZW4gZWwgcm91dGVyLjwvbGk+CiAgICAgICAgICAgICAgPGxpPlVuYSB2ZXogY29uZWN0YWRvLCByZWdpc3RyYSBsYSBJUCBWUE4gYXNpZ25hZGEgZW4gbGEgY29uZmlndXJhY2nDs24gZGVsIHJvdXRlci48L2xpPgogICAgICAgICAgICA8L29sPgogICAgICAgICAgPC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgIDwvZGl2PgoKICAgICAge2xvYWRpbmdDb25maWcgPyAoCiAgICAgICAgPGRpdiBjbGFzc05hbWU9ImZsZXggaXRlbXMtY2VudGVyIGdhcC0yIHRleHQtZ3JheS00MDAiPgogICAgICAgICAgPExvYWRlcjIgY2xhc3NOYW1lPSJ3LTQgaC00IGFuaW1hdGUtc3BpbiIgLz4KICAgICAgICAgIENhcmdhbmRvIGNvbmZpZ3VyYWNpw7NuLi4uCiAgICAgICAgPC9kaXY+CiAgICAgICkgOiAoCiAgICAgICAgPD4KICAgICAgICAgIHsvKiBGb3JtdWxhcmlvIGRlIGNvbmZpZ3VyYWNpw7NuICovfQogICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImJnLVtoc2wodmFyKC0tc2lkZWJhci1iZykpXSBib3JkZXIgYm9yZGVyLXdoaXRlLzEwIHJvdW5kZWQteGwgcC01IHNwYWNlLXktNCI+CiAgICAgICAgICAgIDxoMiBjbGFzc05hbWU9ImZvbnQtbWVkaXVtIHRleHQtd2hpdGUgdGV4dC1zbSBmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiI+CiAgICAgICAgICAgICAgPFNlcnZlciBjbGFzc05hbWU9InctNCBoLTQgdGV4dC1wcmltYXJ5IiAvPgogICAgICAgICAgICAgIFBhcsOhbWV0cm9zIGRlbCBzZXJ2aWRvcgogICAgICAgICAgICA8L2gyPgoKICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImdyaWQgZ3JpZC1jb2xzLTIgZ2FwLTMiPgogICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJjb2wtc3Bhbi0yIj4KICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzc05hbWU9InRleHQteHMgdGV4dC1ncmF5LTQwMCBtYi0xIGJsb2NrIj5Ob21icmU8L2xhYmVsPgogICAgICAgICAgICAgICAgPGlucHV0CiAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0idy1mdWxsIGJnLXdoaXRlLzUgYm9yZGVyIGJvcmRlci13aGl0ZS8xMCByb3VuZGVkLWxnIHB4LTMgcHktMiB0ZXh0LXNtIHRleHQtd2hpdGUgZm9jdXM6b3V0bGluZS1ub25lIGZvY3VzOmJvcmRlci1wcmltYXJ5LzUwIgogICAgICAgICAgICAgICAgICB2YWx1ZT17Zm9ybS5ub21icmV9CiAgICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc2V0KCdub21icmUnLCBlLnRhcmdldC52YWx1ZSl9CiAgICAgICAgICAgICAgICAvPgogICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgIDxkaXY+CiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtZ3JheS00MDAgbWItMSBibG9jayI+SVAgcMO6YmxpY2EgZGVsIFZQUyAqPC9sYWJlbD4KICAgICAgICAgICAgICAgIDxpbnB1dAogICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBiZy13aGl0ZS81IGJvcmRlciBib3JkZXItd2hpdGUvMTAgcm91bmRlZC1sZyBweC0zIHB5LTIgdGV4dC1zbSB0ZXh0LXdoaXRlIGZvY3VzOm91dGxpbmUtbm9uZSBmb2N1czpib3JkZXItcHJpbWFyeS81MCIKICAgICAgICAgICAgICAgICAgdmFsdWU9e2Zvcm0uc2Vydmlkb3JJcH0KICAgICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXQoJ3NlcnZpZG9ySXAnLCBlLnRhcmdldC52YWx1ZSl9CiAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyPSIxNDkuMzQuNDguMjI0IgogICAgICAgICAgICAgICAgLz4KICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNDAwIG1iLTEgYmxvY2siPlB1ZXJ0bzwvbGFiZWw+CiAgICAgICAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgICAgICAgdHlwZT0ibnVtYmVyIgogICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBiZy13aGl0ZS81IGJvcmRlciBib3JkZXItd2hpdGUvMTAgcm91bmRlZC1sZyBweC0zIHB5LTIgdGV4dC1zbSB0ZXh0LXdoaXRlIGZvY3VzOm91dGxpbmUtbm9uZSBmb2N1czpib3JkZXItcHJpbWFyeS81MCIKICAgICAgICAgICAgICAgICAgdmFsdWU9e2Zvcm0ucHVlcnRvfQogICAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgncHVlcnRvJywgcGFyc2VJbnQoZS50YXJnZXQudmFsdWUpKX0KICAgICAgICAgICAgICAgIC8+CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgPGRpdj4KICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzc05hbWU9InRleHQteHMgdGV4dC1ncmF5LTQwMCBtYi0xIGJsb2NrIj5Qcm90b2NvbG88L2xhYmVsPgogICAgICAgICAgICAgICAgPHNlbGVjdAogICAgICAgICAgICAgICAgICBjbGFzc05hbWU9InctZnVsbCBiZy13aGl0ZS81IGJvcmRlciBib3JkZXItd2hpdGUvMTAgcm91bmRlZC1sZyBweC0zIHB5LTIgdGV4dC1zbSB0ZXh0LXdoaXRlIGZvY3VzOm91dGxpbmUtbm9uZSBmb2N1czpib3JkZXItcHJpbWFyeS81MCIKICAgICAgICAgICAgICAgICAgdmFsdWU9e2Zvcm0ucHJvdG9jb2xvfQogICAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgncHJvdG9jb2xvJywgZS50YXJnZXQudmFsdWUpfQogICAgICAgICAgICAgICAgPgogICAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJ1ZHAiPlVEUCAocmVjb21lbmRhZG8pPC9vcHRpb24+CiAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9InRjcCI+VENQPC9vcHRpb24+CiAgICAgICAgICAgICAgICA8L3NlbGVjdD4KICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNDAwIG1iLTEgYmxvY2siPkRpc3Bvc2l0aXZvPC9sYWJlbD4KICAgICAgICAgICAgICAgIDxzZWxlY3QKICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJ3LWZ1bGwgYmctd2hpdGUvNSBib3JkZXIgYm9yZGVyLXdoaXRlLzEwIHJvdW5kZWQtbGcgcHgtMyBweS0yIHRleHQtc20gdGV4dC13aGl0ZSBmb2N1czpvdXRsaW5lLW5vbmUgZm9jdXM6Ym9yZGVyLXByaW1hcnkvNTAiCiAgICAgICAgICAgICAgICAgIHZhbHVlPXtmb3JtLmRpc3Bvc2l0aXZvfQogICAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgnZGlzcG9zaXRpdm8nLCBlLnRhcmdldC52YWx1ZSl9CiAgICAgICAgICAgICAgICA+CiAgICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9InR1biI+VFVOIChlbnJ1dGFkbyk8L29wdGlvbj4KICAgICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT0idGFwIj5UQVAgKGJyaWRnZWQpPC9vcHRpb24+CiAgICAgICAgICAgICAgICA8L3NlbGVjdD4KICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNDAwIG1iLTEgYmxvY2siPlJlZCBWUE48L2xhYmVsPgogICAgICAgICAgICAgICAgPGlucHV0CiAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0idy1mdWxsIGJnLXdoaXRlLzUgYm9yZGVyIGJvcmRlci13aGl0ZS8xMCByb3VuZGVkLWxnIHB4LTMgcHktMiB0ZXh0LXNtIHRleHQtd2hpdGUgZm9jdXM6b3V0bGluZS1ub25lIGZvY3VzOmJvcmRlci1wcmltYXJ5LzUwIgogICAgICAgICAgICAgICAgICB2YWx1ZT17Zm9ybS52cG5OZXR3b3JrfQogICAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldCgndnBuTmV0d29yaycsIGUudGFyZ2V0LnZhbHVlKX0KICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI9IjEwLjguMC4wIgogICAgICAgICAgICAgICAgLz4KICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0idGV4dC14cyB0ZXh0LWdyYXktNDAwIG1iLTEgYmxvY2siPk3DoXNjYXJhIFZQTjwvbGFiZWw+CiAgICAgICAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJ3LWZ1bGwgYmctd2hpdGUvNSBib3JkZXIgYm9yZGVyLXdoaXRlLzEwIHJvdW5kZWQtbGcgcHgtMyBweS0yIHRleHQtc20gdGV4dC13aGl0ZSBmb2N1czpvdXRsaW5lLW5vbmUgZm9jdXM6Ym9yZGVyLXByaW1hcnkvNTAiCiAgICAgICAgICAgICAgICAgIHZhbHVlPXtmb3JtLnZwbk5ldG1hc2t9CiAgICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc2V0KCd2cG5OZXRtYXNrJywgZS50YXJnZXQudmFsdWUpfQogICAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcj0iMjU1LjI1NS4yNTUuMCIKICAgICAgICAgICAgICAgIC8+CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgICAgey8qIENlcnRpZmljYWRvcyAoY29sYXBzYWJsZSkgKi99CiAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiBzZXRTaG93Q2VydHMoIXNob3dDZXJ0cyl9CiAgICAgICAgICAgICAgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiB0ZXh0LXhzIHRleHQtZ3JheS00MDAgaG92ZXI6dGV4dC13aGl0ZSB0cmFuc2l0aW9uLWNvbG9ycyIKICAgICAgICAgICAgPgogICAgICAgICAgICAgIHtzaG93Q2VydHMgPyA8Q2hldnJvblVwIGNsYXNzTmFtZT0idy0zLjUgaC0zLjUiIC8+IDogPENoZXZyb25Eb3duIGNsYXNzTmFtZT0idy0zLjUgaC0zLjUiIC8+fQogICAgICAgICAgICAgIENlcnRpZmljYWRvcyB5IGNsYXZlcyAob3BjaW9uYWwg4oCUIHBlZ2FyIHBhcmEgaW5jbHVpcmxvcyBlbiBsb3MgLm92cG4gZ2VuZXJhZG9zKQogICAgICAgICAgICA8L2J1dHRvbj4KCiAgICAgICAgICAgIHtzaG93Q2VydHMgJiYgKAogICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJzcGFjZS15LTMgcHQtMSI+CiAgICAgICAgICAgICAgICB7WwogICAgICAgICAgICAgICAgICB7IGtleTogJ2NhQ2VydCcsICAgICBsYWJlbDogJ0NBIENlcnRpZmljYXRlIChjYS5jcnQpJyB9LAogICAgICAgICAgICAgICAgICB7IGtleTogJ3NlcnZlckNlcnQnLCBsYWJlbDogJ1NlcnZlciBDZXJ0aWZpY2F0ZSAoc2VydmVyLmNydCknIH0sCiAgICAgICAgICAgICAgICAgIHsga2V5OiAnc2VydmVyS2V5JywgIGxhYmVsOiAnU2VydmVyIEtleSAoc2VydmVyLmtleSknIH0sCiAgICAgICAgICAgICAgICAgIHsga2V5OiAnZGhQYXJhbXMnLCAgIGxhYmVsOiAnREggUGFyYW1ldGVycyAoZGgucGVtKScgfSwKICAgICAgICAgICAgICAgIF0ubWFwKCh7IGtleSwgbGFiZWwgfSkgPT4gKAogICAgICAgICAgICAgICAgICA8ZGl2IGtleT17a2V5fT4KICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3NOYW1lPSJ0ZXh0LXhzIHRleHQtZ3JheS00MDAgbWItMSBibG9jayI+e2xhYmVsfTwvbGFiZWw+CiAgICAgICAgICAgICAgICAgICAgPHRleHRhcmVhCiAgICAgICAgICAgICAgICAgICAgICByb3dzPXszfQogICAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJ3LWZ1bGwgYmctd2hpdGUvNSBib3JkZXIgYm9yZGVyLXdoaXRlLzEwIHJvdW5kZWQtbGcgcHgtMyBweS0yIHRleHQteHMgZm9udC1tb25vIHRleHQtZ3JheS0zMDAgZm9jdXM6b3V0bGluZS1ub25lIGZvY3VzOmJvcmRlci1wcmltYXJ5LzUwIHJlc2l6ZS1ub25lIgogICAgICAgICAgICAgICAgICAgICAgdmFsdWU9eyhmb3JtIGFzIGFueSlba2V5XSA/PyAnJ30KICAgICAgICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc2V0KGtleSBhcyBhbnksIGUudGFyZ2V0LnZhbHVlKX0KICAgICAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyPXtgLS0tLS1CRUdJTiAke2tleSA9PT0gJ2RoUGFyYW1zJyA/ICdESCBQQVJBTUVURVJTJyA6ICdDRVJUSUZJQ0FURSd9LS0tLS1gfQogICAgICAgICAgICAgICAgICAgIC8+CiAgICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICAgKSl9CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICl9CgogICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iZmxleCBnYXAtMyBwdC0yIj4KICAgICAgICAgICAgICA8YnV0dG9uCiAgICAgICAgICAgICAgICBvbkNsaWNrPXtoYW5kbGVTYXZlfQogICAgICAgICAgICAgICAgZGlzYWJsZWQ9e3NhdmVNdXQuaXNQZW5kaW5nfQogICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiBweC00IHB5LTIgdGV4dC1zbSBmb250LW1lZGl1bSBiZy1wcmltYXJ5IHRleHQtd2hpdGUgcm91bmRlZC1sZyBob3ZlcjpiZy1wcmltYXJ5LzgwIGRpc2FibGVkOm9wYWNpdHktNTAiCiAgICAgICAgICAgICAgPgogICAgICAgICAgICAgICAge3NhdmVNdXQuaXNQZW5kaW5nID8gPExvYWRlcjIgY2xhc3NOYW1lPSJ3LTQgaC00IGFuaW1hdGUtc3BpbiIgLz4gOiA8U2F2ZSBjbGFzc05hbWU9InctNCBoLTQiIC8+fQogICAgICAgICAgICAgICAgR3VhcmRhciBjb25maWd1cmFjacOzbgogICAgICAgICAgICAgIDwvYnV0dG9uPgoKICAgICAgICAgICAgICB7Y29uZmlnICYmICgKICAgICAgICAgICAgICAgIDw+CiAgICAgICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICAgICAgICBvbkNsaWNrPXsoKSA9PiBvcGVudnBuQXBpLmRvd25sb2FkU2VydmVyQ29uZigpLmNhdGNoKCgpID0+IHRvYXN0KCdFcnJvciBhbCBkZXNjYXJnYXInLCB7IHR5cGU6ICdlcnJvcicgfSkpfQogICAgICAgICAgICAgICAgICAgIGNsYXNzTmFtZT0iZmxleCBpdGVtcy1jZW50ZXIgZ2FwLTIgcHgtNCBweS0yIHRleHQtc20gZm9udC1tZWRpdW0gYmctd2hpdGUvMTAgdGV4dC13aGl0ZSByb3VuZGVkLWxnIGhvdmVyOmJnLXdoaXRlLzE1IHRyYW5zaXRpb24tY29sb3JzIgogICAgICAgICAgICAgICAgICA+CiAgICAgICAgICAgICAgICAgICAgPERvd25sb2FkIGNsYXNzTmFtZT0idy00IGgtNCIgLz4KICAgICAgICAgICAgICAgICAgICBzZXJ2ZXIuY29uZgogICAgICAgICAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICAgICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IG9wZW52cG5BcGkuZG93bmxvYWRJbnN0cnVjY2lvbmVzKCkuY2F0Y2goKCkgPT4gdG9hc3QoJ0Vycm9yIGFsIGRlc2NhcmdhcicsIHsgdHlwZTogJ2Vycm9yJyB9KSl9CiAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiBweC00IHB5LTIgdGV4dC1zbSBmb250LW1lZGl1bSBiZy13aGl0ZS8xMCB0ZXh0LXdoaXRlIHJvdW5kZWQtbGcgaG92ZXI6Ymctd2hpdGUvMTUgdHJhbnNpdGlvbi1jb2xvcnMiCiAgICAgICAgICAgICAgICAgID4KICAgICAgICAgICAgICAgICAgICA8RG93bmxvYWQgY2xhc3NOYW1lPSJ3LTQgaC00IiAvPgogICAgICAgICAgICAgICAgICAgIEluc3RydWNjaW9uZXMKICAgICAgICAgICAgICAgICAgPC9idXR0b24+CiAgICAgICAgICAgICAgICA8Lz4KICAgICAgICAgICAgICApfQogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgIHsvKiBDbGllbnRlcyBWUE4g4oCUIHVubyBwb3Igcm91dGVyICovfQogICAgICAgICAge2NvbmZpZyAmJiByb3V0ZXJzLmxlbmd0aCA+IDAgJiYgKAogICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iYmctW2hzbCh2YXIoLS1zaWRlYmFyLWJnKSldIGJvcmRlciBib3JkZXItd2hpdGUvMTAgcm91bmRlZC14bCBwLTUiPgogICAgICAgICAgICAgIDxoMiBjbGFzc05hbWU9ImZvbnQtbWVkaXVtIHRleHQtd2hpdGUgdGV4dC1zbSBmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMiBtYi00Ij4KICAgICAgICAgICAgICAgIDxSb3V0ZXIgY2xhc3NOYW1lPSJ3LTQgaC00IHRleHQtcHJpbWFyeSIgLz4KICAgICAgICAgICAgICAgIERlc2NhcmdhciBjb25maWd1cmFjacOzbiBkZSBjbGllbnRlIHBvciByb3V0ZXIKICAgICAgICAgICAgICA8L2gyPgogICAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJzcGFjZS15LTIiPgogICAgICAgICAgICAgICAge3JvdXRlcnMubWFwKChyKSA9PiAoCiAgICAgICAgICAgICAgICAgIDxkaXYKICAgICAgICAgICAgICAgICAgICBrZXk9e3IuaWR9CiAgICAgICAgICAgICAgICAgICAgY2xhc3NOYW1lPSJmbGV4IGl0ZW1zLWNlbnRlciBqdXN0aWZ5LWJldHdlZW4gcC0zIHJvdW5kZWQtbGcgYm9yZGVyIGJvcmRlci13aGl0ZS8xMCBob3Zlcjpib3JkZXItd2hpdGUvMjAgdHJhbnNpdGlvbi1jb2xvcnMiCiAgICAgICAgICAgICAgICAgID4KICAgICAgICAgICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9InRleHQtc20gZm9udC1tZWRpdW0gdGV4dC13aGl0ZSI+e3Iubm9tYnJlfTwvZGl2PgogICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9InRleHQteHMgdGV4dC1ncmF5LTQwMCI+CiAgICAgICAgICAgICAgICAgICAgICAgIHtyLmlwR2VzdGlvbn0KICAgICAgICAgICAgICAgICAgICAgICAge3IudnBuSXAgJiYgPHNwYW4gY2xhc3NOYW1lPSJtbC0yIHRleHQtYmx1ZS00MDAiPlZQTjoge3IudnBuSXB9PC9zcGFuPn0KICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IG9wZW52cG5BcGkuZG93bmxvYWRDbGllbnRlT3ZwbihyLm5vbWJyZSkuY2F0Y2goKCkgPT4gdG9hc3QoJ0Vycm9yIGFsIGRlc2NhcmdhcicsIHsgdHlwZTogJ2Vycm9yJyB9KSl9CiAgICAgICAgICAgICAgICAgICAgICBjbGFzc05hbWU9ImZsZXggaXRlbXMtY2VudGVyIGdhcC0xLjUgcHgtMyBweS0xLjUgdGV4dC14cyBmb250LW1lZGl1bSBiZy1wcmltYXJ5LzIwIHRleHQtcHJpbWFyeSByb3VuZGVkLWxnIGhvdmVyOmJnLXByaW1hcnkvMzAgdHJhbnNpdGlvbi1jb2xvcnMiCiAgICAgICAgICAgICAgICAgICAgPgogICAgICAgICAgICAgICAgICAgICAgPERvd25sb2FkIGNsYXNzTmFtZT0idy0zLjUgaC0zLjUiIC8+CiAgICAgICAgICAgICAgICAgICAgICAub3ZwbgogICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICAgICkpfQogICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICl9CiAgICAgICAgPC8+CiAgICAgICl9CiAgICA8L2Rpdj4KICApOwp9Cg==').decode('utf-8'))

print('── 4. Build backend ──')
run('npm', 'run', 'build', cwd=BE)
print('  ✓ Backend compilado')

print('── 5. Migración ──')
run('npm', 'run', 'migration:run', cwd=BE)
print('  ✓ Migración aplicada')

print('── 6. Build frontend ──')
run('npm', 'run', 'build', cwd=FE)
print('  ✓ Frontend compilado')

print('── 7. Reload PM2 ──')
run('pm2', 'reload', 'all')
print('  ✓ PM2 recargado')

print('')
print('✅ Despliegue completo.')
print('   - Sección "GESTIÓN DE RED > Routers" disponible en el sidebar')
print('   - Sección "GESTIÓN DE RED > OpenVPN" disponible en el sidebar')
print('   - API: POST /api/v1/mikrotik/routers/:id/amarre-ip-mac')
print('   - API: GET/POST /api/v1/openvpn/config')
