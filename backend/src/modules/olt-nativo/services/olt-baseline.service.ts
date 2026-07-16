import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OltBaseline, BaselineSpec } from '../entities/olt-baseline.entity';
import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import {
  BASELINE_ESTANDAR_DESCRIPCION, BASELINE_ESTANDAR_NOMBRE, construirSpecEstandar,
} from '../capability/olt-baseline-standard';

// ─── DTOs ─────────────────────────────────────────────────────────

// DEBE declararse antes de CrearBaselineDto: emitDecoratorMetadata refiere la
// clase al evaluar los decoradores (TDZ con SWC — crash en frío si va después).
export class ServicePortRangeDto {
  @IsInt() @Min(1) @Max(32_768) @Type(() => Number) inicio: number;
  @IsInt() @Min(1) @Max(32_768) @Type(() => Number) fin:    number;
}

export class BaselineVlanDto {
  @IsInt() @Min(1) @Max(4094) @Type(() => Number) vlanId: number;
  @IsString() @MaxLength(64)                       nombre: string;
  @IsOptional() @IsString() @MaxLength(32)         proposito?: string;
  // true → debe quedar taggeada en uplinkPort (9b). Tagging solo aditivo.
  @IsOptional() @IsBoolean()                       uplink?: boolean;
}

export class BaselineTrafficTableDto {
  @IsString() @MaxLength(64)                             nombre:  string;
  @IsInt() @Min(64) @Max(10_000_000) @Type(() => Number) cirKbps: number;
  @IsInt() @Min(64) @Max(10_000_000) @Type(() => Number) pirKbps: number;
}

export class CrearBaselineDto {
  @IsString() @MaxLength(100)              nombre: string;
  @IsOptional() @IsString()                descripcion?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => BaselineVlanDto)
  vlans: BaselineVlanDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => BaselineTrafficTableDto)
  trafficTables: BaselineTrafficTableDto[];

  @IsOptional() @IsArray() @IsString({ each: true })
  ntpServers?: string[];

  // Puerto uplink físico frame/slot/port (ej. '0/9/0') donde se tagean las
  // VLANs con uplink:true.
  @IsOptional() @Matches(/^\d+\/\d+\/\d+$/, { message: 'uplinkPort debe tener formato frame/slot/port, ej. 0/9/0' })
  uplinkPort?: string;

  @IsOptional() @ValidateNested() @Type(() => ServicePortRangeDto)
  servicePortRange?: ServicePortRangeDto;
}

// ─── Service ──────────────────────────────────────────────────────
//
// Versionado inmutable: crear con un nombre existente genera version = max+1.
// Nunca se edita una versión publicada — el historial de qué se exigió en
// cada momento queda auditable. Asignar a una OLT es apuntar baseline_id.
@Injectable()
export class OltBaselineService {
  private readonly logger = new Logger(OltBaselineService.name);

  constructor(
    @InjectRepository(OltBaseline)
    private readonly repo: Repository<OltBaseline>,

    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,
  ) {}

  async listar(empresaId: string): Promise<OltBaseline[]> {
    return this.repo.find({
      where: { empresaId },
      order: { nombre: 'ASC', version: 'DESC' },
    });
  }

  async obtener(id: string, empresaId: string): Promise<OltBaseline> {
    const baseline = await this.repo.findOne({ where: { id, empresaId } });
    if (!baseline) throw new NotFoundException(`Baseline ${id} no encontrado.`);
    return baseline;
  }

  async crear(empresaId: string, dto: CrearBaselineDto): Promise<OltBaseline> {
    // Guard: VLANs duplicadas dentro del propio spec
    const vlanIds = dto.vlans.map(v => v.vlanId);
    if (new Set(vlanIds).size !== vlanIds.length) {
      throw new BadRequestException('El baseline declara VLAN IDs duplicados.');
    }
    const ttNombres = dto.trafficTables.map(t => t.nombre);
    if (new Set(ttNombres).size !== ttNombres.length) {
      throw new BadRequestException('El baseline declara traffic tables con nombres duplicados.');
    }
    for (const t of dto.trafficTables) {
      if (t.pirKbps < t.cirKbps) {
        throw new BadRequestException(`Traffic table "${t.nombre}": PIR (${t.pirKbps}) no puede ser menor que CIR (${t.cirKbps}).`);
      }
    }

    // Versionado: nombre existente → versión siguiente
    const { max } = await this.repo
      .createQueryBuilder('b')
      .select('COALESCE(MAX(b.version), 0)', 'max')
      .where('b.empresaId = :empresaId AND b.nombre = :nombre', { empresaId, nombre: dto.nombre })
      .getRawOne<{ max: string }>();

    // TR-069: máximo una VLAN exclusiva, y siempre va taggeada al uplink
    // (sin camino al ACS la VLAN de gestión no sirve de nada).
    const tr069Vlans = dto.vlans.filter(v => v.proposito === 'tr069');
    if (tr069Vlans.length > 1) {
      throw new BadRequestException('El baseline declara más de una VLAN con propósito tr069 — debe ser exclusiva.');
    }
    for (const v of tr069Vlans) v.uplink = true;

    if (dto.vlans.some(v => v.uplink) && !dto.uplinkPort) {
      throw new BadRequestException(
        tr069Vlans.length
          ? 'La VLAN TR-069 debe taguearse al uplink: declara uplinkPort en el baseline.'
          : 'Hay VLANs con uplink:true pero el baseline no declara uplinkPort.',
      );
    }

    if (dto.servicePortRange && dto.servicePortRange.fin < dto.servicePortRange.inicio) {
      throw new BadRequestException('servicePortRange: "fin" debe ser ≥ "inicio".');
    }

    const spec: BaselineSpec = {
      vlans:         dto.vlans,
      trafficTables: dto.trafficTables,
      ntpServers:    dto.ntpServers,
      uplinkPort:    dto.uplinkPort,
      servicePortRange: dto.servicePortRange
        ? { inicio: dto.servicePortRange.inicio, fin: dto.servicePortRange.fin }
        : undefined,
    };

    const baseline = await this.repo.save(this.repo.create({
      empresaId,
      nombre:      dto.nombre,
      version:     Number(max) + 1,
      descripcion: dto.descripcion ?? null,
      spec,
      activo:      true,
    }));
    this.logger.log(`Baseline creado | ${baseline.nombre} v${baseline.version} (${baseline.id})`);
    return baseline;
  }

  // ── Generar el Baseline Datafast Estándar (definición canónica en código) ──
  // Idempotente: si la última versión del estándar ya tiene el mismo spec para
  // ese uplinkPort, la retorna sin crear una versión nueva.
  async generarEstandar(empresaId: string, uplinkPort: string): Promise<OltBaseline> {
    if (!/^\d+\/\d+\/\d+$/.test(uplinkPort)) {
      throw new BadRequestException('uplinkPort debe tener formato frame/slot/port, ej. 0/9/0');
    }
    const spec = construirSpecEstandar(uplinkPort);

    const ultima = await this.repo.findOne({
      where: { empresaId, nombre: BASELINE_ESTANDAR_NOMBRE },
      order: { version: 'DESC' },
    });
    // Comparación estable: Postgres jsonb NO preserva el orden de claves,
    // así que JSON.stringify directo nunca coincide (bug real: duplicó v3).
    if (ultima && this._stableStringify(ultima.spec) === this._stableStringify(spec)) {
      return ultima;
    }

    return this.crear(empresaId, {
      nombre:           BASELINE_ESTANDAR_NOMBRE,
      descripcion:      BASELINE_ESTANDAR_DESCRIPCION,
      vlans:            spec.vlans,
      trafficTables:    spec.trafficTables,
      uplinkPort:       spec.uplinkPort,
      servicePortRange: spec.servicePortRange,
    });
  }

  // JSON canónico con claves ordenadas recursivamente (comparación jsonb-safe).
  private _stableStringify(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(x => this._stableStringify(x)).join(',')}]`;
    if (v !== null && typeof v === 'object') {
      return `{${Object.keys(v as object).sort()
        .filter(k => (v as Record<string, unknown>)[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${this._stableStringify((v as Record<string, unknown>)[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(v);
  }

  async asignarAOlt(oltId: string, empresaId: string, baselineId: string | null): Promise<OltDispositivo> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada.`);

    if (baselineId !== null) {
      await this.obtener(baselineId, empresaId); // valida existencia y tenancy
    }
    olt.baselineId = baselineId;
    const saved = await this.oltRepo.save(olt);
    this.logger.log(`Baseline ${baselineId ?? '(ninguno)'} asignado a OLT ${olt.nombre}`);
    return saved;
  }
}
