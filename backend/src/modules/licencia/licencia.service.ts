import {
  Injectable, Logger, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createVerify, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { hostname } from 'os';
import * as https from 'https';
import * as http from 'http';

import { LicenciaEstado } from './entities/licencia-estado.entity';
import {
  LICENCIA_PUBLIC_KEY, LICENCIA_ISSUER, MACHINE_ID_SALT,
  GRACE_PERIOD_DAYS, LICENCIA_VALIDATION_URL, PLANES_LICENCIA, PlanCode,
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

  // Cache en memoria — no en Redis para evitar manipulación externa
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
    const licenseKey = this.config.get<string>('LICENSE_KEY') || '';

    if (!licenseKey || licenseKey === 'PASTE_YOUR_LICENSE_HERE') {
      this.setEstado(false, 'NO_LICENSE_KEY');
      this.logger.warn('⚠  Sistema sin licencia — configure LICENSE_KEY en .env');
      return;
    }

    let payload: any;
    try {
      payload = this.decodeAndVerifyJwt(licenseKey);
    } catch (e) {
      this.setEstado(false, 'INVALID_SIGNATURE');
      this.logger.error('Licencia con firma inválida — posible manipulación');
      return;
    }

    // Verificar emisor
    if (payload.iss !== LICENCIA_ISSUER) {
      this.setEstado(false, 'INVALID_ISSUER');
      this.logger.error('Licencia con emisor inválido');
      return;
    }

    // Verificar expiración
    const ahora = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < ahora) {
      this.setEstado(false, 'EXPIRED');
      this.logger.error('Licencia expirada');
      return;
    }

    // Verificar machine ID (wildcard '*' solo en modo desarrollo)
    const machineId = this.getMachineId();
    if (payload.mid !== '*' && payload.mid !== machineId) {
      this.setEstado(false, 'MACHINE_MISMATCH');
      this.logger.error('Licencia no válida para este servidor (machine ID no coincide)');
      return;
    }

    // Verificar plan
    const plan = payload.pln as PlanCode;
    if (!PLANES_LICENCIA[plan]) {
      this.setEstado(false, 'INVALID_PLAN');
      return;
    }

    const planDef = PLANES_LICENCIA[plan];

    // Licencia válida localmente → cargar estado
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

    // Persistir en BD y verificar online en background
    await this.persistirEnBd(licenseKey, payload, machineId).catch(() => {});
    this.validarOnline().catch(() => {});
  }

  // ── Verificación RSA-SHA256 manual del JWT ───────────────────
  private decodeAndVerifyJwt(token: string): any {
    const parts = token.trim().split('.');
    if (parts.length !== 3) throw new Error('JWT malformado');

    const [header, payload, sig] = parts;
    const signingInput = `${header}.${payload}`;

    // Verificar header
    const headerDecoded = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (headerDecoded.alg !== 'RS256') throw new Error('Algoritmo no soportado');

    // Verificar firma RSA-SHA256
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput, 'utf8');

    // base64url → base64 estándar
    const b64 = sig.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);

    const isValid = verifier.verify(LICENCIA_PUBLIC_KEY, padded, 'base64');
    if (!isValid) throw new Error('Firma RSA inválida');

    // Decodificar payload
    const payloadJson = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(payloadJson);
  }

  // ── Machine ID: SHA256(/etc/machine-id + salt) ───────────────
  getMachineId(): string {
    try {
      // Linux/VPS: usa el machine-id del sistema
      const raw = readFileSync('/etc/machine-id', 'utf8').trim();
      return createHash('sha256').update(raw + MACHINE_ID_SALT).digest('hex');
    } catch {
      // Windows (desarrollo): usa hostname como fallback
      return createHash('sha256').update(hostname() + MACHINE_ID_SALT).digest('hex');
    }
  }

  // ── Validación online (revocación) ──────────────────────────
  async validarOnline(): Promise<void> {
    if (!this.estado.licenseId) return;

    try {
      const body = JSON.stringify({
        licenseId: this.estado.licenseId,
        machineId: this.estado.machineId,
        plan:      this.estado.plan,
        version:   process.env.npm_package_version || '1.0.0',
      });

      const respText = await this.httpPost(LICENCIA_VALIDATION_URL, body);
      const resp = JSON.parse(respText);

      if (resp.revoked === true) {
        this.setEstado(false, 'REVOKED');
        this.logger.error('🔴 Licencia REVOCADA por el servidor de licencias');
        return;
      }

      // Actualizar lastOnlineValidatedAt en BD
      await this.repo.update(
        { licenseId: this.estado.licenseId },
        { lastOnlineValidatedAt: new Date(), estado: 'valid' },
      ).catch(() => {});

      this.logger.log('🌐 Validación online de licencia: OK');

    } catch {
      // No se pudo llegar al servidor → aplicar lógica de gracia
      this.logger.warn('⚠  No se pudo validar licencia online — verificando período de gracia');
      await this.aplicarGracia();
    }
  }

  private async aplicarGracia(): Promise<void> {
    const registro = await this.repo.findOne({
      where: { licenseId: this.estado.licenseId! },
    }).catch(() => null);

    if (!registro?.lastOnlineValidatedAt) {
      // Nunca se validó online pero la licencia es criptográficamente válida → mantener
      return;
    }

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
        plan:       payload.pln,
        maxClientes: PLANES_LICENCIA[payload.pln as PlanCode]?.maxClientes ?? 100,
        estado:     'valid',
        licenseJwt: jwt,
        machineId,
        expiresAt:  payload.exp ? new Date(payload.exp * 1000) : new Date('2099-01-01'),
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

  // ── Activar nueva licencia (reemplazar la actual) ─────────────
  async activarLicencia(licenseKey: string): Promise<EstadoMemoria> {
    // Guardar en env temporal para recargar
    process.env.LICENSE_KEY = licenseKey.trim();
    await this.cargarYVerificar();
    return this.estado;
  }

  // ── Verificar límite de clientes ──────────────────────────────
  async verificarLimiteClientes(empresaId: string, currentCount?: number): Promise<void> {
    const { valid, maxClientes } = this.estado;
    if (!valid) return; // El guard ya bloquea si es inválida

    if (maxClientes === -1) return; // Oro — ilimitado

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
    // Importar ClienteRepository directamente crearía dependencia circular.
    // Usamos query raw para evitarlo.
    const result = await this.repo.manager.query(
      `SELECT COUNT(*) as total FROM cliente WHERE "empresaId" = $1 AND estado NOT IN ('baja_definitiva')`,
      [empresaId],
    );
    return parseInt(result[0]?.total ?? '0', 10);
  }

  // ── Getters públicos ──────────────────────────────────────────
  getEstadoActual(): EstadoMemoria { return this.estado; }

  isValid(): boolean { return this.estado.valid; }

  getPlan(): PlanCode | null { return this.estado.plan; }

  getMaxClientes(): number { return this.estado.maxClientes; }

  // ── Helpers internos ─────────────────────────────────────────
  private setEstado(valid: boolean, razon: string): void {
    this.estado = {
      ...this.estado,
      valid,
      razon,
      lastChecked: new Date(),
    };
  }

  private httpPost(url: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.request(url, {
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 8000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
