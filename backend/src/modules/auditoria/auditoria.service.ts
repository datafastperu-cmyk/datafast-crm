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
    const { page = 1, limit = 50, search, modulo, accion, usuarioId, desde, hasta } = filtros;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['empresa_id = $1'];
    const params: any[]        = [empresaId];
    let   pIdx                 = 2;

    if (search) {
      conditions.push(`(descripcion ILIKE $${pIdx} OR usuario_email ILIKE $${pIdx} OR entidad_id::text ILIKE $${pIdx})`);
      params.push(`%${search}%`); pIdx++;
    }
    if (modulo)    { conditions.push(`modulo = $${pIdx}`);      params.push(modulo);    pIdx++; }
    if (accion)    { conditions.push(`accion = $${pIdx}`);      params.push(accion);    pIdx++; }
    if (usuarioId) { conditions.push(`usuario_id = $${pIdx}`);  params.push(usuarioId); pIdx++; }
    if (desde)     { conditions.push(`created_at >= $${pIdx}`); params.push(desde);     pIdx++; }
    if (hasta)     { conditions.push(`created_at <= $${pIdx}`); params.push(hasta);     pIdx++; }

    const where = conditions.join(' AND ');

    const [rows, [{ total }]] = await Promise.all([
      this.ds.query(
        `SELECT id, empresa_id, usuario_id, usuario_email, accion, modulo, entidad_id,
                descripcion, ip_address, metodo_http, ruta, datos_anteriores, datos_nuevos, created_at
         FROM auditoria_logs WHERE ${where}
         ORDER BY created_at DESC LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
        [...params, limit, offset],
      ),
      this.ds.query(
        `SELECT COUNT(*) as total FROM auditoria_logs WHERE ${where}`,
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
          // Restaurar soft-delete
          await this.ds.query(
            `UPDATE ${version.tabla} SET deleted_at = NULL WHERE id = $1`,
            [version.entidadId],
          );
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
  private async restoreSnapshot(tabla: string, id: string, snapshot: Record<string, any>): Promise<void> {
    const fields = Object.keys(snapshot).filter(k => !CAMPOS_EXCLUIDOS.has(k));
    if (!fields.length) return;

    const setClause = fields.map((f, i) => `"${f}" = $${i + 2}`).join(', ');
    const values    = [id, ...fields.map(f => snapshot[f])];

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
