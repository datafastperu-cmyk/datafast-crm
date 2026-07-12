import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { randomInt } from 'crypto';

import { ContratoOnuConfig } from '../entities/contrato-onu-config.entity';
import { encrypt } from '../../../common/utils/encryption.util';

// ── DTO ───────────────────────────────────────────────────────────────────
export class UpsertOnuConfigDto {
  @IsOptional() @IsBoolean() wifiEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(32) wifiSsid?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(63) wifiPassword?: string;
  @IsOptional() @IsString() @MaxLength(32) wifi5gSsid?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(63) wifi5gPassword?: string;
  @IsOptional() @IsBoolean() voipEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(64) voipUser?: string;
  @IsOptional() @IsString() @MaxLength(64) voipPassword?: string;
  @IsOptional() @IsBoolean() onuAdminEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(64) onuAdminUser?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(64) onuAdminPassword?: string;
  @IsOptional() @IsString() @MaxLength(64) onuWebUser?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(64) onuWebUserPassword?: string;
  @IsOptional() @IsString() @MaxLength(64) onuCliUser?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(64) onuCliPassword?: string;
}

// Genera una clave fuerte (12 chars, sin ambiguos) con complejidad garantizada
// (mayúscula, minúscula, dígito, símbolo) — pasa el CheckPasswordComplex del firmware.
function genStrongPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const spec  = '#$%&*+';
  const all   = upper + lower + digit + spec;
  const pick  = (s: string) => s[randomInt(s.length)];
  const chars = [pick(upper), pick(lower), pick(digit), pick(spec)];
  for (let i = 0; i < 8; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {   // Fisher-Yates
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// ContratoOnuConfigService — lado de ENTRADA del pipeline ZTP.
// Gestiona la config de servicio de la ONU (WiFi/VoIP) en términos de negocio.
// Secretos CIFRADOS. Cada cambio sube `revision` (base de reconciliación).
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class ContratoOnuConfigService {
  private readonly logger = new Logger(ContratoOnuConfigService.name);

  constructor(
    @InjectRepository(ContratoOnuConfig)
    private readonly repo: Repository<ContratoOnuConfig>,
  ) {}

  get(contratoId: string, empresaId: string): Promise<ContratoOnuConfig | null> {
    return this.repo.findOne({ where: { contratoId, empresaId } });
  }

  private _nuevo(contratoId: string, empresaId: string): ContratoOnuConfig {
    return this.repo.create({
      contratoId, empresaId,
      wifiEnabled: true, wifiPasswordGenerated: true,
      voipEnabled: false, provisioningEnabled: false, revision: 0,
    });
  }

  async upsert(contratoId: string, empresaId: string, dto: UpsertOnuConfigDto): Promise<ContratoOnuConfig> {
    const row = (await this.repo.findOne({ where: { contratoId, empresaId } })) ?? this._nuevo(contratoId, empresaId);

    if (dto.wifiEnabled !== undefined) row.wifiEnabled = dto.wifiEnabled;
    if (dto.wifiSsid    !== undefined) row.wifiSsid    = dto.wifiSsid;
    if (dto.wifiPassword !== undefined) {
      row.wifiPassword          = encrypt(dto.wifiPassword);
      row.wifiPasswordGenerated = false;   // la puso el cliente/operador
      row.lastGeneratedAt       = null;
    }
    if (dto.wifi5gSsid     !== undefined) row.wifi5gSsid     = dto.wifi5gSsid;
    if (dto.wifi5gPassword !== undefined) row.wifi5gPassword = encrypt(dto.wifi5gPassword);
    if (dto.voipEnabled    !== undefined) row.voipEnabled    = dto.voipEnabled;
    if (dto.voipUser       !== undefined) row.voipUser       = dto.voipUser;
    if (dto.voipPassword   !== undefined) row.voipPassword   = encrypt(dto.voipPassword);
    if (dto.onuAdminEnabled  !== undefined) row.onuAdminEnabled  = dto.onuAdminEnabled;
    if (dto.onuAdminUser     !== undefined) row.onuAdminUser     = dto.onuAdminUser;
    if (dto.onuAdminPassword !== undefined) row.onuAdminPassword = encrypt(dto.onuAdminPassword);
    if (dto.onuWebUser         !== undefined) row.onuWebUser         = dto.onuWebUser;
    if (dto.onuWebUserPassword !== undefined) row.onuWebUserPassword = encrypt(dto.onuWebUserPassword);
    if (dto.onuCliUser         !== undefined) row.onuCliUser         = dto.onuCliUser;
    if (dto.onuCliPassword     !== undefined) row.onuCliPassword     = encrypt(dto.onuCliPassword);

    row.revision = (row.revision ?? 0) + 1;
    const saved = await this.repo.save(row);
    this.logger.log(`upsert config | contrato=${contratoId} rev=${saved.revision}`);
    return saved;
  }

  // Genera SSID (si falta) + clave WiFi fuerte. Devuelve la clave EN CLARO una vez
  // (para mostrarla/entregarla); en BD queda cifrada. Marca wifi_password_generated.
  async generateWifi(contratoId: string, empresaId: string): Promise<{ ssid: string; password: string }> {
    const row = (await this.repo.findOne({ where: { contratoId, empresaId } })) ?? this._nuevo(contratoId, empresaId);
    const ssid     = row.wifiSsid ?? `DATAFAST-${contratoId.replace(/-/g, '').slice(-4).toUpperCase()}`;
    const password = genStrongPassword();

    row.wifiSsid              = ssid;
    row.wifiEnabled           = true;
    row.wifiPassword          = encrypt(password);
    row.wifiPasswordGenerated = true;
    row.lastGeneratedAt       = new Date();
    row.revision              = (row.revision ?? 0) + 1;

    await this.repo.save(row);
    this.logger.log(`generateWifi | contrato=${contratoId} ssid=${ssid} rev=${row.revision}`);
    return { ssid, password };
  }

  async setProvisioningEnabled(contratoId: string, empresaId: string, enabled: boolean): Promise<ContratoOnuConfig> {
    const row = await this.repo.findOne({ where: { contratoId, empresaId } });
    if (!row) throw new NotFoundException(`El contrato ${contratoId} no tiene config de ONU.`);
    row.provisioningEnabled = enabled;
    const saved = await this.repo.save(row);
    this.logger.warn(`provisioning_enabled=${enabled} | contrato=${contratoId}`);
    return saved;
  }
}
