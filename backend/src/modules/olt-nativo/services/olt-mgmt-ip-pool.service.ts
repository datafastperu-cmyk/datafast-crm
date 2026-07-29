import {
  Injectable, Logger, UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IsIP, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { filasUpdateReturning } from '../../../common/utils/pg-result.util';

// ─── DTO ──────────────────────────────────────────────────────────
export class ConfigurarMgmtIpPoolDto {
  @IsIP('4') inicio: string;
  @IsIP('4') fin:    string;
}

export interface MgmtIpItem {
  ip:             string;
  estado:         'libre' | 'ocupado';
  contratoId:     string | null;
  numeroContrato: string | null;
  cliente:        string | null;
  sn:             string | null;
  onuId:          number | null;
  slot:           number | null;
  port:           number | null;
  carrilEstado:   string | null;
  actualizado:    Date;
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

    // ── INVARIANTE: los tramos de dos OLTs jamás se solapan ──────────────────
    // La VLAN 1600 es un único dominio L2 compartido por todas las OLTs, y cada OLT usa un
    // tramo disjunto dentro de él (p.ej. un /22 por OLT). Esa disjunción es lo ÚNICO que
    // garantiza que dos ONUs no reciban la misma IP estática: la unicidad del pool es
    // `(olt_id, ip_address)`, así que la misma IP en dos OLTs distintas es perfectamente
    // insertable — y en un L2 compartido eso es un conflicto de IP con gestión intermitente
    // en ambas ONUs y un diagnóstico infernal, porque cada OLT reporta su lado como correcto.
    //
    // Hasta 2026-07-29 la disjunción era una convención que nadie verificaba. Un invariante
    // que solo vive en la documentación no es un invariante: se comprueba aquí, que es el
    // único punto por donde entran IPs al pool.
    const [colision] = await this.ds.query<Array<{ ip_address: string; olt: string }>>(
      `SELECT p.ip_address::text, COALESCE(o.nombre, p.olt_id::text) AS olt
         FROM olt_mgmt_ip_pool p
         LEFT JOIN olt_dispositivos o ON o.id = p.olt_id
        WHERE p.empresa_id = $1
          AND p.olt_id <> $2
          AND p.deleted_at IS NULL
          AND p.ip_address = ANY($3::inet[])
        LIMIT 1`,
      [empresaId, oltId, ips],
    );
    if (colision) {
      throw new UnprocessableEntityException(
        `El rango ${dto.inicio}-${dto.fin} se solapa con el de la OLT "${colision.olt}" ` +
        `(por ejemplo ${colision.ip_address}). En una VLAN de gestión compartida cada OLT debe ` +
        `tener un tramo propio y disjunto: dos ONUs con la misma IP se anulan mutuamente.`,
      );
    }

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

  // ── retirarRango ──────────────────────────────────────────────────
  // Saca del pool un tramo que ya no corresponde a esta OLT (re-direccionamiento, tramo
  // sembrado por error, migración a otro bloque). Sin esto solo se podían AÑADIR IPs, y la
  // única salida era un UPDATE a mano contra la tabla — justo lo que el ERP no debe requerir.
  //
  // NUNCA retira una IP OCUPADA: esa IP está escrita en el IP-host de una ONU viva. Sacarla
  // del pool dejaría al ERP sin saber que le pertenece, y el tramo podría reasignarse a otra
  // OLT: dos ONUs con la misma IP en el mismo L2. Para retirar una IP ocupada primero hay que
  // desaprovisionar o desactivar el carril de esa ONU, que es lo que la libera de verdad.
  async retirarRango(
    oltId:     string,
    empresaId: string,
    dto:       ConfigurarMgmtIpPoolDto,
  ): Promise<{ retiradas: number }> {
    const inicio = ipToInt(dto.inicio);
    const fin    = ipToInt(dto.fin);
    if (fin < inicio) {
      throw new UnprocessableEntityException(`"fin" (${dto.fin}) debe ser ≥ "inicio" (${dto.inicio}).`);
    }

    const ocupadas = await this.ds.query<Array<{ ip_address: string; contrato_id: string }>>(
      `SELECT ip_address::text, contrato_id::text
         FROM olt_mgmt_ip_pool
        WHERE olt_id = $1 AND empresa_id = $2 AND deleted_at IS NULL
          AND estado = 'ocupado'
          AND ip_address BETWEEN $3::inet AND $4::inet
        LIMIT 5`,
      [oltId, empresaId, dto.inicio, dto.fin],
    );
    if (ocupadas.length > 0) {
      throw new UnprocessableEntityException(
        `El tramo ${dto.inicio}-${dto.fin} tiene ${ocupadas.length}+ IP(s) en uso por ONUs vivas ` +
        `(p.ej. ${ocupadas[0].ip_address}). Desaprovisiona o desactiva su carril antes de retirarlo.`,
      );
    }

    const filas = await this.ds.query<Array<{ ip_address: string }>>(
      `UPDATE olt_mgmt_ip_pool
          SET deleted_at = NOW(), updated_at = NOW(), version = version + 1
        WHERE olt_id = $1 AND empresa_id = $2 AND deleted_at IS NULL
          AND estado = 'libre'
          AND ip_address BETWEEN $3::inet AND $4::inet
        RETURNING ip_address::text`,
      [oltId, empresaId, dto.inicio, dto.fin],
    );
    const retiradas = filasUpdateReturning<{ ip_address: string }>(filas).length;
    this.logger.log(`Mgmt IP pool retirar | olt=${oltId} rango=${dto.inicio}-${dto.fin} retiradas=${retiradas}`);
    return { retiradas };
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

  // ── listar ────────────────────────────────────────────────────────
  // Detalle del segmento de gestión: qué IP tiene cada ONU y qué queda libre. Hasta ahora el
  // pool solo se podía observar como tres contadores, así que la pregunta operativa más
  // corriente —"¿quién tiene la 10.16.4.37?"— solo se respondía consultando la base de datos.
  // Con el carril inyectado en cada aprovisionamiento este pool pasa a ser un recurso de
  // primera línea: se agota, se dimensiona y se audita, y nada de eso se puede hacer a ciegas.
  async listar(
    oltId:     string,
    empresaId: string,
    filtros:   { estado?: 'libre' | 'ocupado'; q?: string; page?: number; limit?: number } = {},
  ): Promise<{ items: MgmtIpItem[]; total: number; page: number; limit: number; rango: { desde: string | null; hasta: string | null } }> {
    const page  = Math.max(1, filtros.page ?? 1);
    const limit = Math.min(200, Math.max(1, filtros.limit ?? 50));

    // El filtro de texto busca por lo que el operador tiene a mano en cada caso: la IP que ve
    // en un log, el SN de la etiqueta de la ONU, el número de contrato o el nombre del cliente.
    const where: string[] = ['p.olt_id = $1', 'p.empresa_id = $2', 'p.deleted_at IS NULL'];
    const params: any[] = [oltId, empresaId];
    if (filtros.estado) {
      params.push(filtros.estado);
      where.push(`p.estado = $${params.length}`);
    }
    if (filtros.q?.trim()) {
      params.push(`%${filtros.q.trim()}%`);
      const i = params.length;
      where.push(`(host(p.ip_address) ILIKE $${i} OR r.sn ILIKE $${i} OR co.numero_contrato ILIKE $${i} OR cl.nombre_completo ILIKE $${i})`);
    }
    const filtro = where.join(' AND ');

    const base = `
      FROM olt_mgmt_ip_pool p
      LEFT JOIN ftth_onu_registro r ON r.contrato_id = p.contrato_id AND r.deleted_at IS NULL
      LEFT JOIN contratos co        ON co.id = p.contrato_id
      LEFT JOIN clientes cl         ON cl.id = co.cliente_id
      WHERE ${filtro}`;

    const [conteo] = await this.ds.query<Array<{ n: string; desde: string | null; hasta: string | null }>>(
      `SELECT COUNT(*)::text AS n,
              host(MIN(p.ip_address)) AS desde,
              host(MAX(p.ip_address)) AS hasta
       ${base}`,
      params,
    );

    params.push(limit, (page - 1) * limit);
    const items = await this.ds.query<MgmtIpItem[]>(
      `SELECT host(p.ip_address) AS "ip",
              p.estado           AS "estado",
              p.contrato_id      AS "contratoId",
              co.numero_contrato AS "numeroContrato",
              cl.nombre_completo AS "cliente",
              r.sn               AS "sn",
              r.onu_id           AS "onuId",
              r.slot, r.port,
              r.carril_estado    AS "carrilEstado",
              p.updated_at       AS "actualizado"
       ${base}
       ORDER BY p.ip_address
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items,
      total: Number(conteo?.n ?? 0),
      page, limit,
      rango: { desde: conteo?.desde ?? null, hasta: conteo?.hasta ?? null },
    };
  }
}
