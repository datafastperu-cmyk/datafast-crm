import {
  Injectable, Logger, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createVerify, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { hostname } from 'os';

// Stub local — reemplaza @datafast/license-sdk sin dependencia externa
class LicenseClient {
  private opts: { serverUrl: string; heartbeatSecret: string; productSlug: string; timeoutMs: number };
  constructor(opts: { serverUrl: string; heartbeatSecret: string; productSlug: string; timeoutMs: number }) {
    this.opts = opts;
  }
  async heartbeat(data: { licenseId: string; machineId: string; plan?: string; version: string }): Promise<{ revoked: boolean }> {
    try {
      const resp = await fetch(`${this.opts.serverUrl}/api/v1/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Heartbeat-Secret': this.opts.heartbeatSecret },
        body: JSON.stringify({ ...data, product: this.opts.productSlug }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      if (!resp.ok) return { revoked: false };
      const json = await resp.json() as any;
      return { revoked: !!json.revoked };
    } catch { return { revoked: false }; }
  }
  async activate(data: { licenseId: string; machineId: string; hostname: string; version: string }): Promise<void> {
    try {
      await fetch(`${this.opts.serverUrl}/api/v1/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Heartbeat-Secret': this.opts.heartbeatSecret },
        body: JSON.stringify({ ...data, product: this.opts.productSlug }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch { /* activación no crítica */ }
  }
}
import { LicenciaEstado } from './entities/licencia-estado.entity';
import {
  LICENCIA_PUBLIC_KEY, LICENCIA_ISSUER, MACHINE_ID_SALT,
  GRACE_PERIOD_DAYS, LICENCIA_SERVER_URL, PLANES_LICENCIA, PlanCode,
} from './licencia.constants';

export interface EstadoMemoria {
  valid:        boolean;
  plan:         PlanCode | null;
  maxClientes:  number;
  licenseId:    string | null;
  issuedTo:     string | null;
  expiresAt:    Date | null;
  machineId:    string | null;
  razon:        string;
  lastChecked:  Date;
}

@Injectable()
export class LicenciaService implements OnModuleInit {
  private readonly logger = new Logger(LicenciaService.name);

  private estado: EstadoMemoria = {
    valid:       false,
    plan:        null,
    maxClientes: 0,
    licenseId:   null,
    issuedTo:    null,
    expiresAt:   null,
    machineId:   null,
    razon:       'NOT_INITIALIZED',
    lastChecked: new Date(),
  };

  // SDK client — lazy init para no fallar si HEARTBEAT_SECRET no está cargado aún
  private sdk: LicenseClient | null = null;

  constructor(
    @InjectRepository(LicenciaEstado)
    private readonly repo: Repository<LicenciaEstado>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.cargarYVerificar();
  }

  // ── Carga y verificación completa al iniciar ──────────────────
  async cargarYVerificar(): Promise<void> {
    let licenseKey = this.config.get<string>('LICENSE_KEY') || process.env.LICENSE_KEY || '';

    if (!licenseKey || licenseKey === 'PASTE_YOUR_LICENSE_HERE') {
      licenseKey = await this.cargarJwtDesdeBD();
    }

    if (!licenseKey) {
      this.setEstado(false, 'NO_LICENSE_KEY');
      this.logger.warn('⚠  Sistema sin licencia — configure LICENSE_KEY en .env o active una licencia');
      return;
    }

    let payload: any;
    try {
      payload = this.decodeAndVerifyJwt(licenseKey);
    } catch {
      this.setEstado(false, 'INVALID_SIGNATURE');
      this.logger.error('Licencia con firma inválida — posible manipulación');
      return;
    }

    if (payload.iss !== LICENCIA_ISSUER) {
      this.setEstado(false, 'INVALID_ISSUER');
      return;
    }

    const ahora = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < ahora) {
      this.setEstado(false, 'EXPIRED');
      return;
    }

    const machineId = this.getMachineId();
    if (payload.mid !== '*' && payload.mid !== machineId) {
      this.setEstado(false, 'MACHINE_MISMATCH');
      this.logger.error('Licencia no válida para este servidor (machine ID no coincide)');
      return;
    }

    const plan = payload.pln as PlanCode;
    if (!PLANES_LICENCIA[plan]) {
      this.setEstado(false, 'INVALID_PLAN');
      return;
    }

    const planDef = PLANES_LICENCIA[plan];

    this.estado = {
      valid:       true,
      plan,
      maxClientes: planDef.maxClientes,
      licenseId:   payload.jti,
      issuedTo:    payload.sub,
      expiresAt:   payload.exp ? new Date(payload.exp * 1000) : null,
      machineId,
      razon:       'OK',
      lastChecked: new Date(),
    };

    this.logger.log(`✅ Licencia válida — Plan: ${planDef.nombre} | Titular: ${payload.sub} | Máx clientes: ${planDef.maxClientes === -1 ? '∞' : planDef.maxClientes}`);

    await this.persistirEnBd(licenseKey, payload, machineId).catch(() => {});
    this.validarOnline().catch(() => {});
  }

  // ── Verificación RSA-SHA256 manual del JWT ───────────────────
  private decodeAndVerifyJwt(token: string): any {
    const parts = token.trim().split('.');
    if (parts.length !== 3) throw new Error('JWT malformado');

    const [header, payload, sig] = parts;
    const headerDecoded = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (headerDecoded.alg !== 'RS256') throw new Error('Algoritmo no soportado');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`, 'utf8');

    const b64    = sig.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);

    if (!verifier.verify(LICENCIA_PUBLIC_KEY, padded, 'base64')) {
      throw new Error('Firma RSA inválida');
    }

    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  }

  // ── Machine ID: SHA256(/etc/machine-id + salt) ───────────────
  getMachineId(): string {
    try {
      const raw = readFileSync('/etc/machine-id', 'utf8').trim();
      return createHash('sha256').update(raw + MACHINE_ID_SALT).digest('hex');
    } catch {
      return createHash('sha256').update(hostname() + MACHINE_ID_SALT).digest('hex');
    }
  }

  // ── SDK client (lazy) ────────────────────────────────────────
  private getSdk(): LicenseClient {
    if (!this.sdk) {
      this.sdk = new LicenseClient({
        serverUrl:       LICENCIA_SERVER_URL,
        heartbeatSecret: this.config.get<string>('HEARTBEAT_SECRET') || MACHINE_ID_SALT,
        productSlug:     'crm-isp',
        timeoutMs:       8000,
      });
    }
    return this.sdk;
  }

  // ── Validación online via SDK (revocación) ───────────────────
  async validarOnline(): Promise<void> {
    if (!this.estado.licenseId) return;

    try {
      const resp = await this.getSdk().heartbeat({
        licenseId: this.estado.licenseId,
        machineId: this.estado.machineId!,
        plan:      this.estado.plan ?? undefined,
        version:   process.env.npm_package_version || '1.0.0',
      });

      if (resp.revoked) {
        this.setEstado(false, 'REVOKED');
        this.logger.error('🔴 Licencia REVOCADA por el servidor de licencias');
        return;
      }

      await this.repo.update(
        { licenseId: this.estado.licenseId },
        { lastOnlineValidatedAt: new Date(), estado: 'valid' },
      ).catch(() => {});

      this.logger.log('🌐 Validación online de licencia: OK');

    } catch {
      this.logger.warn('⚠  No se pudo validar licencia online — verificando período de gracia');
      await this.aplicarGracia();
    }
  }

  private async aplicarGracia(): Promise<void> {
    const registro = await this.repo.findOne({
      where: { licenseId: this.estado.licenseId! },
    }).catch(() => null);

    if (!registro?.lastOnlineValidatedAt) return;

    const diasSinValidar = (Date.now() - registro.lastOnlineValidatedAt.getTime()) / 86_400_000;

    if (diasSinValidar > GRACE_PERIOD_DAYS) {
      this.setEstado(false, 'GRACE_EXPIRED');
      await this.repo.update({ licenseId: this.estado.licenseId! }, { estado: 'locked' }).catch(() => {});
      this.logger.error(`🔴 Período de gracia de ${GRACE_PERIOD_DAYS} días expirado — sistema bloqueado`);
    } else {
      this.logger.warn(`⚠  Modo gracia: ${Math.ceil(GRACE_PERIOD_DAYS - diasSinValidar)} días restantes`);
    }
  }

  // ── Persistencia en BD ────────────────────────────────────────
  private async persistirEnBd(jwt: string, payload: any, machineId: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { licenseId: payload.jti } });

    if (existing) {
      await this.repo.update({ licenseId: payload.jti }, {
        plan:        payload.pln,
        maxClientes: PLANES_LICENCIA[payload.pln as PlanCode]?.maxClientes ?? 100,
        estado:      'valid',
        licenseJwt:  jwt,
        machineId,
        expiresAt:   payload.exp ? new Date(payload.exp * 1000) : new Date('2099-01-01'),
      });
    } else {
      await this.repo.save(this.repo.create({
        licenseId:   payload.jti,
        plan:        payload.pln,
        maxClientes: PLANES_LICENCIA[payload.pln as PlanCode]?.maxClientes ?? 100,
        issuedTo:    payload.sub,
        machineId,
        expiresAt:   payload.exp ? new Date(payload.exp * 1000) : new Date('2099-01-01'),
        estado:      'valid',
        licenseJwt:  jwt,
      }));
    }
  }

  // ── Activar nueva licencia (desde panel admin del CRM) ────────
  async activarLicencia(licenseKey: string): Promise<EstadoMemoria> {
    process.env.LICENSE_KEY = licenseKey.trim();
    await this.cargarYVerificar();

    // Si la licencia es válida, registrarla en el LS vía SDK
    if (this.estado.valid && this.estado.licenseId) {
      this.getSdk().activate({
        licenseId: this.estado.licenseId,
        machineId: this.estado.machineId!,
        hostname:  hostname(),
        version:   process.env.npm_package_version || '1.0.0',
      }).catch((e) => {
        this.logger.warn(`No se pudo registrar activación en LS: ${e.message}`);
      });
    }

    return this.estado;
  }

  // ── Cargar JWT desde BD (fallback) ────────────────────────────
  private async cargarJwtDesdeBD(): Promise<string> {
    try {
      const registro = await this.repo.findOne({
        where: { estado: 'valid' },
        order: { updatedAt: 'DESC' },
      });
      if (registro?.licenseJwt) {
        this.logger.log('Cargando licencia desde BD (fallback)');
        return registro.licenseJwt;
      }
    } catch { }
    return '';
  }

  // ── Verificar límite de clientes ──────────────────────────────
  async verificarLimiteClientes(empresaId: string, currentCount?: number): Promise<void> {
    const { valid, maxClientes } = this.estado;
    if (!valid) return;
    if (maxClientes === -1) return;

    const count = currentCount ?? await this.contarClientesActivos(empresaId);

    if (count >= maxClientes) {
      throw Object.assign(new Error('LIMITE_CLIENTES_ALCANZADO'), {
        statusCode: 402,
        error:      'LICENSE_LIMIT',
        message:    `Su plan ${PLANES_LICENCIA[this.estado.plan!]?.nombre} permite máximo ${maxClientes} clientes. Actualice su licencia para agregar más.`,
      });
    }
  }

  private async contarClientesActivos(empresaId: string): Promise<number> {
    const result = await this.repo.manager.query(
      `SELECT COUNT(*) as total FROM cliente WHERE "empresaId" = $1 AND estado NOT IN ('baja_definitiva')`,
      [empresaId],
    );
    return parseInt(result[0]?.total ?? '0', 10);
  }

  // ── Revocación push desde Licensing Server (webhook) ─────────
  async revocarPorWebhook(licenseId: string, razon: string): Promise<void> {
    if (this.estado.licenseId === licenseId) {
      this.setEstado(false, 'REVOKED');
    }
    await this.repo.update({ licenseId }, { estado: 'locked' }).catch(() => {});
    this.logger.error(`🔴 Licencia revocada remotamente: ${licenseId} — ${razon}`);
  }

  // ── Getters públicos ──────────────────────────────────────────
  getEstadoActual(): EstadoMemoria { return this.estado; }
  isValid(): boolean               { return this.estado.valid; }
  getPlan(): PlanCode | null       { return this.estado.plan; }
  getMaxClientes(): number         { return this.estado.maxClientes; }

  // ── Helper interno ───────────────────────────────────────────
  private setEstado(valid: boolean, razon: string): void {
    this.estado = { ...this.estado, valid, razon, lastChecked: new Date() };
  }
}
