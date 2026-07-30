import {
  Injectable, UnauthorizedException, ServiceUnavailableException,
  Logger, Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';

import { Cliente, EstadoCliente } from '../clientes/entities/cliente.entity';
import { PortalTenantService } from './portal-tenant.service';
import {
  PortalJwtPayload, PORTAL_JWT_AUDIENCE, PORTAL_JWT_ISSUER,
  COOKIE_ACCESS, COOKIE_REFRESH, leerCookie,
} from './portal-auth.guard';

const ACCESS_TTL  = '30m';
const REFRESH_TTL = '7d';
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_INTENTOS   = 5;
const VENTANA_MS     = 15 * 60 * 1000;

// Lazy getter: una constante de módulo se evalúa antes de que ConfigModule cargue
// el .env y quedaría vacía para siempre.
const getPortalSecret = (): string => (process.env.PORTAL_JWT_SECRET || '').trim();

export interface PortalSesion {
  clienteId:      string;
  usuario:        string;
  nombreCompleto: string;
}

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    @InjectRepository(Cliente)
    private readonly clienteRepo: Repository<Cliente>,
    private readonly jwt: JwtService,
    private readonly tenant: PortalTenantService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async login(
    usuario: string,
    password: string,
    req: Request,
    res: Response,
  ): Promise<PortalSesion> {
    const secreto = this.exigirSecreto();
    const empresaId = await this.tenant.resolverEmpresaId(req.headers.host);

    const usuarioNorm = usuario.trim().toLowerCase();
    const ip = req.ip ?? 'desconocida';

    await this.verificarBloqueo(empresaId, usuarioNorm, ip);

    // El índice único (empresa_id, lower(usuario_portal)) garantiza que esto devuelva
    // a lo sumo un cliente. Sin él la resolución sería ambigua.
    const cliente = await this.clienteRepo
      .createQueryBuilder('c')
      .where('c.empresa_id = :empresaId', { empresaId })
      .andWhere('lower(c.usuario_portal) = :usuario', { usuario: usuarioNorm })
      .andWhere('c.deleted_at IS NULL')
      .getOne();

    // Mismo mensaje y mismo coste aproximado para usuario inexistente y clave errada:
    // responder distinto convierte el login en un oráculo de qué usuarios existen.
    const hash = cliente?.passwordPortal ?? '';
    const claveOk = hash ? await bcrypt.compare(password, hash) : false;

    if (!cliente || !claveOk) {
      await this.registrarFallo(empresaId, usuarioNorm, ip);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    // Un abonado suspendido o cortado SÍ entra: es exactamente quien necesita ver su
    // deuda y pagar. Solo se bloquea la baja definitiva, que ya no es cliente.
    if (cliente.estado === EstadoCliente.BAJA_DEFINITIVA) {
      throw new UnauthorizedException('Este servicio ya no está activo.');
    }

    await this.limpiarIntentos(empresaId, usuarioNorm, ip);

    const payloadBase = {
      sub: cliente.id,
      empresaId,
      usuario: cliente.usuarioPortal,
    };

    const access  = await this.firmar({ ...payloadBase, tipo: 'access'  }, secreto, ACCESS_TTL);
    const refresh = await this.firmar({ ...payloadBase, tipo: 'refresh' }, secreto, REFRESH_TTL);

    this.escribirCookies(res, access, refresh);

    this.logger.log(`Portal login: ${cliente.usuarioPortal} (empresa ${empresaId}) desde ${ip}`);

    return {
      clienteId:      cliente.id,
      usuario:        cliente.usuarioPortal,
      nombreCompleto: this.nombreCompleto(cliente),
    };
  }

  async refresh(req: Request, res: Response): Promise<PortalSesion> {
    const secreto = this.exigirSecreto();
    const token = leerCookie(req, COOKIE_REFRESH);
    if (!token) throw new UnauthorizedException('Sesión no encontrada');

    let payload: PortalJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<PortalJwtPayload>(token, {
        secret: secreto, issuer: PORTAL_JWT_ISSUER, audience: PORTAL_JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Tu sesión expiró. Vuelve a iniciar sesión.');
    }
    if (payload.tipo !== 'refresh') {
      throw new UnauthorizedException('Token no válido para renovar la sesión');
    }

    // Se relee el cliente: un abonado dado de baja o con el usuario retirado no puede
    // seguir renovando su sesión durante 7 días por tener un refresh token vivo.
    const cliente = await this.clienteRepo.findOne({
      where: { id: payload.sub, empresaId: payload.empresaId },
    });
    if (!cliente || !cliente.usuarioPortal || cliente.estado === EstadoCliente.BAJA_DEFINITIVA) {
      this.borrarCookies(res);
      throw new UnauthorizedException('Tu acceso ya no está disponible.');
    }

    const base = { sub: cliente.id, empresaId: payload.empresaId, usuario: cliente.usuarioPortal };
    const access     = await this.firmar({ ...base, tipo: 'access'  }, secreto, ACCESS_TTL);
    const refreshNew = await this.firmar({ ...base, tipo: 'refresh' }, secreto, REFRESH_TTL);
    this.escribirCookies(res, access, refreshNew);

    return {
      clienteId:      cliente.id,
      usuario:        cliente.usuarioPortal,
      nombreCompleto: this.nombreCompleto(cliente),
    };
  }

  logout(res: Response): void {
    this.borrarCookies(res);
  }

  // ── Internos ────────────────────────────────────────────────
  private nombreCompleto(c: Cliente): string {
    return [c.nombres, c.apellidoPaterno, c.apellidoMaterno]
      .filter((p) => p && p.trim())
      .join(' ')
      .trim();
  }

  // Fallo cerrado: sin secreto propio no se emiten tokens. Compartir el secreto del
  // ERP dejaría a un token de abonado a una sola comprobación de distancia de valer
  // como token de operador.
  private exigirSecreto(): string {
    const secreto = getPortalSecret();
    if (secreto.length < 32) {
      this.logger.error(
        'PORTAL_JWT_SECRET ausente o demasiado corto: el portal no puede emitir sesiones.',
      );
      throw new ServiceUnavailableException(
        'El portal no está configurado en este servidor. Contacta a tu proveedor.',
      );
    }
    return secreto;
  }

  private firmar(
    payload: Omit<PortalJwtPayload, 'iat' | 'exp'>,
    secret: string,
    expiresIn: string,
  ): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret, expiresIn, issuer: PORTAL_JWT_ISSUER, audience: PORTAL_JWT_AUDIENCE,
    });
  }

  private escribirCookies(res: Response, access: string, refresh: string): void {
    const seguro = process.env.NODE_ENV === 'production';
    const comun = { httpOnly: true, secure: seguro, sameSite: 'lax' as const, path: '/' };
    // HttpOnly: el token no es legible por JavaScript, así que un XSS en el portal no
    // se lleva la sesión del abonado. El middleware de Next sí puede leerlo: corre en
    // el servidor.
    res.cookie(COOKIE_ACCESS,  access,  { ...comun, maxAge: 30 * 60 * 1000 });
    res.cookie(COOKIE_REFRESH, refresh, { ...comun, maxAge: REFRESH_MAX_AGE_MS });
  }

  private borrarCookies(res: Response): void {
    const seguro = process.env.NODE_ENV === 'production';
    const comun = { httpOnly: true, secure: seguro, sameSite: 'lax' as const, path: '/' };
    res.clearCookie(COOKIE_ACCESS, comun);
    res.clearCookie(COOKIE_REFRESH, comun);
  }

  // ── Freno de fuerza bruta ───────────────────────────────────
  // Se cuenta por usuario Y por IP: solo por usuario, una botnet prueba una clave
  // contra miles de abonados; solo por IP, un CGNAT deja fuera a un barrio entero.
  private claves(empresaId: string, usuario: string, ip: string): string[] {
    return [`portal_lf:u:${empresaId}:${usuario}`, `portal_lf:i:${empresaId}:${ip}`];
  }

  private async verificarBloqueo(empresaId: string, usuario: string, ip: string): Promise<void> {
    for (const clave of this.claves(empresaId, usuario, ip)) {
      const intentos = (await this.cache.get<number>(clave)) ?? 0;
      if (intentos >= MAX_INTENTOS) {
        throw new UnauthorizedException(
          'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.',
        );
      }
    }
  }

  private async registrarFallo(empresaId: string, usuario: string, ip: string): Promise<void> {
    for (const clave of this.claves(empresaId, usuario, ip)) {
      const intentos = ((await this.cache.get<number>(clave)) ?? 0) + 1;
      await this.cache.set(clave, intentos, VENTANA_MS);
    }
    this.logger.warn(`Portal login fallido: usuario "${usuario}" desde ${ip}`);
  }

  private async limpiarIntentos(empresaId: string, usuario: string, ip: string): Promise<void> {
    for (const clave of this.claves(empresaId, usuario, ip)) {
      await this.cache.del(clave);
    }
  }
}
