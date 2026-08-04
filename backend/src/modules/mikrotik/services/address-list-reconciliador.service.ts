import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cron } from '@nestjs/schedule';

import { RouterConnectionPool, RouterCredentials } from './connection-pool.service';
import { ADDRESS_LIST_MOROSOS, ADDRESS_LIST_PRORROGA } from './firewall.service';
import { WatcherHeartbeatService } from '../../../common/services/watcher-heartbeat.service';

// ─────────────────────────────────────────────────────────────
// Reconciliador de address-lists — SOLO REPORTA, no borra nada.
//
// Origen (2026-07-30): la baja de un contrato limpia la IP de las address-lists, pero si
// el router está caído en ese momento la limpieza se pierde. El reintento existía sobre
// el papel y nunca llegó a encolarse (se insertaba `routerId = 'none'` contra una columna
// uuid y el error se tragaba), así que una IP podía quedarse en `prorroga_datafast` para
// siempre. Peor: si después se elimina al cliente, desaparece la fila desde la que se
// podría deducir que sobra.
//
// Un reintento solo arregla lo que alguien encoló bien. Esto observa el estado REAL del
// router y lo compara con los contratos vivos, así que también ve la basura que dejaron
// las bajas anteriores — incluida la de un cliente que ya no existe en la BD.
//
// ── Por qué no borra ──
// Quitar una IP de `morosos_datafast` DEVUELVE el servicio: un falso positivo aquí le
// regala internet a un moroso. Y quitarla de `prorroga_datafast` puede cortárselo a quien
// sí pagó. La primera versión reporta y deja que un humano decida; automatizar el borrado
// exige antes ver varios ciclos de este informe en limpio.
//
// ── Alcance ──
// SOLO las listas que el ERP escribe (las mismas que limpia `reactivarCliente`). El Router
// Malvinas tiene además una lista `morosos` a secas con 20 entradas del sistema anterior,
// puestas a mano y ajenas al ERP: tocarlas —o siquiera reportarlas como sobrantes— sería
// opinar sobre algo que este código no gestiona.
// ─────────────────────────────────────────────────────────────

const LISTAS_DEL_ERP = [ADDRESS_LIST_MOROSOS, ADDRESS_LIST_PRORROGA, 'prorroga'] as const;

/** Estados en los que una IP SÍ debe estar en la lista de morosos. */
const ESTADOS_CORTADOS = ['suspendido', 'cortado', 'moroso'];

export interface EntradaSobrante {
  routerId:   string;
  routerNombre: string;
  lista:      string;
  ip:         string;
  comentario: string;
  /** Por qué sobra, en términos del negocio. */
  motivo:     string;
}

export interface InformeAddressLists {
  sobrantes:   EntradaSobrante[];
  /** Routers efectivamente revisados. Sin esto, `sobrantes: []` es ambiguo. */
  revisados:   string[];
  /** Routers cuyo estado se desconoce, con el motivo. */
  noRevisados: Array<{ router: string; motivo: string }>;
}

interface FilaRouter {
  id: string; nombre: string; empresa_id: string;
  ip_gestion: string | null; vpn_ip: string | null;
  usuario: string | null; password_cifrado: string | null;
  usar_ssl: boolean | null; puerto_api: number | null; puerto_api_ssl: number | null;
  version_ros: string | null; timeout_conexion: number | null;
}

@Injectable()
export class AddressListReconciliadorService {
  private readonly logger = new Logger(AddressListReconciliadorService.name);
  private enCurso = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly pool: RouterConnectionPool,
    private readonly hb:   WatcherHeartbeatService,
  ) {}

  // A las 04:40: después del sync de OLT de las 00:50 y fuera de la ventana de
  // facturación, para no competir por las sesiones del router.
  @Cron('40 4 * * *')
  async reconciliarDiario(): Promise<void> {
    if (process.env.RUN_CRONS !== 'true') return;
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.hb.ejecutar('address-list-reconciliador', 86400, async () => {
        const inf = await this.revisarTodos();
        // El latido guarda los tres números: "0 sobrantes" con routers sin revisar no es
        // lo mismo que "0 sobrantes" habiéndolos mirado todos.
        return {
          sobrantes:   inf.sobrantes.length,
          revisados:   inf.revisados.length,
          noRevisados: inf.noRevisados.length,
        };
      });
    } finally {
      this.enCurso = false;
    }
  }

  /**
   * Revisa todos los routers activos. Nunca lanza: un router caído no cancela el resto.
   *
   * Devuelve también qué NO se pudo revisar. La primera versión devolvía solo la lista de
   * sobrantes, y con el router ilegible informaba `[]` — indistinguible de "todo limpio".
   * Un informe que no puede fallar en voz alta es peor que no tenerlo: da tranquilidad
   * sin haber mirado.
   */
  async revisarTodos(): Promise<InformeAddressLists> {
    const routers = await this.ds.query<FilaRouter[]>(
      `SELECT id, nombre, empresa_id, ip_gestion, vpn_ip, usuario, password_cifrado,
              usar_ssl, puerto_api, puerto_api_ssl, version_ros, timeout_conexion
         FROM routers
        WHERE deleted_at IS NULL AND activo = true`,
    ).catch(() => []);

    const informe: InformeAddressLists = { sobrantes: [], revisados: [], noRevisados: [] };

    for (const router of routers) {
      try {
        informe.sobrantes.push(...await this.revisarRouter(router));
        informe.revisados.push(router.nombre);
      } catch (e: any) {
        // Un router inalcanzable no es un hallazgo: es falta de información. Se dice, y
        // no se concluye nada sobre sus listas.
        informe.noRevisados.push({ router: router.nombre, motivo: e?.message ?? 'error desconocido' });
        this.logger.warn(`[AddressList] no se pudo revisar ${router.nombre}: ${e?.message}`);
      }
    }

    if (informe.sobrantes.length > 0) {
      this.logger.warn(
        `[AddressList] ${informe.sobrantes.length} entrada(s) sobrante(s) — NO se borra nada, revisar:`,
      );
      for (const s of informe.sobrantes) {
        this.logger.warn(
          `[AddressList]   ${s.routerNombre} | ${s.lista} | ${s.ip} | ${s.motivo}`
          + (s.comentario ? ` | comentario: "${s.comentario}"` : ''),
        );
      }
    } else if (informe.revisados.length > 0) {
      this.logger.log(
        `[AddressList] listas del ERP limpias en: ${informe.revisados.join(', ')}`,
      );
    }

    if (informe.noRevisados.length > 0) {
      this.logger.warn(
        `[AddressList] ${informe.noRevisados.length} router(s) SIN revisar — su estado se desconoce`,
      );
    }
    return informe;
  }

  private async revisarRouter(router: FilaRouter): Promise<EntradaSobrante[]> {
    const creds: RouterCredentials = {
      id:              router.id,
      ip:              router.vpn_ip || router.ip_gestion || '',
      port:            router.usar_ssl ? (router.puerto_api_ssl ?? 8729) : (router.puerto_api ?? 8728),
      user:            router.usuario ?? 'admin',
      passwordCifrado: router.password_cifrado ?? '',
      useSsl:          router.usar_ssl ?? false,
      timeoutSec:      router.timeout_conexion ?? 15,
      version:         (router.version_ros === 'v7' ? 'v7' : 'v6') as 'v6' | 'v7',
    };

    // Una sola sesión para las tres listas: el pool serializa por router y abrir tres
    // conexiones seguidas es justo lo que satura un MikroTik cargado.
    const entradas = await this.pool.execute(creds, async (api) => {
      const acc: Array<{ lista: string; ip: string; comentario: string }> = [];
      for (const lista of LISTAS_DEL_ERP) {
        const filas = await api.write('/ip/firewall/address-list/print', [`?list=${lista}`]);
        for (const f of filas as any[]) {
          acc.push({ lista, ip: f.address, comentario: f.comment || '' });
        }
      }
      return acc;
    });

    if (entradas.length === 0) return [];

    // Un único SELECT para todas las IPs: N consultas por N entradas es lo que convierte
    // un informe en un problema de rendimiento cuando el parque crece.
    const ips = [...new Set(entradas.map((e) => e.ip))];
    const contratos = await this.ds.query<
      Array<{ ip_asignada: string; estado: string; en_prorroga: boolean }>
    >(
      // `ip_asignada` es `inet`, no texto: sin el cast Postgres responde
      // «operator does not exist: inet = text» y la revisión entera se cae.
      `SELECT ip_asignada::text AS ip_asignada, estado::text AS estado, en_prorroga
         FROM contratos
        WHERE router_id = $1
          AND ip_asignada::text = ANY($2::text[])
          AND deleted_at IS NULL
          AND estado <> 'baja_definitiva'`,
      [router.id, ips],
    );
    const porIp = new Map(contratos.map((c) => [c.ip_asignada, c]));

    const sobrantes: EntradaSobrante[] = [];
    for (const e of entradas) {
      const contrato = porIp.get(e.ip);
      const motivo = this.evaluar(e.lista, contrato);
      if (motivo) {
        sobrantes.push({
          routerId: router.id, routerNombre: router.nombre,
          lista: e.lista, ip: e.ip, comentario: e.comentario, motivo,
        });
      }
    }
    return sobrantes;
  }

  /** Devuelve el motivo por el que la entrada sobra, o null si es legítima. */
  private evaluar(
    lista: string,
    contrato?: { estado: string; en_prorroga: boolean },
  ): string | null {
    if (!contrato) {
      return 'no hay contrato vivo con esa IP en este router '
           + '(dado de baja, eliminado, o la IP se reasignó)';
    }

    if (lista === ADDRESS_LIST_MOROSOS) {
      return ESTADOS_CORTADOS.includes(contrato.estado)
        ? null
        : `el contrato está "${contrato.estado}", no cortado: la IP no debería estar bloqueada`;
    }

    // prorroga_datafast y la lista legada 'prorroga'
    return contrato.en_prorroga
      ? null
      : 'el contrato no está en prórroga: la excepción sobra';
  }
}
