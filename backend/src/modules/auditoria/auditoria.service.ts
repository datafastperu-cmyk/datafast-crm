import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EntityVersion } from './entities/entity-version.entity';
import { AuditoriaLog } from '../usuarios/entities/auditoria-log.entity';
import { FiltrosAuditoriaDto } from './dto/auditoria.dto';

// Tablas permitidas para operaciones de undo/redo/papelera
const TABLA_SEGURA = new Set([
  'clientes', 'contratos', 'facturas', 'pagos', 'planes', 'tickets',
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

    // Todas las condiciones se escriben con el alias `a`, porque el listado hace JOIN para
    // resolver el nombre del afectado y el conteo reutiliza este mismo WHERE.
    const conditions: string[] = ['a.empresa_id = $1'];
    const params: any[]        = [empresaId];
    let   pIdx                 = 2;

    // El AuditInterceptor escribe una fila por CADA request HTTP, con la descripción
    // "POST /api/v1/... (123ms)". Eso es un access log, no actividad de negocio, y supone
    // el 95% de la tabla: sin separarlo, buscar quién cobró o a quién se cortó es
    // imposible. Se distingue por la forma de la descripción para no necesitar migrar
    // 25.000 filas ya escritas.
    if (soloNegocio) {
      conditions.push(`a.descripcion !~ '^(GET|POST|PATCH|PUT|DELETE) /'`);
    }
    // Sin usuario = lo hizo el sistema (cron, worker, watcher). Es la distinción que pide
    // el operador cuando pregunta "¿esto lo hizo alguien o se hizo solo?".
    if (origen === 'sistema') {
      conditions.push(`(a.usuario_email IS NULL OR a.usuario_email = '')`);
    } else if (origen === 'usuario') {
      conditions.push(`(a.usuario_email IS NOT NULL AND a.usuario_email <> '')`);
    }

    if (search) {
      // Se busca también por el nombre del cliente afectado: es como lo busca una persona
      // ("qué pasó con Piero"), no por el UUID que guarda el registro.
      conditions.push(
        `(a.descripcion ILIKE $${pIdx} OR a.usuario_email ILIKE $${pIdx}` +
        ` OR a.entidad_id::text ILIKE $${pIdx}` +
        ` OR cl.nombre_completo ILIKE $${pIdx} OR cl_co.nombre_completo ILIKE $${pIdx}` +
        ` OR co.numero_contrato ILIKE $${pIdx})`,
      );
      params.push(`%${search}%`); pIdx++;
    }
    if (modulo)    { conditions.push(`a.modulo = $${pIdx}`);      params.push(modulo);    pIdx++; }
    if (accion)    { conditions.push(`a.accion = $${pIdx}`);      params.push(accion);    pIdx++; }
    if (usuarioId) { conditions.push(`a.usuario_id = $${pIdx}`);  params.push(usuarioId); pIdx++; }
    if (desde)     { conditions.push(`a.created_at >= $${pIdx}`); params.push(desde);     pIdx++; }
    if (hasta)     { conditions.push(`a.created_at <= $${pIdx}`); params.push(hasta);     pIdx++; }

    const where = conditions.join(' AND ');

    const [rows, [{ total }]] = await Promise.all([
      this.ds.query(
        // `entidad_nombre`: los eventos identifican al afectado por UUID o por IP
        // ("Cliente: 0e814d05-…", "Suspensión automática: IP 172.16.201.2"), que no le
        // dice nada a quien lee el log. Se resuelve el nombre aquí, en la lectura, en vez
        // de tocar los ~40 puntos que escriben auditoría. El LEFT JOIN no filtra nada: si
        // el id no es de un cliente ni de un contrato, la columna viene en null.
        `SELECT a.id, a.empresa_id, a.usuario_id, a.usuario_email, a.accion, a.modulo,
                a.entidad_id, a.descripcion, a.ip_address, a.metodo_http, a.ruta,
                a.datos_anteriores, a.datos_nuevos, a.created_at,
                COALESCE(cl.nombre_completo, cl_co.nombre_completo, co.numero_contrato) AS entidad_nombre
           FROM auditoria_logs a
           -- entidad_id es varchar y no siempre contiene un UUID (hay ids de otras
           -- formas), así que se castea solo cuando lo parece: un cast directo revienta la
           -- consulta entera con "invalid input syntax for type uuid" en cuanto aparece
           -- una fila con otro formato, y comparar como texto impediría usar el índice.
           LEFT JOIN clientes  cl    ON cl.id = NULLIF(a.entidad_id, '')::uuid
                                        AND a.entidad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           LEFT JOIN contratos co    ON co.id = NULLIF(a.entidad_id, '')::uuid
                                        AND a.entidad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           LEFT JOIN clientes  cl_co ON cl_co.id = co.cliente_id
          WHERE ${where}
          ORDER BY a.created_at DESC LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
        [...params, limit, offset],
      ),
      this.ds.query(
        // Los mismos JOIN que el listado: sin ellos, buscar por nombre de cliente daría un
        // total distinto al de las filas mostradas.
        `SELECT COUNT(*) as total
           FROM auditoria_logs a
           -- entidad_id es varchar y no siempre contiene un UUID (hay ids de otras
           -- formas), así que se castea solo cuando lo parece: un cast directo revienta la
           -- consulta entera con "invalid input syntax for type uuid" en cuanto aparece
           -- una fila con otro formato, y comparar como texto impediría usar el índice.
           LEFT JOIN clientes  cl    ON cl.id = NULLIF(a.entidad_id, '')::uuid
                                        AND a.entidad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           LEFT JOIN contratos co    ON co.id = NULLIF(a.entidad_id, '')::uuid
                                        AND a.entidad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           LEFT JOIN clientes  cl_co ON cl_co.id = co.cliente_id
          WHERE ${where}`,
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
    const negocio = `descripcion !~ '^(GET|POST|PATCH|PUT|DELETE) /'`;

    const [[cifras], modulos, acciones] = await Promise.all([
      this.ds.query(
        `SELECT
           COUNT(*) FILTER (WHERE ${negocio})                                     AS total,
           COUNT(*) FILTER (WHERE ${negocio} AND created_at >= CURRENT_DATE)      AS hoy,
           COUNT(*) FILTER (WHERE ${negocio} AND created_at >= CURRENT_DATE
                              AND usuario_email IS NOT NULL AND usuario_email <> '') AS hoy_usuarios,
           COUNT(*) FILTER (WHERE ${negocio} AND created_at >= CURRENT_DATE
                              AND (usuario_email IS NULL OR usuario_email = ''))     AS hoy_sistema,
           COUNT(*) FILTER (WHERE accion = 'LOGIN_FAIL'
                              AND created_at >= CURRENT_DATE - INTERVAL '7 days')    AS accesos_fallidos_semana,
           COUNT(*) FILTER (WHERE NOT (${negocio}))                               AS peticiones_tecnicas
         FROM auditoria_logs WHERE empresa_id = $1`,
        [empresaId],
      ),
      this.ds.query(
        `SELECT DISTINCT modulo FROM auditoria_logs
          WHERE empresa_id = $1 AND modulo IS NOT NULL ORDER BY modulo`,
        [empresaId],
      ),
      this.ds.query(
        `SELECT DISTINCT accion FROM auditoria_logs
          WHERE empresa_id = $1 AND accion IS NOT NULL AND ${negocio} ORDER BY accion`,
        [empresaId],
      ),
    ]);

    return {
      total:                  Number(cifras?.total ?? 0),
      hoy:                    Number(cifras?.hoy ?? 0),
      hoyUsuarios:            Number(cifras?.hoy_usuarios ?? 0),
      hoySistema:             Number(cifras?.hoy_sistema ?? 0),
      accesosFallidosSemana:  Number(cifras?.accesos_fallidos_semana ?? 0),
      peticionesTecnicas:     Number(cifras?.peticiones_tecnicas ?? 0),
      modulos:  (modulos  as Array<{ modulo: string }>).map((m) => m.modulo),
      acciones: (acciones as Array<{ accion: string }>).map((a) => a.accion),
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
