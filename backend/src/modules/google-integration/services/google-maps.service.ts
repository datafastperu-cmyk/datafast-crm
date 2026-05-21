import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleSyncService, GoogleSyncResult } from '../entities/google-sync-log.entity';

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
export class GoogleMapsService {
  private readonly logger = new Logger(GoogleMapsService.name);
  private readonly mapsApiKey: string;

  constructor(
    private readonly http:      HttpService,
    private readonly config:    ConfigService,
    private readonly oauthSvc:  GoogleOAuthService,
  ) {
    this.mapsApiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY', '');
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
