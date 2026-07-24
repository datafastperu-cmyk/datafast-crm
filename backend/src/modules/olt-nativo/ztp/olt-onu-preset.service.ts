import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { OltOnuPreset } from '../entities/olt-onu-preset.entity';
import { encrypt, decrypt } from '../../../common/utils/encryption.util';
import { ContratoOnuConfigService } from './contrato-onu-config.service';

// ── DTO de edición del preset (la "sección TR-069 de la OLT") ────────────────
export class UpsertOltPresetDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(64) wifiSsidTemplate?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(63) wifiPassword?: string;
  @IsOptional() @IsString() @MaxLength(64) wifi5gSsidTemplate?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(63) wifi5gPassword?: string;
  @IsOptional() @IsString() @MaxLength(64) onuAdminUser?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(64) onuAdminPassword?: string;
}

/** Vista del preset para la UI. Devuelve las claves EN CLARO: el operador (admin autenticado)
 *  necesita verlas para gestionarlas/entregarlas, igual que SmartOLT. */
export interface OltPresetView {
  oltId:              string;
  enabled:            boolean;
  wifiSsidTemplate:   string | null;
  wifi5gSsidTemplate: string | null;
  onuAdminUser:       string | null;
  wifiPassword:       string | null;
  wifi5gPassword:     string | null;
  onuAdminPassword:   string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// OltOnuPresetService — preset de auto-config por OLT.
// Al aprovisionar (o tras factory-reset), `aplicarAContrato` resuelve la plantilla del SSID
// con los datos del cliente y vuelca el preset en `contrato_onu_config`, encendiendo el
// pipeline ZTP que lo escribe en la ONU por TR-069.
// ═══════════════════════════════════════════════════════════════════════════
@Injectable()
export class OltOnuPresetService {
  private readonly logger = new Logger(OltOnuPresetService.name);

  constructor(
    @InjectRepository(OltOnuPreset)
    private readonly repo: Repository<OltOnuPreset>,
    private readonly onuConfig: ContratoOnuConfigService,
  ) {}

  async getView(oltId: string, empresaId: string): Promise<OltPresetView | null> {
    const p = await this.repo.findOne({ where: { oltId, empresaId } });
    if (!p) return null;
    const dec = (v: string | null): string | null => {
      if (!v) return null;
      try { return decrypt(v); } catch { return null; }
    };
    return {
      oltId:              p.oltId,
      enabled:            p.enabled,
      wifiSsidTemplate:   p.wifiSsidTemplate,
      wifi5gSsidTemplate: p.wifi5gSsidTemplate,
      onuAdminUser:       p.onuAdminUser,
      wifiPassword:       dec(p.wifiPassword),
      wifi5gPassword:     dec(p.wifi5gPassword),
      onuAdminPassword:   dec(p.onuAdminPassword),
    };
  }

  async upsert(oltId: string, empresaId: string, dto: UpsertOltPresetDto): Promise<OltPresetView> {
    const p = (await this.repo.findOne({ where: { oltId, empresaId } }))
      ?? this.repo.create({ oltId, empresaId, enabled: false });

    if (dto.enabled            !== undefined) p.enabled            = dto.enabled;
    if (dto.wifiSsidTemplate   !== undefined) p.wifiSsidTemplate   = dto.wifiSsidTemplate;
    if (dto.wifi5gSsidTemplate !== undefined) p.wifi5gSsidTemplate = dto.wifi5gSsidTemplate;
    if (dto.onuAdminUser       !== undefined) p.onuAdminUser       = dto.onuAdminUser;
    // Secretos: solo se re-cifran si vienen en el dto (undefined = no tocar).
    if (dto.wifiPassword       !== undefined) p.wifiPassword       = encrypt(dto.wifiPassword);
    if (dto.wifi5gPassword     !== undefined) p.wifi5gPassword     = encrypt(dto.wifi5gPassword);
    if (dto.onuAdminPassword   !== undefined) p.onuAdminPassword   = encrypt(dto.onuAdminPassword);

    await this.repo.save(p);
    this.logger.log(`upsert preset | olt=${oltId} enabled=${p.enabled}`);
    return (await this.getView(oltId, empresaId))!;
  }

  // Resuelve la plantilla del SSID con los datos del cliente. Placeholders: {cliente}, {contrato},
  // {sn}. Sanea el resultado (SSID válido, ≤32 chars).
  private _resolverSsid(template: string, ctx: { cliente?: string; contrato?: string; sn?: string }): string {
    const raw = template
      .replace(/\{cliente\}/gi,  ctx.cliente  ?? '')
      .replace(/\{contrato\}/gi, ctx.contrato ?? '')
      .replace(/\{sn\}/gi,       ctx.sn       ?? '');
    // Sanea: colapsa espacios, quita caracteres raros, recorta a 32.
    return raw.replace(/\s+/g, ' ').replace(/[^\w\- ]/g, '').trim().slice(0, 32) || 'DATAFAST';
  }

  /**
   * Vuelca el preset de la OLT en la config del contrato y enciende el pipeline ZTP.
   * Idempotente y best-effort: si no hay preset o está deshabilitado, no hace nada.
   * Lo usan el hook de provisión y (vía re-inyección) el flujo post-factory-reset.
   */
  async aplicarAContrato(
    oltId:      string,
    contratoId: string,
    empresaId:  string,
    ctx:        { cliente?: string; contrato?: string; sn?: string },
  ): Promise<{ aplicado: boolean; motivo?: string }> {
    const p = await this.repo.findOne({ where: { oltId, empresaId } });
    if (!p || !p.enabled) return { aplicado: false, motivo: 'preset no configurado o deshabilitado' };
    if (!p.wifiSsidTemplate && !p.onuAdminUser) return { aplicado: false, motivo: 'preset vacío' };

    const ssid24 = p.wifiSsidTemplate ? this._resolverSsid(p.wifiSsidTemplate, ctx) : undefined;
    const ssid5  = p.wifi5gSsidTemplate
      ? this._resolverSsid(p.wifi5gSsidTemplate, ctx)
      : ssid24 ? this._resolverSsid(`${p.wifiSsidTemplate}-5G`, ctx) : undefined;
    const pass24 = p.wifiPassword ? decrypt(p.wifiPassword) : undefined;
    const pass5  = p.wifi5gPassword ? decrypt(p.wifi5gPassword) : pass24; // 5G reusa la clave de 2.4 si no tiene propia
    const adminPass = p.onuAdminPassword ? decrypt(p.onuAdminPassword) : undefined;

    await this.onuConfig.upsert(contratoId, empresaId, {
      ...(ssid24 ? { wifiEnabled: true, wifiSsid: ssid24 } : {}),
      ...(pass24 ? { wifiPassword: pass24 } : {}),
      ...(ssid5  ? { wifi5gSsid: ssid5 } : {}),
      ...(pass5  ? { wifi5gPassword: pass5 } : {}),
      ...(p.onuAdminUser ? { onuAdminEnabled: true, onuAdminUser: p.onuAdminUser } : {}),
      ...(adminPass ? { onuAdminPassword: adminPass } : {}),
    });
    await this.onuConfig.setProvisioningEnabled(contratoId, empresaId, true);

    this.logger.log(`preset aplicado | olt=${oltId} contrato=${contratoId} ssid24=${ssid24 ?? '-'}`);
    return { aplicado: true };
  }
}
