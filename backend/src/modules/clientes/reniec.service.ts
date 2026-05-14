import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import { ReniecResponseDto } from './dto/cliente.dto';

// ─────────────────────────────────────────────────────────────
// Servicio de integración con RENIEC Perú
//
// Proveedores soportados (por orden de prioridad):
// 1. apis.net.pe  (tokens gratuitos, recomendado)
// 2. apiperu.dev  (alternativa)
// 3. consulta.pe  (alternativa paga)
//
// Los datos se cachean 24h para reducir llamadas a la API.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class ReniecService {
  private readonly logger = new Logger(ReniecService.name);

  // TTL del cache de consultas RENIEC: 24 horas
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ── Consultar DNI ────────────────────────────────────────────
  async consultarDni(dni: string): Promise<ReniecResponseDto> {
    const dniClean = dni.trim().replace(/\D/g, '');

    if (dniClean.length !== 8) {
      throw new BadRequestException('El DNI debe tener exactamente 8 dígitos');
    }

    // ── 1. Verificar cache ─────────────────────────────────────
    const cacheKey = `reniec:dni:${dniClean}`;
    const cached = await this.cache.get<ReniecResponseDto>(cacheKey);
    if (cached) {
      this.logger.debug(`RENIEC cache hit: DNI ${dniClean}`);
      return { ...cached, fuente: cached.fuente + ' (cache)' };
    }

    // ── 2. Intentar con cada proveedor ─────────────────────────
    const providers = [
      () => this.consultarApisNetPe(dniClean),
      () => this.consultarApiPeru(dniClean),
      () => this.consultarConsultaPe(dniClean),
    ];

    let lastError: Error;

    for (const provider of providers) {
      try {
        const result = await provider();
        if (result) {
          // Guardar en cache exitoso
          await this.cache.set(cacheKey, result, this.CACHE_TTL_MS);
          this.logger.log(`RENIEC OK: ${dniClean} → ${result.nombreCompleto}`);
          return result;
        }
      } catch (error) {
        lastError = error;
        this.logger.warn(`RENIEC provider failed: ${error.message}`);
        // Continuar con el siguiente proveedor
        continue;
      }
    }

    // Todos los proveedores fallaron
    this.logger.error(`RENIEC: todos los proveedores fallaron para DNI ${dniClean}`);
    throw new ServiceUnavailableException(
      'No se pudo consultar RENIEC en este momento. Ingresa los datos manualmente.',
    );
  }

  // ── Proveedor 1: apis.net.pe ──────────────────────────────────
  private async consultarApisNetPe(dni: string): Promise<ReniecResponseDto> {
    const url = this.config.get('app.reniec.url', 'https://api.apis.net.pe/v2');
    const token = this.config.get('app.reniec.token');

    if (!token) throw new Error('Token RENIEC no configurado (apis.net.pe)');

    const response = await firstValueFrom(
      this.http.get(`${url}/reniec/dni`, {
        params: { numero: dni },
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        timeout: 8000,
      }),
    );

    const data = response.data;
    if (!data?.nombres) throw new Error('apis.net.pe: respuesta sin datos de nombres');

    return this.normalizar({
      nombres: data.nombres,
      apellidoPaterno: data.apellidoPaterno,
      apellidoMaterno: data.apellidoMaterno,
      dni,
      direccion: data.direccion,
      ubigeo: data.ubigeo,
      fuente: 'apis.net.pe',
      raw: data,
    });
  }

  // ── Proveedor 2: apiperu.dev ──────────────────────────────────
  private async consultarApiPeru(dni: string): Promise<ReniecResponseDto> {
    const token = this.config.get('app.reniec.token');
    if (!token) throw new Error('Token no configurado');

    const response = await firstValueFrom(
      this.http.get('https://apiperu.dev/api/dni', {
        params: { dni },
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        timeout: 8000,
      }),
    );

    const data = response.data?.data;
    if (!data?.nombre) throw new Error('apiperu.dev: sin datos');

    return this.normalizar({
      nombres: data.nombre,
      apellidoPaterno: data.apellido_paterno,
      apellidoMaterno: data.apellido_materno,
      dni,
      direccion: data.direccion,
      fuente: 'apiperu.dev',
      raw: data,
    });
  }

  // ── Proveedor 3: consulta.pe ──────────────────────────────────
  private async consultarConsultaPe(dni: string): Promise<ReniecResponseDto> {
    const token = this.config.get('app.reniec.token');
    if (!token) throw new Error('Token no configurado');

    const response = await firstValueFrom(
      this.http.get(`https://api.consulta.pe/v1/dni/${dni}`, {
        headers: {
          'X-Api-Key': token,
          Accept: 'application/json',
        },
        timeout: 8000,
      }),
    );

    const data = response.data;
    if (!data?.nombre_completo) throw new Error('consulta.pe: sin datos');

    const partes = data.nombre_completo.split(' ');
    return this.normalizar({
      nombres: partes.slice(2).join(' '),
      apellidoPaterno: partes[0] || '',
      apellidoMaterno: partes[1] || '',
      dni,
      fuente: 'consulta.pe',
      raw: data,
    });
  }

  // ── Normalizar respuesta de cualquier proveedor ────────────────
  private normalizar(params: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno?: string;
    dni: string;
    direccion?: string;
    ubigeo?: string;
    fuente: string;
    raw?: any;
  }): ReniecResponseDto {
    const nombres         = this.capitalizarNombre(params.nombres?.trim() || '');
    const apellidoPaterno = this.capitalizarNombre(params.apellidoPaterno?.trim() || '');
    const apellidoMaterno = this.capitalizarNombre(params.apellidoMaterno?.trim() || '');

    const nombreCompleto = [nombres, apellidoPaterno, apellidoMaterno]
      .filter(Boolean)
      .join(' ');

    return {
      nombres,
      apellidoPaterno,
      apellidoMaterno,
      nombreCompleto,
      dni: params.dni,
      direccion: params.direccion,
      ubigeo: params.ubigeo,
      fuente: params.fuente,
      consultadoEn: new Date().toISOString(),
    };
  }

  // ── Capitalizar correctamente nombres peruanos ─────────────────
  // "JUAN CARLOS" → "Juan Carlos"
  // "DE LA CRUZ" → "De La Cruz"
  private capitalizarNombre(nombre: string): string {
    const excepciones = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E']);
    return nombre
      .toLowerCase()
      .split(' ')
      .map((word, idx) => {
        if (idx > 0 && excepciones.has(word.toUpperCase())) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  // ── Consultar RUC (para clientes empresa) ─────────────────────
  async consultarRuc(ruc: string): Promise<{ razonSocial: string; estado: string; direccion?: string }> {
    const rucClean = ruc.trim().replace(/\D/g, '');
    if (rucClean.length !== 11) {
      throw new BadRequestException('El RUC debe tener 11 dígitos');
    }

    const cacheKey = `reniec:ruc:${rucClean}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const url = this.config.get('app.reniec.url', 'https://api.apis.net.pe/v2');
    const token = this.config.get('app.reniec.token');

    try {
      const response = await firstValueFrom(
        this.http.get(`${url}/sunat/ruc`, {
          params: { numero: rucClean },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 8000,
        }),
      );

      const data = response.data;
      const result = {
        razonSocial: data.razonSocial || data.nombre || '',
        estado: data.estado || 'ACTIVO',
        direccion: data.direccion,
      };

      await this.cache.set(cacheKey, result, this.CACHE_TTL_MS);
      return result;
    } catch (error) {
      throw new ServiceUnavailableException('No se pudo consultar el RUC. Ingresa los datos manualmente.');
    }
  }
}
