import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EntityVersion } from './entities/entity-version.entity';
import { AuditoriaLog } from '../usuarios/entities/auditoria-log.entity';
import { FiltrosAuditoriaDto } from './dto/auditoria.dto';

// Tablas permitidas para operaciones de undo/redo/papelera
const TABLA_SEGURA = new Set([
  'clientes', 'servicios', 'facturas', 'pagos', 'planes', 'tickets',
]);

// Campos que NO se restauran al hacer undo (invariantes del sistema)
const CAMPOS_EXCLUIDOS = new Set([
  'id', 'empresa_id', 'created_at', 'updated_at',
]);

// Display name por tabla para la papelera
const DISPLAY_SQL: Record<string, string> = {
  clientes:   `COALESCE(CONCAT(nombres, ' ', apellido_paterno), nombre_completo, 'Sin nombre')`,
  contratos:  `COALESCE(numero_contrato, id::text)`,
  facturas:   `COALESCE(numero_completo, id::text)`,
  pagos:      `CONCAT('S/. ', monto)`,
  planes:     `COALESCE(nombre, id::text)`,
  tickets:    `COALESCE(asunto, id::text)`,
};

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(
    @InjectRepository(EntityVersion)
    private readonly versionRepo: Repository<EntityVersion>,
    @InjectRepository(AuditoriaLog)
    private readonly logRepo: Repository<AuditoriaLog>,
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  // ── Audit log paginado ────────────────────────────────────────
  async getLogs(empresaId: string, filtros: FiltrosAuditoriaDto = {}) {
    const {
      page = 1, limit = 50, search, modulo, accion, usuarioId, desde, hasta,
      soloNegocio, origen,
    } = filtros;
    const offset = (page - 1) * limit;

    const params: any[] = [empresaId];
    let   pIdx          = 2;

    // El AuditInterceptor escribe una fila por CADA request HTTP, con la descripción
    // "POST /api/v1/... (123ms)". Eso es un access log, no actividad de negocio, y supone
    // el 95% de la tabla: sin separarlo, buscar quién cobró o a quién se cortó es
    // imposible. La clasificación la pone quien ESCRIBE (columna `tipo`), no se adivina
    // aquí por la forma del texto. Solo aplica a `auditoria_logs`: las demás fuentes son
    // todas de negocio.
    const filtroRuido = soloNegocio
      ? `AND a.tipo = 'negocio'`
      : '';

    // Filtros comunes, ya sobre el conjunto unificado.
    const conditions: string[] = [];

    // Sin usuario = lo hizo el sistema (cron, worker, watcher). Es la distinción que pide
    // el operador cuando pregunta "¿esto lo hizo alguien o se hizo solo?".
    if (origen === 'sistema') {
      conditions.push(`(e.usuario_email IS NULL OR e.usuario_email = '')`);
    } else if (origen === 'usuario') {
      conditions.push(`(e.usuario_email IS NOT NULL AND e.usuario_email <> '')`);
    }

    if (search) {
      // Se busca también por el nombre del cliente afectado: es como lo busca una persona
      // ("qué pasó con Piero"), no por el UUID que guarda el registro.
      conditions.push(
        `(e.descripcion ILIKE $${pIdx} OR e.usuario_email ILIKE $${pIdx}` +
        ` OR e.entidad_id ILIKE $${pIdx}` +
        ` OR cl.nombre_completo ILIKE $${pIdx} OR cl_co.nombre_completo ILIKE $${pIdx}` +
        ` OR co.numero_contrato ILIKE $${pIdx})`,
      );
      params.push(`%${search}%`); pIdx++;
    }
    if (modulo)    { conditions.push(`e.modulo = $${pIdx}`);      params.push(modulo);    pIdx++; }
    if (accion)    { conditions.push(`e.accion = $${pIdx}`);      params.push(accion);    pIdx++; }
    if (usuarioId) { conditions.push(`e.usuario_id = $${pIdx}`);  params.push(usuarioId); pIdx++; }
    if (desde)     { conditions.push(`e.created_at >= $${pIdx}`); params.push(desde);     pIdx++; }
    if (hasta)     { conditions.push(`e.created_at <= $${pIdx}`); params.push(hasta);     pIdx++; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    /**
     * Vista unificada de la actividad del sistema.
     *
     * Tres tablas guardan hechos de negocio con formatos distintos, y cada una tiene
     * columnas propias que el formato genérico de auditoría no puede representar (estado
     * de entrega de un mensaje, estado anterior/nuevo de un contrato). En vez de
     * duplicar la escritura en `auditoria_logs` —que obligaría a tocar decenas de puntos y
     * haría que el log mienta por omisión en cuanto alguien olvidara uno—, se normalizan
     * AL LEER. Cada fuente sigue siendo dueña de su tabla.
     *
     * `reconciliation_log` queda fuera a propósito: son 755 filas al día comparando ERP y
     * hardware, y ahogarían la actividad real igual que hacía el ruido HTTP. Su sitio es
     * el panel de red.
     */
    const cte = `
      WITH eventos AS (
        -- 1. Auditoría: pagos, accesos, altas y bajas, cortes automáticos
        SELECT 'auditoria'::text AS fuente, a.id::text AS id, a.created_at,
               a.usuario_id::text AS usuario_id, a.usuario_email,
               a.modulo, a.accion, a.descripcion, a.entidad_id, a.ip_address
          FROM auditoria_logs a
         WHERE a.empresa_id = $1 ${filtroRuido}

        UNION ALL

        -- 2. Cambios de estado del servicio: quién cortó, reactivó o dio de baja. Vive en
        --    su tabla porque necesita el par estado_anterior/estado_nuevo.
        SELECT 'contrato', h.id::text, h.created_at,
               h.usuario_id::text, u.email,
               'servicios',
               CASE WHEN h.automatico THEN 'ESTADO_AUTO' ELSE 'ESTADO' END,
               h.estado_anterior::text || ' → ' || h.estado_nuevo::text ||
                 COALESCE(': ' || h.motivo, ''),
               h.servicio_id::text, NULL
          FROM servicios_historial h
          LEFT JOIN usuarios u ON u.id = h.usuario_id
         WHERE h.empresa_id = $1

        UNION ALL

        -- 3. Mensajes al abonado. El estado de entrega ES el evento: que un aviso de corte
        --    quedara sin enviar importa tanto como el corte.
        SELECT 'notificacion', n.id::text, n.created_at,
               NULL, NULL,
               'mensajeria',
               'MSG_' || UPPER(n.estado_entrega::text),
               n.tipo_template || ' → ' || COALESCE(n.telefono, 'sin teléfono') ||
                 COALESCE(' · ' || NULLIF(n.error_detalle, ''), ''),
               COALESCE(n.cliente_id::text, n.contrato_id::text), NULL
          FROM notificaciones_logs n
         WHERE n.empresa_id = $1
      )
      SELECT e.*,
             COALESCE(cl.nombre_completo, cl_co.nombre_completo, co.numero_contrato) AS entidad_nombre
        FROM eventos e
        -- entidad_id es texto y no siempre contiene un UUID, así que se castea solo cuando
        -- lo parece: un cast directo revienta la consulta entera con "invalid input syntax
        -- for type uuid" en cuanto aparece una fila con otro formato.
        LEFT JOIN clientes  cl    ON cl.id = NULLIF(e.entidad_id, '')::uuid
                                     AND e.entidad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        LEFT JOIN servicios co    ON co.id = NULLIF(e.entidad_id, '')::uuid
                                     AND e.entidad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        LEFT JOIN clientes  cl_co ON cl_co.id = co.cliente_id
        ${where}`;

    const [rows, [{ total }]] = await Promise.all([
      this.ds.query(
        `${cte} ORDER BY e.created_at DESC LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
        [...params, limit, offset],
      ),
      this.ds.query(
        `SELECT COUNT(*) AS total FROM (${cte}) sub`,
        params,
      ),
    ]);

    return {
      data:  rows,
      total: Number(total),
      page,
      limit,
      totalPages: Math.ceil(Number(total) / limit),
    };
  }

  /**
   * Cifras de cabecera del Log del Sistema y catálogo de filtros.
   *
   * No hay "niveles" (info/warning/error) en la tabla: inventarlos sería etiquetar a ojo.
   * Se cuenta lo que el operador realmente pregunta — cuánta actividad hubo hoy, cuánta la
   * hizo una persona y cuánta el sistema solo, y si hubo intentos de acceso fallidos.
   */
  async getResumen(empresaId: string) {
    const negocio = `tipo = 'negocio'`;

    // Las cifras cuentan las TRES fuentes que ve el listado; si contaran solo auditoría,
    // la cabecera diría menos eventos de los que la tabla muestra debajo.
    const [[cifras], catalogo] = await Promise.all([
      this.ds.query(
        `SELECT
           (SELECT COUNT(*) FROM auditoria_logs
             WHERE empresa_id = $1 AND ${negocio})
           + (SELECT COUNT(*) FROM servicios_historial WHERE empresa_id = $1)
           + (SELECT COUNT(*) FROM notificaciones_logs WHERE empresa_id = $1)   AS total,

           (SELECT COUNT(*) FROM auditoria_logs
             WHERE empresa_id = $1 AND ${negocio} AND created_at >= CURRENT_DATE)
           + (SELECT COUNT(*) FROM servicios_historial
               WHERE empresa_id = $1 AND created_at >= CURRENT_DATE)
           + (SELECT COUNT(*) FROM notificaciones_logs
               WHERE empresa_id = $1 AND created_at >= CURRENT_DATE)            AS hoy,

           (SELECT COUNT(*) FROM auditoria_logs
             WHERE empresa_id = $1 AND ${negocio} AND created_at >= CURRENT_DATE
               AND usuario_email IS NOT NULL AND usuario_email <> '')
           + (SELECT COUNT(*) FROM servicios_historial
               WHERE empresa_id = $1 AND created_at >= CURRENT_DATE
                 AND automatico = false)                                        AS hoy_usuarios,

           (SELECT COUNT(*) FROM auditoria_logs
             WHERE empresa_id = $1 AND ${negocio} AND created_at >= CURRENT_DATE
               AND (usuario_email IS NULL OR usuario_email = ''))
           + (SELECT COUNT(*) FROM servicios_historial
               WHERE empresa_id = $1 AND created_at >= CURRENT_DATE
                 AND automatico = true)
           + (SELECT COUNT(*) FROM notificaciones_logs
               WHERE empresa_id = $1 AND created_at >= CURRENT_DATE)            AS hoy_sistema,

           (SELECT COUNT(*) FROM auditoria_logs
             WHERE empresa_id = $1 AND accion = 'LOGIN_FAIL'
               AND created_at >= CURRENT_DATE - INTERVAL '7 days')              AS accesos_fallidos_semana,

           (SELECT COUNT(*) FROM auditoria_logs
             WHERE empresa_id = $1 AND NOT (${negocio}))                        AS peticiones_tecnicas,

           -- Mensajes que nunca salieron: un aviso de corte sin enviar es un problema
           -- operativo, no una anécdota técnica.
           (SELECT COUNT(*) FROM notificaciones_logs
             WHERE empresa_id = $1
               AND estado_entrega::text IN ('NO_ENVIADO', 'FALLIDO'))           AS mensajes_no_entregados`,
        [empresaId],
      ),
      this.ds.query(
        `SELECT DISTINCT modulo, accion FROM (
            SELECT modulo, accion FROM auditoria_logs
             WHERE empresa_id = $1 AND ${negocio}
            UNION ALL
            SELECT 'contratos',
                   CASE WHEN automatico THEN 'ESTADO_AUTO' ELSE 'ESTADO' END
              FROM servicios_historial WHERE empresa_id = $1
            UNION ALL
            SELECT 'mensajeria', 'MSG_' || UPPER(estado_entrega::text)
              FROM notificaciones_logs WHERE empresa_id = $1
         ) c WHERE modulo IS NOT NULL AND accion IS NOT NULL`,
        [empresaId],
      ),
    ]);

    const filas = catalogo as Array<{ modulo: string; accion: string }>;

    return {
      total:                  Number(cifras?.total ?? 0),
      hoy:                    Number(cifras?.hoy ?? 0),
      hoyUsuarios:            Number(cifras?.hoy_usuarios ?? 0),
      hoySistema:             Number(cifras?.hoy_sistema ?? 0),
      accesosFallidosSemana:  Number(cifras?.accesos_fallidos_semana ?? 0),
      peticionesTecnicas:     Number(cifras?.peticiones_tecnicas ?? 0),
      mensajesNoEntregados:   Number(cifras?.mensajes_no_entregados ?? 0),
      modulos:  [...new Set(filas.map((f) => f.modulo))].sort(),
      acciones: [...new Set(filas.map((f) => f.accion))].sort(),
    };
  }

  // ── Estado de undo/redo para un usuario ───────────────────────
  async getEstado(usuarioId: string, empresaId: string) {
    const [lastUndoable] = await this.ds.query(
      `SELECT id, accion, modulo, tabla, entidad_id, descripcion, created_at
       FROM entity_versions
       WHERE usuario_id = $1 AND empresa_id = $2 AND revertido = false AND reversible = true
       ORDER BY created_at DESC LIMIT 1`,
      [usuarioId, empresaId],
    );

    const [lastRedoable] = await this.ds.query(
      `SELECT id, accion, modulo, tabla, entidad_id, descripcion, created_at
       FROM entity_versions
       WHERE usuario_id = $1 AND empresa_id = $2 AND revertido = true
         AND id = (
           SELECT id FROM entity_versions
           WHERE usuario_id = $1 AND empresa_id = $2 AND revertido = true
           ORDER BY revertido_en DESC LIMIT 1
         )`,
      [usuarioId, empresaId],
    );

    return {
      canUndo:      !!lastUndoable,
      canRedo:      !!lastRedoable,
      lastUndo:     lastUndoable ?? null,
      lastRedo:     lastRedoable ?? null,
    };
  }

  // ── UNDO ──────────────────────────────────────────────────────
  async undo(usuarioId: string, empresaId: string): Promise<{ ok: boolean; descripcion: string }> {
    const version = await this.versionRepo.findOne({
      where: { usuarioId, empresaId, revertido: false, reversible: true },
      order: { createdAt: 'DESC' },
    });

    if (!version) {
      return { ok: false, descripcion: 'No hay acciones para deshacer' };
    }

    if (!TABLA_SEGURA.has(version.tabla)) {
      return { ok: false, descripcion: `Acción en "${version.modulo}" no es revertible' automáticamente` };
    }

    try {
      // Capturar estado actual para poder rehacer
      const [current] = await this.ds.query(
        `SELECT * FROM ${version.tabla} WHERE id = $1`,
        [version.entidadId],
      );
      version.redoSnapshot = current || null;

      switch (version.accion) {
        case 'DELETE':
          await this.undoDelete(version.tabla, version.entidadId, version.snapshotAnterior);
          break;

        case 'CREATE':
          // Soft-delete el registro creado
          await this.ds.query(
            `UPDATE ${version.tabla} SET deleted_at = NOW() WHERE id = $1`,
            [version.entidadId],
          );
          break;

        case 'UPDATE':
          if (!version.snapshotAnterior) {
            return { ok: false, descripcion: 'No hay snapshot previo para restaurar' };
          }
          await this.restoreSnapshot(version.tabla, version.entidadId, version.snapshotAnterior);
          break;

        default:
          return { ok: false, descripcion: `Acción "${version.accion}" no soportada para undo` };
      }

      version.revertido   = true;
      version.revertidoEn = new Date();
      await this.versionRepo.save(version);

      const desc = `Deshecho: ${version.accion} en ${version.modulo}`;
      this.logger.log(`UNDO: ${desc} (usuario: ${usuarioId})`);
      return { ok: true, descripcion: desc };

    } catch (err) {
      this.logger.error(`Undo falló: ${err.message}`);
      return { ok: false, descripcion: `Error al deshacer: ${err.message}` };
    }
  }

  // ── REDO ──────────────────────────────────────────────────────
  async redo(usuarioId: string, empresaId: string): Promise<{ ok: boolean; descripcion: string }> {
    const version = await this.versionRepo.findOne({
      where: { usuarioId, empresaId, revertido: true },
      order: { revertidoEn: 'DESC' },
    });

    if (!version) {
      return { ok: false, descripcion: 'No hay acciones para rehacer' };
    }

    if (!version.redoSnapshot) {
      return { ok: false, descripcion: 'No hay estado para rehacer' };
    }

    try {
      await this.restoreSnapshot(version.tabla, version.entidadId, version.redoSnapshot);

      version.revertido   = false;
      version.revertidoEn = null;
      await this.versionRepo.save(version);

      const desc = `Rehecho: ${version.accion} en ${version.modulo}`;
      this.logger.log(`REDO: ${desc} (usuario: ${usuarioId})`);
      return { ok: true, descripcion: desc };

    } catch (err) {
      this.logger.error(`Redo falló: ${err.message}`);
      return { ok: false, descripcion: `Error al rehacer: ${err.message}` };
    }
  }

  // ── Papelera inteligente ──────────────────────────────────────
  async getPapelera(empresaId: string, modulo?: string) {
    const tablas = modulo && TABLA_SEGURA.has(modulo)
      ? [modulo]
      : [...TABLA_SEGURA];

    const resultados: any[] = [];

    for (const tabla of tablas) {
      try {
        const displayCol = DISPLAY_SQL[tabla] ?? `id::text`;
        const rows = await this.ds.query(
          `SELECT id, deleted_at,
                  ${displayCol} AS display_name,
                  '${tabla}'   AS tabla
           FROM ${tabla}
           WHERE empresa_id = $1 AND deleted_at IS NOT NULL
           ORDER BY deleted_at DESC
           LIMIT 100`,
          [empresaId],
        );
        resultados.push(...rows);
      } catch {
        /* tabla puede no tener columnas esperadas, omitir */
      }
    }

    return resultados.sort(
      (a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime(),
    );
  }

  async restaurar(tabla: string, id: string, empresaId: string): Promise<void> {
    this.validarTabla(tabla);
    await this.ds.query(
      `UPDATE ${tabla} SET deleted_at = NULL WHERE id = $1 AND empresa_id = $2`,
      [id, empresaId],
    );
  }

  async eliminarPermanente(tabla: string, id: string, empresaId: string): Promise<void> {
    this.validarTabla(tabla);
    const [row] = await this.ds.query(
      `SELECT id FROM ${tabla} WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NOT NULL`,
      [id, empresaId],
    );
    if (!row) throw new BadRequestException('Registro no encontrado en papelera');
    await this.ds.query(
      `DELETE FROM ${tabla} WHERE id = $1 AND empresa_id = $2`,
      [id, empresaId],
    );
  }

  // ── Historial de una entidad ──────────────────────────────────
  async getHistorialEntidad(tabla: string, entidadId: string, empresaId: string) {
    return this.ds.query(
      `SELECT ev.id, ev.accion, ev.modulo, ev.usuario_email, ev.descripcion,
              ev.snapshot_anterior, ev.snapshot_posterior, ev.revertido, ev.created_at
       FROM entity_versions ev
       WHERE ev.tabla = $1 AND ev.entidad_id = $2 AND ev.empresa_id = $3
       ORDER BY ev.created_at DESC
       LIMIT 50`,
      [tabla, entidadId, empresaId],
    );
  }

  // ── Restaurar versión específica ──────────────────────────────
  async restaurarVersion(versionId: string, usuarioId: string, empresaId: string): Promise<{ ok: boolean; descripcion: string }> {
    const version = await this.versionRepo.findOne({
      where: { id: versionId, empresaId },
    });

    if (!version?.snapshotAnterior) {
      return { ok: false, descripcion: 'Versión no encontrada o sin snapshot' };
    }

    this.validarTabla(version.tabla);

    try {
      await this.restoreSnapshot(version.tabla, version.entidadId, version.snapshotAnterior);
      return { ok: true, descripcion: `Versión restaurada en ${version.modulo}` };
    } catch (err) {
      return { ok: false, descripcion: `Error: ${err.message}` };
    }
  }

  // ── Helpers privados ──────────────────────────────────────────

  private async undoDelete(tabla: string, entidadId: string, snapshot: Record<string, any> | null): Promise<void> {
    const result = await this.ds.query(
      `UPDATE ${tabla} SET deleted_at = NULL WHERE id = $1`,
      [entidadId],
    );
    const rowsAffected = result[1] ?? result?.rowCount ?? 0;

    if (rowsAffected === 0 && snapshot) {
      // Columnas generadas (GENERATED ALWAYS) no se pueden insertar explícitamente
      const generatedRows = await this.ds.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND is_generated = 'ALWAYS'`,
        [tabla],
      );
      const generated = new Set<string>(generatedRows.map((r: any) => r.column_name));

      const fields = Object.keys(snapshot).filter(f => !generated.has(f));
      const cols   = fields.map(f => `"${f}"`).join(', ');
      const vals   = fields.map((_, i) => `$${i + 1}`).join(', ');
      const values = fields.map(f => {
        const v = snapshot[f];
        return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
      });
      await this.ds.query(
        `INSERT INTO ${tabla} (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING`,
        values,
      );
    }
  }

  private async restoreSnapshot(tabla: string, id: string, snapshot: Record<string, any>): Promise<void> {
    const generatedRows = await this.ds.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND is_generated = 'ALWAYS'`,
      [tabla],
    );
    const generated = new Set<string>(generatedRows.map((r: any) => r.column_name));

    const fields = Object.keys(snapshot).filter(k => !CAMPOS_EXCLUIDOS.has(k) && !generated.has(k));
    if (!fields.length) return;

    const setClause = fields.map((f, i) => `"${f}" = $${i + 2}`).join(', ');
    const values    = [id, ...fields.map(f => {
      const v = snapshot[f];
      return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
    })];

    await this.ds.query(
      `UPDATE ${tabla} SET ${setClause}, updated_at = NOW() WHERE id = $1`,
      values,
    );
  }

  private validarTabla(tabla: string): void {
    if (!TABLA_SEGURA.has(tabla)) {
      throw new BadRequestException(`Tabla "${tabla}" no está permitida para esta operación`);
    }
  }
}
