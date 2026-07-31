import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleSyncService, GoogleSyncResult } from '../entities/google-sync-log.entity';
import { ModuleHealthService } from '../../../common/services/module-health.service';

export interface GeocodeResult {
  lat:             number;
  lng:             number;
  formattedAddress: string;
  placeId:         string;
  precisionGps:    number;
}

export interface ReverseGeocodeResult {
  formattedAddress: string;
  district:        string;
  province:        string;
  department:      string;
}

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    place_id:          string;
    geometry: {
      location: { lat: number; lng: number };
      location_type: string;
    };
    address_components: Array<{
      long_name: string;
      types:     string[];
    }>;
  }>;
}

@Injectable()
export class GoogleMapsService implements OnModuleInit {
  private readonly logger = new Logger(GoogleMapsService.name);
  private readonly mapsApiKey: string;

  /** Caché de geocodificación por dirección normalizada. Ver `geocodeSeguro`. */
  private readonly cacheGeocode = new Map<string, GeocodeResult>();

  constructor(
    private readonly http:         HttpService,
    private readonly config:       ConfigService,
    private readonly oauthSvc:     GoogleOAuthService,
    private readonly moduleHealth: ModuleHealthService,
  ) {
    this.mapsApiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY', '');
  }

  /**
   * Probe ligero: ¿hay API key configurada?
   *
   * No se hace una llamada real de prueba a propósito — costaría cuota en cada arranque
   * del backend, que es lo mismo que dice el módulo de facturación sobre no consultar
   * al proveedor "por si acaso". La ausencia de key es el 100% de los casos reales de
   * "Maps no configurado" en una instalación nueva.
   *
   * NUNCA relanza: un throw aquí crashearía el backend entero por una integración
   * opcional. La geocodificación es una comodidad; las coordenadas manuales son el
   * camino garantizado.
   */
  onModuleInit(): void {
    if (!this.mapsApiKey) {
      this.moduleHealth.registrar(
        'google-maps',
        'degraded',
        'GOOGLE_MAPS_API_KEY no configurada: la geocodificación por dirección no está disponible. ' +
        'Las coordenadas se siguen pudiendo fijar por mapa o a mano.',
      );
      return;
    }
    this.moduleHealth.registrar('google-maps', 'ok');
  }

  /**
   * Geocodificación que NO puede tumbar un alta.
   *
   * `geocode()` lanza, y está bien que lo haga donde el llamador quiere saber del fallo.
   * Pero el alta de una mufa o de una NAP sólo usa la geocodificación para AUTOCOMPLETAR
   * un campo que el operador puede llenar por mapa o a mano. Que Google esté caído, sin
   * cuota o sin key no puede impedir documentar la planta: el ERP quedaría inutilizable
   * en campo por una dependencia externa que ni siquiera es necesaria para el dato final.
   *
   * Devuelve `null` en vez de lanzar. El llamador decide, y el formulario sigue.
   *
   * La caché es por dirección normalizada porque la misma dirección se geocodifica varias
   * veces en un alta típica (el operador corrige el texto, vuelve atrás, reintenta) y cada
   * llamada a Google cuesta dinero.
   */
  async geocodeSeguro(empresaId: string, address: string): Promise<GeocodeResult | null> {
    if (!this.mapsApiKey) return null;

    const clave = `${empresaId}::${address.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const enCache = this.cacheGeocode.get(clave);
    if (enCache) return enCache;

    try {
      const res = await this.geocode(empresaId, address);
      this.cacheGeocode.set(clave, res);
      // Estaba degradado y volvió a responder: se reporta la recuperación, porque un
      // estado 'degraded' que nunca vuelve a 'ok' deja de significar algo.
      this.moduleHealth.registrar('google-maps', 'ok');
      return res;
    } catch (err) {
      this.moduleHealth.registrar(
        'google-maps',
        'degraded',
        `Geocodificación falló: ${err instanceof Error ? err.message : String(err)}`,
      );
      // El log describe lo que ocurrió, no lo que el código pretendía hacer.
      this.logger.warn(
        `Geocodificación no disponible para "${address}"; el operador debe fijar la coordenada a mano.`,
      );
      return null;
    }
  }

  async geocode(empresaId: string, address: string): Promise<GeocodeResult> {
    const start = Date.now();
    try {
      const res = await firstValueFrom(
        this.http.get<GoogleGeocodeResponse>(
          'https://maps.googleapis.com/maps/api/geocode/json',
          { params: { address, key: this.mapsApiKey, language: 'es', region: 'PE' } },
        ),
      );

      if (res.data.status !== 'OK' || !res.data.results.length) {
        throw new Error(`Geocodificación falló: ${res.data.status}`);
      }

      const result     = res.data.results[0];
      const { lat, lng } = result.geometry.location;

      // ROOFTOP = max precision (10m), RANGE_INTERPOLATED = ~50m, GEOMETRIC_CENTER = ~500m
      const precisionMap: Record<string, number> = {
        ROOFTOP:            10,
        RANGE_INTERPOLATED: 50,
        GEOMETRIC_CENTER:   500,
        APPROXIMATE:        1000,
      };
      const precisionGps = precisionMap[result.geometry.location_type] ?? 500;

      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.MAPS, 'geocode', GoogleSyncResult.SUCCESS,
        address, undefined, 'system', undefined, Date.now() - start, 1, 0,
      );

      return {
        lat,
        lng,
        formattedAddress: result.formatted_address,
        placeId:          result.place_id,
        precisionGps,
      };
    } catch (err: any) {
      await this.oauthSvc.writeLog(
        empresaId, GoogleSyncService.MAPS, 'geocode', GoogleSyncResult.FAILED,
        address, err.message, 'system', undefined, Date.now() - start, 0, 1,
      );
      throw err;
    }
  }

  async reverseGeocode(empresaId: string, lat: number, lng: number): Promise<ReverseGeocodeResult> {
    const res = await firstValueFrom(
      this.http.get<GoogleGeocodeResponse>(
        'https://maps.googleapis.com/maps/api/geocode/json',
        { params: { latlng: `${lat},${lng}`, key: this.mapsApiKey, language: 'es' } },
      ),
    );

    if (res.data.status !== 'OK' || !res.data.results.length) {
      return { formattedAddress: '', district: '', province: '', department: '' };
    }

    const result     = res.data.results[0];
    const components = result.address_components;

    return {
      formattedAddress: result.formatted_address,
      district:   this.extractComponent(components, 'locality') ||
                  this.extractComponent(components, 'sublocality_level_1') || '',
      province:   this.extractComponent(components, 'administrative_area_level_2') || '',
      department: this.extractComponent(components, 'administrative_area_level_1') || '',
    };
  }

  async geocodeIfMissing(
    empresaId: string,
    address:   string,
    currentLat?: number,
    currentLng?: number,
  ): Promise<GeocodeResult | null> {
    if (currentLat && currentLng && Math.abs(currentLat) > 0.0001 && Math.abs(currentLng) > 0.0001) {
      return null;
    }
    return this.geocode(empresaId, address);
  }

  // ── Helpers ───────────────────────────────────────────────
  private extractComponent(
    components: Array<{ long_name: string; types: string[] }>,
    type: string,
  ): string | undefined {
    return components.find((c) => c.types.includes(type))?.long_name;
  }
}
