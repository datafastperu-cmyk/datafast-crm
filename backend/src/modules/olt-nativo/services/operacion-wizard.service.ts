import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type TipoOperacionWizard = 'ftth_provision' | 'router_vpn' | 'olt_wizard';

export type EstadoOperacionWizard =
  | 'en_curso'
  | 'confirmado'
  | 'anulando'
  | 'anulado'
  | 'anulacion_fallida';

export interface OperacionWizardRow {
  id:           string;
  empresa_id:   string;
  usuario_id:   string | null;
  tipo:         TipoOperacionWizard;
  recurso_ref:  string;
  estado:       EstadoOperacionWizard;
  heartbeat_at: Date;
  expira_en:    Date;
  techo_en:     Date;
}

// ─────────────────────────────────────────────────────────────
// OperacionWizardService — Fase 1 de la directriz de wizards.
//
// Representa un PROCEDIMIENTO del operador (no una operación suelta): tiene dueño,
// recurso, señal de vida y una frontera de confirmación explícita.
//
// Reglas de diseño (ver CLAUDE.md § Wizards y Modales):
//  · El servidor es la autoridad. El heartbeat NO autoriza nada: solo SUPRIME los barridos
//    mientras hay un operador demostrablemente a cargo. Si el navegador calla, el servidor
//    decide solo — por eso la anulación real la dispara el vencimiento del TTL en el
//    servidor, nunca un `sendBeacon` best-effort del navegador (que además no puede
//    ejecutar trabajo asíncrono fiable en `beforeunload`).
//  · Dos relojes: `expira_en` lo renueva el heartbeat; `techo_en` NO se renueva jamás.
//    Pasado el techo el barrido procede aunque el heartbeat siga latiendo, para que una
//    pestaña olvidada no bloquee un recurso indefinidamente.
//  · La frontera de confirmación es el ESTADO TERMINAL VERIFICADO del recurso, no el clic:
//    quien llama a `confirmar()` debe haberlo comprobado (en FTTH, `estado = activo`).
//
// Fase 1 es ADITIVA: registra el procedimiento y suprime el barrido. La bitácora de
// compensación (deshacer paso a paso) llega en la Fase 2.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OperacionWizardService {
  private readonly logger = new Logger(OperacionWizardService.name);

  /** Ventana del heartbeat, alineada con la sesión del operador (30 min). */
  private readonly TTL_MINUTOS = 30;
  /** Techo absoluto: ningún procedimiento se suprime más allá de esto, late o no. */
  private readonly TECHO_HORAS = 4;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Abre un procedimiento sobre un recurso. Si ya hay uno EN CURSO para ese recurso, se
   * rechaza (409): dos wizards simultáneos sobre la misma ONU es justo lo que produce
   * discordancia físico↔lógico.
   */
  async abrir(
    empresaId:  string,
    tipo:       TipoOperacionWizard,
    recursoRef: string,
    usuarioId?: string | null,
  ): Promise<OperacionWizardRow> {
    // Cierra primero cualquier procedimiento del mismo recurso que ya haya superado su
    // vida útil: sin esto, un wizard abandonado bloquearía al operador que llega después.
    await this._vencerAbandonados(recursoRef);

    try {
      const [row] = await this.ds.query<OperacionWizardRow[]>(
        `INSERT INTO operacion_wizard
           (empresa_id, usuario_id, tipo, recurso_ref, estado, heartbeat_at, expira_en, techo_en)
         VALUES ($1, $2, $3, $4, 'en_curso', NOW(),
                 NOW() + ($5 || ' minutes')::interval,
                 NOW() + ($6 || ' hours')::interval)
         RETURNING id, empresa_id, usuario_id, tipo, recurso_ref, estado,
                   heartbeat_at, expira_en, techo_en`,
        [empresaId, usuarioId ?? null, tipo, recursoRef,
         String(this.TTL_MINUTOS), String(this.TECHO_HORAS)],
      );
      this.logger.log(`Wizard abierto | id=${row.id} tipo=${tipo} recurso=${recursoRef}`);
      return row;
    } catch (e: any) {
      // Violación del índice parcial único (recurso_ref) WHERE estado='en_curso'.
      if (e?.code === '23505') {
        throw new ConflictException(
          'Ya hay un procedimiento abierto sobre este recurso. Ciérralo antes de iniciar otro — ' +
          'dos wizards a la vez sobre la misma ONU dejan la OLT y el ERP desincronizados.',
        );
      }
      throw e;
    }
  }

  /**
   * Señal de vida del navegador. Renueva `expira_en` pero NUNCA `techo_en`.
   * Devuelve false si el procedimiento ya no está vivo (vencido, confirmado o cerrado),
   * para que el frontend sepa que perdió la titularidad y deje de latir.
   */
  async heartbeat(id: string): Promise<boolean> {
    const filas = await this.ds.query<{ id: string }[]>(
      `UPDATE operacion_wizard
       SET heartbeat_at = NOW(),
           expira_en    = NOW() + ($2 || ' minutes')::interval,
           updated_at   = NOW()
       WHERE id = $1
         AND estado   = 'en_curso'
         AND techo_en > NOW()
       RETURNING id`,
      [id, String(this.TTL_MINUTOS)],
    );
    return filas.length > 0;
  }

  /**
   * Marca el procedimiento como CONFIRMADO. A partir de aquí su trabajo es irrevocable por
   * cierre: cerrar el modal ya no anula nada.
   *
   * Quien llama debe haber verificado el estado terminal real del recurso (VIO) — este
   * servicio no lo comprueba porque no conoce la máquina de estados de cada dominio.
   */
  async confirmar(id: string): Promise<void> {
    const filas = await this.ds.query<{ id: string }[]>(
      `UPDATE operacion_wizard
       SET estado = 'confirmado', cerrado_en = NOW(), updated_at = NOW()
       WHERE id = $1 AND estado = 'en_curso'
       RETURNING id`,
      [id],
    );
    if (filas.length === 0) {
      throw new NotFoundException('No hay un procedimiento en curso con ese identificador.');
    }
    this.logger.log(`Wizard confirmado | id=${id}`);
  }

  /**
   * Cierra el procedimiento sin confirmarlo. En Fase 1 solo lo marca; la anulación real
   * (compensaciones LIFO) llega en Fase 2 — hasta entonces la red de seguridad sigue
   * siendo `FtthRecoveryCron`, que al dejar de estar suprimido revierte el trabajo.
   */
  async cerrarSinConfirmar(id: string, motivo: string): Promise<void> {
    await this.ds.query(
      `UPDATE operacion_wizard
       SET estado = 'anulando', cerrado_en = NOW(), motivo_cierre = $2, updated_at = NOW()
       WHERE id = $1 AND estado = 'en_curso'`,
      [id, motivo],
    );
    this.logger.warn(`Wizard cerrado SIN confirmar | id=${id} motivo=${motivo}`);
  }

  /**
   * ¿Hay un operador a cargo de este recurso ahora mismo?
   * Es la consulta que usan los barridos para NO pisar a alguien que está trabajando.
   * Vivo = en curso + heartbeat vigente + dentro del techo absoluto.
   */
  async estaVivo(recursoRef: string): Promise<boolean> {
    const [row] = await this.ds.query<{ vivo: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM operacion_wizard
         WHERE recurso_ref = $1
           AND estado      = 'en_curso'
           AND expira_en   > NOW()
           AND techo_en    > NOW()
       ) AS vivo`,
      [recursoRef],
    );
    return row?.vivo === true;
  }

  /** Variante en lote: devuelve el subconjunto de recursos con wizard vivo (1 sola query). */
  async filtrarVivos(recursoRefs: string[]): Promise<Set<string>> {
    if (recursoRefs.length === 0) return new Set();
    const filas = await this.ds.query<{ recurso_ref: string }[]>(
      `SELECT DISTINCT recurso_ref FROM operacion_wizard
       WHERE recurso_ref = ANY($1::varchar[])
         AND estado    = 'en_curso'
         AND expira_en > NOW()
         AND techo_en  > NOW()`,
      [recursoRefs],
    );
    return new Set(filas.map((f) => f.recurso_ref));
  }

  /** Marca como vencidos los procedimientos que dejaron de latir o superaron el techo. */
  private async _vencerAbandonados(recursoRef?: string): Promise<number> {
    const filas = await this.ds.query<{ id: string }[]>(
      `UPDATE operacion_wizard
       SET estado = 'anulando', cerrado_en = NOW(), updated_at = NOW(),
           motivo_cierre = COALESCE(motivo_cierre,
             CASE WHEN techo_en <= NOW()
                  THEN 'Techo absoluto superado (procedimiento abandonado)'
                  ELSE 'Sin heartbeat: navegador o sesión caídos' END)
       WHERE estado = 'en_curso'
         AND (expira_en <= NOW() OR techo_en <= NOW())
         ${recursoRef ? 'AND recurso_ref = $1' : ''}
       RETURNING id`,
      recursoRef ? [recursoRef] : [],
    );
    return filas.length;
  }

  /** Barrido periódico (lo invoca el cron). Devuelve cuántos venció. */
  async vencerAbandonados(): Promise<number> {
    const n = await this._vencerAbandonados();
    if (n > 0) this.logger.warn(`Wizards vencidos por inactividad: ${n}`);
    return n;
  }
}
