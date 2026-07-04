import { Injectable, Logger }  from '@nestjs/common';
import { InjectDataSource }     from '@nestjs/typeorm';
import { DataSource }           from 'typeorm';
import { Cron }                 from '@nestjs/schedule';

import { PppoeService }         from '../mikrotik/services/pppoe.service';
import { FirewallService }      from '../mikrotik/services/firewall.service';
import { SmartoltApiService }   from '../smartolt/smartolt-api.service';
import { decrypt }              from '../../common/utils/encryption.util';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface ContratoRow {
  id:               string;
  empresa_id:       string;
  estado:           string;
  ip_asignada:      string | null;
  usuario_pppoe:    string | null;
  mac_address:      string | null;
  tipo_auth:        string | null;
  onu_id:           string | null;
  onu_smartolt_id:  string | null;  // id externo en SmartOLT
  olt_id:           string | null;  // id del OLT al que pertenece la ONU
  router_id:        string | null;
  router_ip:        string | null;
  router_vpn_ip:    string | null;
  router_usuario:   string | null;
  router_pass_enc:  string | null;
  router_ssl:       boolean;
  router_port:      number;
  router_port_ssl:  number;
  router_timeout:   number;
  router_version:   string;
  tipo_control:     string | null;
}

type HwEstado = 'ok' | 'inconsistente' | 'desconocido' | 'sin_hardware';

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable()
export class ReconciliadorService {
  private readonly logger = new Logger(ReconciliadorService.name);
  private corriendo = false; // guard anti-solapamiento

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly pppoeSvc:    PppoeService,
    private readonly firewallSvc: FirewallService,
    private readonly smartoltApi: SmartoltApiService,
  ) {}

  // ── Cron: cada 15 minutos ─────────────────────────────────────
  @Cron('0 */15 * * * *')
  async reconciliar(): Promise<void> {
    if (this.corriendo) {
      this.logger.warn('[Reconciliador] Ciclo anterior aún en curso — saltando');
      return;
    }
    this.corriendo = true;
    const inicio   = Date.now();
    let procesados = 0;
    let correcciones = 0;
    const errores: string[] = [];

    try {
      // Tomamos hasta 20 contratos activos/suspendidos/morosos/cortados cuya
      // verificación sea antigua (>30 min) o nunca hecha, con SKIP LOCKED para
      // no bloquear operaciones concurrentes.
      const contratos = await this.ds.query<ContratoRow[]>(`
        SELECT
          co.id, co.empresa_id, co.estado,
          co.ip_asignada, co.usuario_pppoe, co.mac_address,
          co.tipo_auth, co.onu_id, co.router_id,
          on_.smartolt_onu_id AS onu_smartolt_id,
          ol.smartolt_id      AS olt_id,
          ro.ip_gestion     AS router_ip,
          ro.vpn_ip         AS router_vpn_ip,
          ro.usuario        AS router_usuario,
          ro.password_cifrado AS router_pass_enc,
          ro.usar_ssl       AS router_ssl,
          ro.puerto_api     AS router_port,
          ro.puerto_api_ssl AS router_port_ssl,
          ro.timeout_conexion AS router_timeout,
          ro.version_ros    AS router_version,
          ro.tipo_control   AS tipo_control
        FROM contratos co
        LEFT JOIN routers ro ON ro.id = co.router_id
        LEFT JOIN onus    on_ ON on_.id = co.onu_id
        LEFT JOIN olts    ol  ON ol.id  = on_.olt_id
        WHERE co.deleted_at IS NULL
          AND co.estado IN ('activo','suspendido','moroso','cortado')
          AND (
                co.hardware_verificado_en IS NULL
             OR co.hardware_verificado_en < NOW() - INTERVAL '30 minutes'
          )
        ORDER BY co.hardware_verificado_en NULLS FIRST
        LIMIT 20
        FOR UPDATE OF co SKIP LOCKED
      `);

      if (contratos.length === 0) return;

      this.logger.log(`[Reconciliador] Verificando ${contratos.length} contrato(s)`);

      for (const c of contratos) {
        try {
          const { hwEstado, correcciones: cor } = await this.verificarContrato(c);
          await this.ds.query(`
            UPDATE contratos
            SET hardware_verificado = $2,
                hardware_verificado_en = NOW(),
                hardware_estado = $3
            WHERE id = $1
          `, [c.id, hwEstado === 'ok', hwEstado]);
          procesados++;
          correcciones += cor;
        } catch (e: any) {
          errores.push(`${c.id}: ${e?.message?.slice(0, 200)}`);
          this.logger.warn(`[Reconciliador] Error verificando ${c.id}: ${e?.message}`);
        }
      }
    } finally {
      this.corriendo = false;
      const durMs = Date.now() - inicio;
      await this.registrarLog(procesados, correcciones, errores, durMs);
      this.logger.log(
        `[Reconciliador] Ciclo completado — procesados=${procesados} correcciones=${correcciones} errores=${errores.length} dur=${durMs}ms`,
      );
    }
  }

  // ── Verificación individual ────────────────────────────────────
  private async verificarContrato(c: ContratoRow): Promise<{ hwEstado: HwEstado; correcciones: number }> {
    let correcciones = 0;
    const problemas: string[] = [];

    // ── 1. Verificar MikroTik (solo si tiene router y tipo PPPoE)
    if (c.router_id && (c.tipo_auth === 'pppoe' || c.tipo_control === 'pppoe_addresslist' || c.tipo_control === 'pppoe')) {
      const creds = this.buildCreds(c);
      if (creds && c.usuario_pppoe) {
        try {
          const secrets = await this.pppoeSvc.listarSecrets(creds, c.usuario_pppoe);
          const existe = secrets.length > 0;
          const debeExistir = ['activo', 'moroso'].includes(c.estado);
          if (!existe && debeExistir) {
            problemas.push(`PPPoE secret "${c.usuario_pppoe}" ausente en router (estado: ${c.estado})`);
          } else if (existe && c.estado === 'cortado') {
            // CORTADO: el secret debe estar deshabilitado o eliminado
            problemas.push(`PPPoE secret "${c.usuario_pppoe}" activo en router pese a estado CORTADO`);
          }
        } catch (e: any) {
          // Router inalcanzable — no es inconsistencia del contrato, es del router
          return { hwEstado: 'desconocido', correcciones: 0 };
        }
      }
    }

    // ── 2. Verificar SmartOLT / OLT (solo si tiene onu con IDs externos)
    if (c.onu_id && c.onu_smartolt_id && c.olt_id) {
      try {
        const onu = await this.smartoltApi.getOnu(c.olt_id, c.onu_smartolt_id);
        const onuActiva = (onu as any)?.online ?? false;
        if (c.estado === 'activo' && !onuActiva) {
          problemas.push(`ONU ${c.onu_smartolt_id} offline en SmartOLT pese a estado ACTIVO`);
        }
      } catch {
        // SmartOLT degradado o IDs inválidos — ignorar para este ciclo
      }
    }

    // ── 3. Sin hardware asignado
    const tienHardware = Boolean(c.router_id || c.onu_id);
    if (!tienHardware) {
      return { hwEstado: 'sin_hardware', correcciones: 0 };
    }

    if (problemas.length > 0) {
      this.logger.warn(`[Reconciliador] INCONSISTENCIA contrato=${c.id} empresa=${c.empresa_id}: ${problemas.join(' | ')}`);
      correcciones++;
      return { hwEstado: 'inconsistente', correcciones };
    }

    return { hwEstado: 'ok', correcciones: 0 };
  }

  // ── Helpers ────────────────────────────────────────────────────
  private buildCreds(c: ContratoRow) {
    if (!c.router_id || !c.router_ip) return null;
    let password = '';
    try { password = decrypt(c.router_pass_enc ?? ''); } catch { password = c.router_pass_enc ?? ''; }
    return {
      id:              c.router_id,
      ip:              c.router_vpn_ip || c.router_ip,
      port:            c.router_ssl ? (c.router_port_ssl ?? 8729) : (c.router_port ?? 8728),
      user:            c.router_usuario ?? 'admin',
      passwordCifrado: c.router_pass_enc ?? '',
      useSsl:          c.router_ssl ?? false,
      timeoutSec:      c.router_timeout ?? 10,
      version:         (c.router_version === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };
  }

  // ── Cron: divergencias ONU↔contrato (FTTH) cada 30 min ────────
  // A nivel de conjunto (no por-fila): detecta y REPORTA, no corrige en caliente.
  //  1) ONU aprovisionada cuyo contrato ya no está vigente (baja/eliminado).
  //  2) Contrato FTTH activo sin ONU aprovisionada.
  @Cron('0 */30 * * * *')
  async reconciliarFtthOnu(): Promise<void> {
    const inicio = Date.now();
    const divergencias: string[] = [];
    const estadosProvisionada = "('activo','suspendido','gpon_registrado','wan_inyectado')";
    try {
      // 1) ONUs físicas sin contrato vigente (huérfanas).
      const huerfanas = await this.ds.query<any[]>(`
        SELECT f.contrato_id, f.olt_id, f.sn, f.estado AS onu_estado,
               co.estado AS contrato_estado
        FROM   ftth_onu_registro f
        LEFT   JOIN contratos co ON co.id = f.contrato_id
        WHERE  f.estado IN ${estadosProvisionada}
          AND (co.id IS NULL OR co.estado = 'baja_definitiva' OR co.deleted_at IS NOT NULL)
      `);
      for (const h of huerfanas) {
        divergencias.push(
          `ONU sin contrato vigente: sn=${h.sn} olt=${h.olt_id} contrato=${h.contrato_id} ` +
          `(contrato=${h.contrato_estado ?? 'inexistente'}, onu=${h.onu_estado})`,
        );
      }

      // 2) Contratos FTTH activos sin ONU aprovisionada.
      const sinOnu = await this.ds.query<any[]>(`
        SELECT co.id, co.numero_contrato
        FROM   contratos co
        WHERE  co.deleted_at IS NULL
          AND  co.estado = 'activo'
          AND  co.tipo_servicio = 'ftth'
          AND  NOT EXISTS (
                 SELECT 1 FROM ftth_onu_registro f
                 WHERE f.contrato_id = co.id AND f.estado IN ${estadosProvisionada}
               )
      `);
      for (const s of sinOnu) {
        divergencias.push(`Contrato FTTH activo sin ONU: ${s.numero_contrato} (${s.id})`);
      }

      if (divergencias.length > 0) {
        this.logger.warn(
          `[Reconciliador FTTH] ${divergencias.length} divergencia(s) ONU↔contrato:\n  - ` +
          divergencias.join('\n  - '),
        );
      } else {
        this.logger.log('[Reconciliador FTTH] Sin divergencias ONU↔contrato');
      }
      await this.registrarLog(divergencias.length, 0, divergencias, Date.now() - inicio);
    } catch (e: any) {
      this.logger.error(`[Reconciliador FTTH] Error: ${e?.message}`);
    }
  }

  private async registrarLog(procesados: number, correcciones: number, errores: string[], durMs: number): Promise<void> {
    await this.ds.query(`
      INSERT INTO reconciliation_log (procesados, correcciones, errores, duracion_ms, ejecutado_en)
      VALUES ($1, $2, $3, $4, NOW())
    `, [procesados, correcciones, JSON.stringify(errores), durMs]).catch(() => void 0);
  }
}
