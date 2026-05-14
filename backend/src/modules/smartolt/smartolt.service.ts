import {
  Injectable, Logger, NotFoundException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectDataSource }       from '@nestjs/typeorm';
import { DataSource }             from 'typeorm';
import { SmartoltApiService }     from './smartolt-api.service';
import { OnuRepository }          from './repositories/onu.repository';
import { AuditoriaService }       from '../auth/auditoria.service';
import { JwtPayload }             from '../../common/decorators/current-user.decorator';
import { Onu, Olt, EstadoOnu }   from './entities/onu.entity';
import { encrypt }                from '../../common/utils/encryption.util';
import {
  CreateOltDto, UpdateOltDto, ProvisionarOnuDto,
  AsociarOnuContratoDto, FilterOnuDto,
} from './dto/smartolt.dto';
import { formatPaginatedResponse } from '../../common/utils/pagination.util';

@Injectable()
export class SmartoltService {
  private readonly logger = new Logger(SmartoltService.name);

  constructor(
    private readonly api:       SmartoltApiService,
    private readonly onuRepo:   OnuRepository,
    private readonly auditoria: AuditoriaService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // GESTIÓN DE OLTs
  // ────────────────────────────────────────────────────────────

  async crearOlt(dto: CreateOltDto, user: JwtPayload): Promise<Olt> {
    let passwordCifrado: string | undefined;
    if ((dto as any).password) {
      try { passwordCifrado = encrypt((dto as any).password); }
      catch { passwordCifrado = (dto as any).password; }
    }

    const olt = await this.onuRepo.saveOlt({
      ...dto,
      passwordCifrado,
      empresaId: user.empresaId,
    } as any);

    this.logger.log(`OLT creada: ${dto.nombre} | empresa: ${user.empresaId}`);
    return olt;
  }

  async findAllOlts(empresaId: string): Promise<Olt[]> {
    return this.onuRepo.findAllOlts(empresaId);
  }

  async findOneOlt(id: string, empresaId: string): Promise<Olt> {
    const olt = await this.onuRepo.findOltById(id, empresaId);
    if (!olt) throw new NotFoundException(`OLT ${id} no encontrada`);
    return olt;
  }

  async updateOlt(id: string, dto: UpdateOltDto, user: JwtPayload): Promise<Olt> {
    await this.findOneOlt(id, user.empresaId);
    const updates: any = { ...dto };
    if ((dto as any).password) {
      try { updates.passwordCifrado = encrypt((dto as any).password); }
      catch { updates.passwordCifrado = (dto as any).password; }
      delete updates.password;
    }
    await this.onuRepo.updateOlt(id, updates);
    return this.findOneOlt(id, user.empresaId);
  }

  // ────────────────────────────────────────────────────────────
  // SINCRONIZAR OLTs DESDE SMARTOLT
  // Importa todos los OLTs configurados en SmartOLT al sistema.
  // ────────────────────────────────────────────────────────────
  async sincronizarOltsDesdeSmartolt(user: JwtPayload): Promise<{ sincronizados: number }> {
    const oltsRemototos = await this.api.listarOlts();
    let sincronizados   = 0;

    for (const remote of oltsRemototos) {
      const existente = await this.ds.query(
        'SELECT id FROM olts WHERE empresa_id = $1 AND smartolt_id = $2 AND deleted_at IS NULL',
        [user.empresaId, remote.id],
      );

      if (!existente.length) {
        await this.onuRepo.saveOlt({
          empresaId:   user.empresaId,
          nombre:      remote.name,
          smartoltId:  remote.id,
          ipGestion:   remote.ip,
          modelo:      remote.model,
          totalPonPorts: remote.pon_ports,
          activo:      true,
        } as any);
        sincronizados++;
      } else {
        await this.onuRepo.updateOlt(existente[0].id, {
          totalPonPorts: remote.pon_ports,
          onusActivas:   remote.onu_count,
        });
      }
    }

    this.logger.log(`OLTs sincronizados desde SmartOLT: ${sincronizados} nuevos`);
    return { sincronizados };
  }

  // ────────────────────────────────────────────────────────────
  // LISTAR ONUs NO APROVISIONADAS
  // Consulta SmartOLT y retorna las ONUs detectadas sin perfil.
  // ────────────────────────────────────────────────────────────
  async listarNoAprovisionadas(
    empresaId: string,
    oltId?:    string,
  ): Promise<{ smartolt: any[]; local: Onu[] }> {
    let smartoltId: string | undefined;

    if (oltId) {
      const olt = await this.findOneOlt(oltId, empresaId);
      smartoltId = olt.smartoltId;
    }

    // Consultar SmartOLT y BD local en paralelo
    const [desdeSmartolt, local] = await Promise.all([
      this.api.listarOnusNoAprovisionadas(smartoltId).catch(() => []),
      this.onuRepo.findSinAprovisionar(empresaId, oltId),
    ]);

    return { smartolt: desdeSmartolt, local };
  }

  // ────────────────────────────────────────────────────────────
  // APROVISIONAR ONU
  // Registra la ONU en SmartOLT con SN, PON, perfil y VLAN,
  // luego la guarda en la base de datos local.
  // ────────────────────────────────────────────────────────────
  async aprovisionarOnu(dto: ProvisionarOnuDto, user: JwtPayload, req?: any): Promise<Onu> {
    const olt = await this.findOneOlt(dto.oltId, user.empresaId);

    // Verificar duplicado local
    const existente = await this.onuRepo.findBySerial(dto.serialNumber, user.empresaId);
    if (existente && existente.estado !== EstadoOnu.SIN_APROVISIONAR) {
      throw new ConflictException(
        `La ONU con SN ${dto.serialNumber} ya está aprovisionada (estado: ${existente.estado})`,
      );
    }

    if (!olt.smartoltId) {
      throw new BadRequestException(
        `El OLT "${olt.nombre}" no tiene un smartoltId configurado. ` +
        `Sincroniza los OLTs desde SmartOLT primero.`,
      );
    }

    // ── Llamar a SmartOLT ────────────────────────────────────
    const onuSmartolt = await this.api.aprovisionarOnu({
      serial:      dto.serialNumber,
      olt_id:      olt.smartoltId,
      pon_port:    dto.ponPort,
      profile:     dto.perfil,
      vlan:        dto.vlanId,
      vlan_mode:   dto.vlanModo || 'access',
      description: dto.descripcion || '',
    });

    // ── Parsear PON port ─────────────────────────────────────
    const { slot, subslot, port, onuIdx } = this.parsePonPort(dto.ponPort);

    // ── Guardar o actualizar en la BD ────────────────────────
    let onu: Onu;
    if (existente) {
      await this.onuRepo.update(existente.id, {
        estado:          EstadoOnu.APROVISIONADA,
        ponPort:         dto.ponPort,
        ponSlot:         slot,
        ponSubslot:      subslot,
        ponPortNum:      port,
        perfilSmartolt:  dto.perfil,
        smartoltOnuId:   onuSmartolt.id,
        vlanId:          dto.vlanId,
        vlanModo:        dto.vlanModo || 'access',
        modelo:          dto.modelo,
        descripcion:     dto.descripcion,
        aprovisionadaEn: new Date(),
        aprovisionadaPor: user.sub,
      });
      onu = await this.onuRepo.findById(existente.id, user.empresaId) as Onu;
    } else {
      onu = await this.onuRepo.save(this.onuRepo.create({
        empresaId:       user.empresaId,
        oltId:           dto.oltId,
        serialNumber:    dto.serialNumber.toUpperCase(),
        modelo:          dto.modelo,
        ponPort:         dto.ponPort,
        ponSlot:         slot,
        ponSubslot:      subslot,
        ponPortNum:      port,
        perfilSmartolt:  dto.perfil,
        smartoltOnuId:   onuSmartolt.id,
        vlanId:          dto.vlanId,
        vlanModo:        dto.vlanModo || 'access',
        estado:          EstadoOnu.APROVISIONADA,
        descripcion:     dto.descripcion,
        aprovisionadaEn: new Date(),
        aprovisionadaPor: user.sub,
      }));
    }

    // ── Asociar al contrato si se indicó ─────────────────────
    if (dto.contratoId) {
      await this.asociarAContrato(
        { contratoId: dto.contratoId, onuId: onu.id },
        user,
      );
    }

    await this.auditoria.logCreate({
      empresaId:    user.empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      modulo:       'smartolt',
      entidadId:    onu.id,
      descripcion:  `ONU aprovisionada: SN=${dto.serialNumber} | PON=${dto.ponPort} | VLAN=${dto.vlanId}`,
      req,
    });

    this.logger.log(
      `ONU aprovisionada: ${dto.serialNumber} | ` +
      `OLT: ${olt.nombre} | PON: ${dto.ponPort} | VLAN: ${dto.vlanId}`,
    );

    return onu;
  }

  // ────────────────────────────────────────────────────────────
  // ELIMINAR PROVISIÓN
  // ────────────────────────────────────────────────────────────
  async eliminarProvision(
    id:   string,
    user: JwtPayload,
    req?: any,
  ): Promise<void> {
    const onu = await this.findOneOnu(id, user.empresaId);
    const olt = await this.findOneOlt(onu.oltId, user.empresaId);

    if (!onu.smartoltOnuId) {
      throw new BadRequestException('La ONU no tiene un ID de SmartOLT — ya fue eliminada o nunca fue aprovisionada');
    }

    if (!olt.smartoltId) {
      throw new BadRequestException('El OLT no tiene SmartOLT ID configurado');
    }

    // Eliminar de SmartOLT
    await this.api.eliminarProvision(olt.smartoltId, onu.smartoltOnuId);

    // Desasociar del contrato
    await this.ds.query(
      'UPDATE contratos SET onu_id = NULL, aprovisionado = false WHERE onu_id = $1',
      [id],
    );

    // Actualizar estado en BD
    await this.onuRepo.update(id, {
      estado:        EstadoOnu.SIN_APROVISIONAR,
      smartoltOnuId: null,
      aprovisionadaEn: null,
    } as any);

    await this.auditoria.logDelete({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'smartolt', entidadId: id,
      descripcion: `Provisión eliminada: SN=${onu.serialNumber}`, req,
    });

    this.logger.log(`Provisión eliminada: ONU ${id} (SN: ${onu.serialNumber})`);
  }

  // ────────────────────────────────────────────────────────────
  // ASOCIAR ONU A CONTRATO
  // ────────────────────────────────────────────────────────────
  async asociarAContrato(dto: AsociarOnuContratoDto, user: JwtPayload): Promise<void> {
    const onu = await this.findOneOnu(dto.onuId, user.empresaId);

    // Verificar que el contrato pertenece a la empresa
    const [contrato] = await this.ds.query(
      'SELECT id, onu_id FROM contratos WHERE id = $1 AND empresa_id = $2 AND deleted_at IS NULL',
      [dto.contratoId, user.empresaId],
    );

    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    if (contrato.onu_id && contrato.onu_id !== dto.onuId) {
      throw new ConflictException('El contrato ya tiene otra ONU asociada');
    }

    // Actualizar contrato con onu_id y marcar como aprovisionado
    await this.ds.query(
      `UPDATE contratos SET onu_id = $1, aprovisionado = true, aprovisionado_en = NOW()
       WHERE id = $2`,
      [dto.onuId, dto.contratoId],
    );

    this.logger.log(`ONU ${dto.onuId} asociada al contrato ${dto.contratoId}`);
  }

  // ────────────────────────────────────────────────────────────
  // SINCRONIZAR ESTADO DESDE SMARTOLT
  // Actualiza el estado online/offline de las ONUs en la BD.
  // ────────────────────────────────────────────────────────────
  async sincronizarEstadoOnus(empresaId: string, oltId: string): Promise<{
    actualizadas: number; online: number; offline: number;
  }> {
    const olt = await this.findOneOlt(oltId, empresaId);
    if (!olt.smartoltId) throw new BadRequestException('OLT sin SmartOLT ID');

    const onusSmartolt = await this.api.listarOnusDeOlt(olt.smartoltId);
    let actualizadas = 0;
    let online = 0;
    let offline = 0;

    for (const remote of onusSmartolt) {
      const local = await this.onuRepo.findBySerial(remote.serial, empresaId);
      if (!local) continue;

      const nuevoEstado = remote.status === 'online'
        ? EstadoOnu.ONLINE
        : EstadoOnu.OFFLINE;

      const updates: Partial<Onu> = {
        estado:      nuevoEstado,
        rxPowerDbm:  remote.rx_power,
        txPowerDbm:  remote.tx_power,
        temperaturaC: remote.temperature,
      };

      if (nuevoEstado === EstadoOnu.ONLINE) {
        updates.ultimoOnline = new Date();
        online++;
      } else {
        offline++;
      }

      await this.onuRepo.update(local.id, updates);
      actualizadas++;
    }

    this.logger.log(
      `Sync ONUs OLT ${olt.nombre}: ${actualizadas} actualizadas | ` +
      `${online} online | ${offline} offline`,
    );

    // Actualizar contador de ONUs activas en el OLT
    await this.onuRepo.updateOlt(oltId, { onusActivas: online });

    return { actualizadas, online, offline };
  }

  // ────────────────────────────────────────────────────────────
  // OBTENER SEÑAL ÓPTICA EN TIEMPO REAL
  // ────────────────────────────────────────────────────────────
  async getSeñalOnu(id: string, empresaId: string): Promise<any> {
    const onu = await this.findOneOnu(id, empresaId);
    const olt = await this.findOneOlt(onu.oltId, empresaId);

    if (!onu.smartoltOnuId || !olt.smartoltId) {
      throw new BadRequestException('ONU no aprovisionada en SmartOLT');
    }

    const señal = await this.api.getSeñalOnu(olt.smartoltId, onu.smartoltOnuId);

    // Actualizar en BD
    await this.onuRepo.update(id, {
      rxPowerDbm:  señal.rxPower,
      txPowerDbm:  señal.txPower,
      temperaturaC: señal.temperature,
      voltajeV:    señal.voltaje,
    });

    return { ...señal, onuId: id, serialNumber: onu.serialNumber };
  }

  // ────────────────────────────────────────────────────────────
  // REINICIAR ONU
  // ────────────────────────────────────────────────────────────
  async reiniciarOnu(id: string, user: JwtPayload): Promise<void> {
    const onu = await this.findOneOnu(id, user.empresaId);
    const olt = await this.findOneOlt(onu.oltId, user.empresaId);

    if (!onu.smartoltOnuId || !olt.smartoltId) {
      throw new BadRequestException('ONU no aprovisionada en SmartOLT');
    }

    await this.api.reiniciarOnu(olt.smartoltId, onu.smartoltOnuId);
    this.logger.log(`ONU reiniciada: ${onu.serialNumber} por ${user.email}`);
  }

  // ────────────────────────────────────────────────────────────
  // LISTADOS Y BÚSQUEDAS
  // ────────────────────────────────────────────────────────────

  async findAll(empresaId: string, filters: FilterOnuDto) {
    const result = await this.onuRepo.findAllPaginated(empresaId, filters);
    return formatPaginatedResponse(result);
  }

  async findOneOnu(id: string, empresaId: string): Promise<Onu> {
    const onu = await this.onuRepo.findById(id, empresaId) as any;
    if (!onu) throw new NotFoundException(`ONU ${id} no encontrada`);
    return onu;
  }

  async findOnuCompleta(id: string, empresaId: string): Promise<any> {
    const data = await this.onuRepo.findCompletaPorId(id, empresaId);
    if (!data) throw new NotFoundException(`ONU ${id} no encontrada`);
    return data;
  }

  async getResumen(empresaId: string) {
    const [resumen, perfiles] = await Promise.all([
      this.onuRepo.getResumen(empresaId),
      this.api.listarPerfiles().catch(() => []),
    ]);
    return { resumen, perfilesDisponibles: perfiles };
  }

  async listarPerfiles(): Promise<any[]> {
    return this.api.listarPerfiles();
  }

  async verificarSmartolt(): Promise<any> {
    return this.api.verificarConectividad();
  }

  // ── Parsear '0/1/3' → { slot:0, subslot:1, port:3, onuIdx:undefined } ─
  private parsePonPort(ponPort: string): {
    slot?: number; subslot?: number; port?: number; onuIdx?: number;
  } {
    const parts = ponPort.split('/').map(Number);
    return {
      slot:    parts[0],
      subslot: parts[1],
      port:    parts[2],
      onuIdx:  parts[3],
    };
  }
}
