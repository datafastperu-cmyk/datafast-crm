import {
  Injectable, Logger, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsIP, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

// ─── DTO ──────────────────────────────────────────────────────────
export class ConfigurarMgmtIpPoolDto {
  @IsIP('4') inicio: string;
  @IsIP('4') fin:    string;
}

export interface EstadoMgmtIpPool {
  total:    number;
  libres:   number;
  ocupados: number;
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}
function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

// ─── Service ──────────────────────────────────────────────────────
// Pool de IPs ESTÁTICAS de gestión TR-069. Causa raíz (2026-07-17,
// CNT-2026-000004): el IP-host de gestión (ip-index 0) de las ONUs EG8145V5
// probadas NUNCA materializó tráfico en modo DHCP (2 firmwares, 2 esquemas
// GEM/T-CONT distintos, confirmado con sniffer) — solo funciona en modo
// ESTÁTICO, confirmado por ingeniería inversa contra una ONU aprovisionada por
// SmartOLT (que usa IP estática sobre su propia VLAN 1500). El ERP replica el
// MECANISMO, nunca la infraestructura de SmartOLT: IPs propias sobre la VLAN
// de gestión canónica del ERP (DATAFAST_GESTION_1600), fuera del rango del
// pool DHCP legacy (10.16.0.100-200) para no colisionar.
@Injectable()
export class OltMgmtIpPoolService {
  private readonly logger = new Logger(OltMgmtIpPoolService.name);

  constructor(
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  // ── configurarRango ───────────────────────────────────────────────
  async configurarRango(
    oltId:     string,
    empresaId: string,
    dto:       ConfigurarMgmtIpPoolDto,
  ): Promise<{ insertados: number; omitidos: number }> {
    const inicio = ipToInt(dto.inicio);
    const fin    = ipToInt(dto.fin);
    if (fin < inicio) {
      throw new UnprocessableEntityException(`"fin" (${dto.fin}) debe ser ≥ "inicio" (${dto.inicio}).`);
    }
    if (fin - inicio >= 1024) {
      throw new UnprocessableEntityException(`El rango no puede superar 1024 IPs por operación.`);
    }

    const ips: string[] = [];
    for (let i = inicio; i <= fin; i++) ips.push(intToIp(i));

    const rows = await this.ds.query<{ ip_address: string }[]>(
      `INSERT INTO olt_mgmt_ip_pool
         (id, empresa_id, olt_id, ip_address, estado, created_at, updated_at, version)
       SELECT gen_random_uuid(), $1, $2, ip::inet, 'libre', NOW(), NOW(), 1
       FROM   unnest($3::text[]) AS ip
       ON CONFLICT (olt_id, ip_address) DO UPDATE
         SET deleted_at = NULL,
             estado     = 'libre',
             contrato_id = NULL,
             locked_at  = NULL,
             updated_at = NOW(),
             version    = olt_mgmt_ip_pool.version + 1
         WHERE olt_mgmt_ip_pool.deleted_at IS NOT NULL
       RETURNING ip_address`,
      [empresaId, oltId, ips],
    );

    const insertados = rows.length;
    const omitidos   = ips.length - insertados;
    this.logger.log(`Mgmt IP pool config | olt=${oltId} rango=${dto.inicio}-${dto.fin} insertados=${insertados} omitidos=${omitidos}`);
    return { insertados, omitidos };
  }

  // ── allocar ────────────────────────────────────────────────────────
  // Retorna null → pool sin configurar para esta OLT (modo bypass).
  async allocar(oltId: string, contratoId: string): Promise<string | null> {
    const [existing] = await this.ds.query<{ ip_address: string }[]>(
      `SELECT host(ip_address) AS ip_address
       FROM   olt_mgmt_ip_pool
       WHERE  olt_id      = $1
         AND  contrato_id = $2
         AND  estado      = 'ocupado'
         AND  deleted_at  IS NULL
       LIMIT  1`,
      [oltId, contratoId],
    );
    if (existing) {
      this.logger.log(`Mgmt IP reuse | olt=${oltId} contrato=${contratoId} ip=${existing.ip_address}`);
      return existing.ip_address;
    }

    const result: any = await this.ds.query(
      `UPDATE olt_mgmt_ip_pool
       SET estado      = 'ocupado',
           contrato_id = $1,
           locked_at   = NOW(),
           updated_at  = NOW(),
           version     = version + 1
       WHERE id = (
         SELECT id FROM olt_mgmt_ip_pool
         WHERE  olt_id     = $2
           AND  estado     = 'libre'
           AND  deleted_at IS NULL
         ORDER  BY ip_address ASC
         LIMIT  1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING host(ip_address) AS ip_address`,
      [contratoId, oltId],
    );
    const filas = Array.isArray(result?.[0]) ? result[0] : result;
    const allocated = filas?.[0] as { ip_address: string } | undefined;
    if (allocated?.ip_address) {
      this.logger.log(`Mgmt IP alloc | olt=${oltId} contrato=${contratoId} ip=${allocated.ip_address}`);
      return allocated.ip_address;
    }

    const [{ total }] = await this.ds.query<{ total: string }[]>(
      `SELECT COUNT(*)::text AS total FROM olt_mgmt_ip_pool WHERE olt_id = $1 AND deleted_at IS NULL`,
      [oltId],
    );
    if (Number(total) === 0) return null;

    this.logger.warn(`Pool de IPs de gestión AGOTADO | olt=${oltId}`);
    throw new UnprocessableEntityException(
      `Pool de IPs de gestión agotado para esta OLT. Configura un rango más amplio.`,
    );
  }

  // ── liberar ────────────────────────────────────────────────────────
  async liberar(oltId: string, contratoId: string): Promise<void> {
    await this.ds.query(
      `UPDATE olt_mgmt_ip_pool
       SET estado      = 'libre',
           contrato_id = NULL,
           locked_at   = NULL,
           updated_at  = NOW(),
           version     = version + 1
       WHERE olt_id      = $1
         AND contrato_id = $2
         AND deleted_at  IS NULL`,
      [oltId, contratoId],
    );
    this.logger.log(`Mgmt IP release | olt=${oltId} contrato=${contratoId}`);
  }

  // ── obtenerEstado ─────────────────────────────────────────────────
  async obtenerEstado(oltId: string, empresaId: string): Promise<EstadoMgmtIpPool> {
    const [s] = await this.ds.query<{ total: string; libres: string; ocupados: string }[]>(
      `SELECT
         COUNT(*)::text                                              AS total,
         SUM(CASE WHEN estado = 'libre'   THEN 1 ELSE 0 END)::text AS libres,
         SUM(CASE WHEN estado = 'ocupado' THEN 1 ELSE 0 END)::text AS ocupados
       FROM  olt_mgmt_ip_pool
       WHERE olt_id     = $1
         AND empresa_id = $2
         AND deleted_at IS NULL`,
      [oltId, empresaId],
    );
    return { total: Number(s.total), libres: Number(s.libres), ocupados: Number(s.ocupados) };
  }
}
