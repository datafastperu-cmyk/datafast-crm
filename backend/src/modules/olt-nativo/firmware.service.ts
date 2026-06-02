import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';

import {
  BadRequestException, Injectable, Logger,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In }   from 'typeorm';

import { OltDispositivo, OltMetodoConexion } from './entities/olt-dispositivo.entity';
import { HistorialFirmware }                 from './entities/historial-firmware.entity';
import { Onu, EstadoOnu }                    from '../smartolt/entities/onu.entity';
import { OltAutomationClient }               from './olt-automation.client';
import { decrypt }                           from '../../common/utils/encryption.util';
import {
  FirmwareJobResult,
  IniciarFirmwareUpgradeDto,
  OnuActivaInfo,
  PythonFirmwareUpgradeRequest,
} from './dto/olt-nativo-ops.dto';

// ──────────────────────────────────────────────────────────────────
// FirmwareService — Orquesta la actualización masiva de firmware OMCI
//
// Flujo:
//   1. Recibe el archivo .bin en memoria (Multer memoryStorage).
//   2. Lo escribe a /tmp/firmware/{historialId}/{filename} (aislado por job).
//   3. Crea HistorialFirmware en BD con estado 'pendiente'.
//   4. Descifra credenciales de la OLT y despacha al microservicio Python.
//   5. Python responde con {job_id} → guarda en HistorialFirmware.
//   6. El frontend consulta el estado via pollJobStatus.
//   7. Al completarse, el archivo temporal es limpiado por el propio Python.
//
// Seguridad:
//   - Multer memoryStorage: el buffer NO llega a disco hasta que este
//     servicio lo escribe explícitamente en /tmp/firmware/.
//   - El password de la OLT se descifra justo antes de enviarlo y
//     no se persiste en ningún campo.
//   - firmwarePath en HistorialFirmware es solo para auditoría;
//     Python limpia el archivo a los 30 min de completarse el job.
// ──────────────────────────────────────────────────────────────────
@Injectable()
export class FirmwareService {
  private readonly logger = new Logger(FirmwareService.name);
  private readonly FIRMWARE_TMP_ROOT = path.join(os.tmpdir(), 'firmware');
  private readonly MAX_FILE_BYTES    = 64 * 1024 * 1024;  // 64 MB

  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(HistorialFirmware)
    private readonly historialRepo: Repository<HistorialFirmware>,

    @InjectRepository(Onu)
    private readonly onuRepo: Repository<Onu>,

    private readonly automation: OltAutomationClient,
  ) {}

  // ────────────────────────────────────────────────────────────
  // iniciarUpgrade
  //
  // Valida el archivo, crea el registro de auditoría, escribe el
  // .bin al directorio temporal y dispara el job en Python.
  // ────────────────────────────────────────────────────────────
  async iniciarUpgrade(
    oltId:       string,
    empresaId:   string,
    userId:      string,
    userEmail:   string | null,
    file:        Express.Multer.File,
    dto:         IniciarFirmwareUpgradeDto,
  ): Promise<{ historialId: string; pythonJobId: string; message: string }> {

    this.validateFile(file);

    const olt = await this.findOlt(oltId, empresaId);
    if (olt.metodoConexion !== OltMetodoConexion.NATIVO_SSH) {
      throw new BadRequestException(
        `La OLT "${olt.nombre}" usa ${olt.metodoConexion}. ` +
        'Solo OLTs con NATIVO_SSH soportan actualización de firmware OMCI.',
      );
    }

    let onuIds: number[];
    try {
      onuIds = JSON.parse(dto.onuIds);
      if (!Array.isArray(onuIds) || onuIds.length === 0) throw new Error();
    } catch {
      throw new BadRequestException('onuIds debe ser un JSON array no vacío, ej: [1,2,3]');
    }

    // Crear registro de auditoría con ID previo para usarlo como directorio
    const historial = this.historialRepo.create({
      empresaId,
      oltId:            olt.id,
      oltNombre:        olt.nombre,
      uploadedBy:       userId,
      uploadedByEmail:  userEmail,
      firmwareFilename: file.originalname,
      firmwareSizeBytes: file.size,
      firmwarePath:     '',  // se rellena tras escribir en disco
      slot:             dto.slot,
      port:             dto.port,
      onuIds,
      estado:           'pendiente',
      pythonJobId:      null,
      resultado:        null,
      errorMsg:         null,
    });
    const saved = await this.historialRepo.save(historial);

    // Escribir .bin a disco en directorio aislado por historial.id
    const jobDir      = path.join(this.FIRMWARE_TMP_ROOT, saved.id);
    const firmwarePath = path.join(jobDir, path.basename(file.originalname));
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(firmwarePath, file.buffer);

    await this.historialRepo.update(saved.id, {
      firmwarePath,
      estado: 'pendiente',
    });

    // Descifrar contraseña — vive solo en este scope
    let password: string;
    try {
      password = decrypt(olt.contrasenaCifrada);
    } catch (err) {
      await this.historialRepo.update(saved.id, {
        estado:   'fallido',
        errorMsg: 'No se pudo descifrar credenciales de la OLT',
      });
      this.cleanupTempDir(jobDir);
      throw new ServiceUnavailableException(
        'No se pudo descifrar la contraseña de la OLT. Verifica ENCRYPTION_KEY.',
      );
    }

    const pythonReq: PythonFirmwareUpgradeRequest = {
      connection: {
        ip:       olt.ipGestion,
        port:     olt.puerto,
        username: olt.usuarioAnclado,
        password,
        brand:    olt.marca,
      },
      slot:              dto.slot,
      port:              dto.port,
      onu_ids:           onuIds,
      firmware_file:     firmwarePath,
      firmware_filename: file.originalname,
    };

    let pythonRes: { job_id: string; message: string };
    try {
      pythonRes = await this.automation.firmwareUpgrade(pythonReq);
    } catch (err) {
      await this.historialRepo.update(saved.id, {
        estado:   'fallido',
        errorMsg: err.message,
      });
      this.cleanupTempDir(jobDir);
      throw new ServiceUnavailableException(
        `Error al contactar el microservicio Python: ${err.message}`,
      );
    }

    await this.historialRepo.update(saved.id, {
      pythonJobId: pythonRes.job_id,
      estado:      'transfiriendo',
    });

    this.logger.log(
      `Firmware upgrade iniciado | OLT="${olt.nombre}" ` +
      `slot=${dto.slot} port=${dto.port} ONUs=${onuIds.join(',')} ` +
      `job_id=${pythonRes.job_id}`,
    );

    return {
      historialId: saved.id,
      pythonJobId: pythonRes.job_id,
      message:     pythonRes.message,
    };
  }

  // ────────────────────────────────────────────────────────────
  // pollJobStatus
  //
  // Consulta el estado del job en Python y actualiza el historial
  // si el estado cambió.  Devuelve el estado combinado al frontend.
  // ────────────────────────────────────────────────────────────
  async pollJobStatus(
    oltId:       string,
    empresaId:   string,
    historialId: string,
  ): Promise<FirmwareJobResult> {
    const historial = await this.historialRepo.findOne({
      where: { id: historialId, oltId, empresaId },
    });
    if (!historial) {
      throw new NotFoundException(`Job de firmware ${historialId} no encontrado`);
    }

    // Si ya terminó, devolver el estado sin re-consultar Python
    if (['exitoso', 'parcial', 'fallido'].includes(historial.estado)) {
      return this.toJobResult(historial);
    }

    if (!historial.pythonJobId) {
      return this.toJobResult(historial);
    }

    try {
      const pyStatus = await this.automation.getFirmwareJobStatus(historial.pythonJobId);

      let nuevoEstado = historial.estado;
      if (pyStatus.status === 'success')  nuevoEstado = 'exitoso';
      if (pyStatus.status === 'failed')   nuevoEstado = 'fallido';
      if (pyStatus.status === 'partial')  nuevoEstado = 'parcial';

      if (nuevoEstado !== historial.estado) {
        await this.historialRepo.update(historialId, {
          estado:    nuevoEstado,
          resultado: pyStatus.progress as any,
          errorMsg:  pyStatus.status === 'failed' ? pyStatus.message : null,
        });
        historial.estado    = nuevoEstado;
        historial.resultado = pyStatus.progress as any;
      }
    } catch (err) {
      this.logger.warn(`pollJobStatus: no se pudo contactar Python: ${err.message}`);
    }

    return this.toJobResult(historial);
  }

  // ────────────────────────────────────────────────────────────
  // listarHistorial — últimos N jobs para una OLT
  // ────────────────────────────────────────────────────────────
  async listarHistorial(
    oltId:     string,
    empresaId: string,
    limit      = 20,
  ): Promise<FirmwareJobResult[]> {
    const registros = await this.historialRepo.find({
      where:  { oltId, empresaId },
      order:  { createdAt: 'DESC' },
      take:   limit,
    });
    return registros.map(r => this.toJobResult(r));
  }

  // ────────────────────────────────────────────────────────────
  // listarOnusActivas — ONUs aprovisionadas/online en slot/port
  // ────────────────────────────────────────────────────────────
  async listarOnusActivas(
    oltId:     string,
    empresaId: string,
    slot?:     number,
    port?:     number,
  ): Promise<OnuActivaInfo[]> {
    const where: Record<string, unknown> = {
      oltId,
      empresaId,
      estado: In([EstadoOnu.APROVISIONADA, EstadoOnu.ONLINE, EstadoOnu.OFFLINE]),
    };
    if (slot != null) where['ponSlot']    = slot;
    if (port != null) where['ponPortNum'] = port;

    const onus = await this.onuRepo.find({
      where,
      order: { ponSlot: 'ASC', ponPortNum: 'ASC', onuId: 'ASC' },
      take:  256,
    });

    return onus
      .filter(o => o.ponSlot != null && o.ponPortNum != null && o.onuId != null)
      .map(o => ({
        id:           o.id,
        serialNumber: o.serialNumber,
        onuId:        o.onuId,
        ponSlot:      o.ponSlot,
        ponPortNum:   o.ponPortNum,
        estado:       o.estado,
      }));
  }

  // ── Privados ─────────────────────────────────────────────────

  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('Archivo de firmware no recibido.');
    }
    if (!file.originalname.toLowerCase().endsWith('.bin')) {
      throw new BadRequestException('Solo se permiten archivos con extensión .bin');
    }
    if (file.size > this.MAX_FILE_BYTES) {
      throw new BadRequestException(
        `El archivo supera el límite de 64 MB (${(file.size / 1024 / 1024).toFixed(1)} MB recibidos).`,
      );
    }
    if (file.size === 0) {
      throw new BadRequestException('El archivo de firmware está vacío.');
    }
  }

  private async findOlt(id: string, empresaId: string): Promise<OltDispositivo> {
    const olt = await this.oltRepo.findOne({ where: { id, empresaId, activo: true } });
    if (!olt) throw new NotFoundException(`OLT "${id}" no encontrada`);
    return olt;
  }

  private toJobResult(h: HistorialFirmware): FirmwareJobResult {
    return {
      historialId:       h.id,
      oltId:             h.oltId,
      oltNombre:         h.oltNombre,
      firmwareFilename:  h.firmwareFilename,
      firmwareSizeBytes: h.firmwareSizeBytes,
      slot:              h.slot,
      port:              h.port,
      onuIds:            h.onuIds,
      estado:            h.estado,
      pythonJobId:       h.pythonJobId,
      resultado:         h.resultado,
      errorMsg:          h.errorMsg,
      createdAt:         h.createdAt.toISOString(),
      updatedAt:         h.updatedAt.toISOString(),
    };
  }

  private cleanupTempDir(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
