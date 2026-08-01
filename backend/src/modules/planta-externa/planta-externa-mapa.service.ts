import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Capas que el visor puede pedir. `clientes` exige permiso propio (PII). */
export type CapaMapa = 'sites' | 'mufas' | 'naps' | 'fibra' | 'clientes';

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Tope duro de elementos por capa en una respuesta.
 *
 * El backend NUNCA emite una respuesta ilimitada: con la planta completa cargada, un
 * operador que aleja el mapa hasta ver todo el país pediría decenas de miles de features
 * y tumbaría el navegador. Por encima de este tope se devuelven agregados (`cluster`).
 */
const MAX_FEATURES = 500;

/**
 * Zoom por debajo del cual se agrega en vez de devolver elementos individuales.
 * A zoom 13 se ve un distrito; por debajo, los pines se solapan y no aportan nada.
 */
const ZOOM_DETALLE = 13;

type Feature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] }
          | { type: 'LineString'; coordinates: [number, number][] };
  properties: Record<string, unknown>;
};

/**
 * Alimenta el visor cartográfico.
 *
 * Consulta por BOUNDING BOX y no "todo lo de la empresa". Es la diferencia entre un mapa
 * que responde en milisegundos y uno que se arrastra: los índices
 * `(empresa_id, latitud, longitud)` de `pe_mufa`/`pe_nap` existen exactamente para esto,
 * y por eso las coordenadas se guardan en dos columnas numéricas y no concatenadas.
 *
 * Devuelve GeoJSON estándar. El motor de mapas del frontend es intercambiable mientras el
 * contrato sea éste.
 */
@Injectable()
export class PlantaExternaMapaService {
  private readonly logger = new Logger(PlantaExternaMapaService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * @param capas       las que el cliente pidió
   * @param puedeVerClientes resultado de la comprobación de permiso, resuelta en el
   *        controller. Se recibe como dato y no se consulta aquí: el servicio no debe
   *        adivinar autorizaciones, y así el guard es visible en el borde HTTP.
   */
  async obtener(params: {
    empresaId: string;
    bbox: BoundingBox;
    zoom: number;
    capas: CapaMapa[];
    puedeVerClientes: boolean;
  }): Promise<Record<string, { type: 'FeatureCollection'; features: Feature[]; agregado?: boolean }>> {
    const { empresaId, bbox, zoom, capas, puedeVerClientes } = params;
    const salida: Record<string, { type: 'FeatureCollection'; features: Feature[]; agregado?: boolean }> = {};

    const pedidas = new Set(capas);

    if (pedidas.has('sites'))  salida.sites  = await this._puntos('sites', empresaId, bbox, zoom, 'nombre');
    if (pedidas.has('mufas'))  salida.mufas  = await this._puntos('pe_mufa', empresaId, bbox, zoom, 'codigo', 'jerarquia, estado');
    if (pedidas.has('naps'))   salida.naps   = await this._puntos('pe_nap', empresaId, bbox, zoom, 'codigo',
      'estado, capacidad_puertos, puertos_libres, puertos_no_habilitados');

    if (pedidas.has('fibra'))  salida.fibra  = await this._fibra(empresaId, bbox);

    // La capa de clientes se OMITE si no hay permiso. No se devuelve vacía ni con un
    // error: el frontend ya no la ofrece, y omitirla aquí cierra el acceso aunque alguien
    // llame al endpoint a mano.
    if (pedidas.has('clientes') && puedeVerClientes) {
      salida.clientes = await this._clientes(empresaId, bbox, zoom);
    }

    return salida;
  }

  /**
   * Rectángulo que envuelve TODA la planta de la empresa.
   *
   * Existe para que el visor se abra donde está la red, sin que nadie lo configure. El
   * centro inicial por variable de entorno era un defecto disfrazado de opción: una
   * instalación en España abría el mapa sobre Lima —el valor por defecto— y el operador
   * tenía que navegar medio mundo a mano cada vez, o alguien tenía que acordarse de
   * cambiar la variable el día de la instalación. Una configuración que el sistema puede
   * deducir solo no debería existir.
   *
   * Devuelve `null` cuando no hay ningún elemento con coordenadas: ahí sí corresponde el
   * centro por defecto, porque no hay nada que encuadrar.
   */
  async extension(empresaId: string): Promise<BoundingBox | null> {
    // UNION ALL de las tablas con coordenadas. Se agregan en SQL de una sola pasada en
    // vez de cuatro consultas: es una llamada por apertura del mapa, no vale la pena
    // pagarla cuatro veces.
    const [fila] = await this.ds.query(
      `SELECT MIN(lat)::float AS min_lat, MAX(lat)::float AS max_lat,
              MIN(lng)::float AS min_lng, MAX(lng)::float AS max_lng,
              COUNT(*)::int   AS total
         FROM (
           SELECT latitud AS lat, longitud AS lng FROM pe_mufa
            WHERE empresa_id = $1 AND deleted_at IS NULL
           UNION ALL
           SELECT latitud, longitud FROM pe_nap
            WHERE empresa_id = $1 AND deleted_at IS NULL
           UNION ALL
           SELECT latitud, longitud FROM sites
            WHERE empresa_id = $1 AND deleted_at IS NULL AND latitud IS NOT NULL
           UNION ALL
           SELECT latitud, longitud FROM clientes
            WHERE empresa_id = $1 AND deleted_at IS NULL
              AND latitud IS NOT NULL AND latitud <> 0
         ) t`,
      [empresaId],
    );

    if (!fila || fila.total === 0 || fila.min_lat == null) return null;

    // Un solo elemento da un rectángulo de área cero, que `fitBounds` no sabe encuadrar
    // (haría zoom infinito). Se le da un margen de ~500 m para que quede centrado a una
    // escala en la que se vea la calle.
    const margen = 0.005;
    const plano = fila.min_lat === fila.max_lat && fila.min_lng === fila.max_lng;

    return {
      minLat: fila.min_lat - (plano ? margen : 0),
      maxLat: fila.max_lat + (plano ? margen : 0),
      minLng: fila.min_lng - (plano ? margen : 0),
      maxLng: fila.max_lng + (plano ? margen : 0),
    };
  }

  /** Puntos de una tabla con lat/lng. Agrega por celda cuando el zoom es bajo. */
  private async _puntos(
    tabla: string,
    empresaId: string,
    bbox: BoundingBox,
    zoom: number,
    campoEtiqueta: string,
    camposExtra = '',
  ) {
    const extra = camposExtra ? `, ${camposExtra}` : '';

    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*)::int AS total FROM ${tabla}
        WHERE empresa_id = $1 AND deleted_at IS NULL
          AND latitud BETWEEN $2 AND $3 AND longitud BETWEEN $4 AND $5`,
      [empresaId, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng],
    );

    if (zoom < ZOOM_DETALLE || total > MAX_FEATURES) {
      return this._agregar(tabla, empresaId, bbox, zoom);
    }

    const filas = await this.ds.query(
      `SELECT id, ${campoEtiqueta} AS etiqueta, latitud, longitud${extra}
         FROM ${tabla}
        WHERE empresa_id = $1 AND deleted_at IS NULL
          AND latitud BETWEEN $2 AND $3 AND longitud BETWEEN $4 AND $5
        LIMIT ${MAX_FEATURES}`,
      [empresaId, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng],
    );

    return {
      type: 'FeatureCollection' as const,
      features: filas.map((f: any) => {
        const { id, etiqueta, latitud, longitud, ...resto } = f;
        return this._punto(Number(longitud), Number(latitud), { id, etiqueta, ...resto });
      }),
    };
  }

  /**
   * Agrupa en celdas de una rejilla cuyo tamaño depende del zoom.
   *
   * Se agrupa en SQL y no en el backend en memoria: traer 50 000 filas para contarlas en
   * Node desperdicia el ancho de banda que este endpoint existe para ahorrar.
   */
  private async _agregar(tabla: string, empresaId: string, bbox: BoundingBox, zoom: number) {
    // Celda ~ el ancho de pantalla dividido en una rejilla manejable. A menor zoom,
    // celdas más grandes.
    const celda = Math.max(0.0005, 0.5 / Math.pow(2, Math.max(0, zoom - 6)));

    const filas = await this.ds.query(
      `SELECT COUNT(*)::int AS total,
              AVG(latitud)::float  AS lat,
              AVG(longitud)::float AS lng
         FROM ${tabla}
        WHERE empresa_id = $1 AND deleted_at IS NULL
          AND latitud BETWEEN $2 AND $3 AND longitud BETWEEN $4 AND $5
        GROUP BY FLOOR(latitud / $6), FLOOR(longitud / $6)
        LIMIT ${MAX_FEATURES}`,
      [empresaId, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, celda],
    );

    return {
      type: 'FeatureCollection' as const,
      agregado: true,
      features: filas.map((f: any) =>
        this._punto(f.lng, f.lat, { cluster: true, total: f.total }),
      ),
    };
  }

  /**
   * Tendidos de fibra como polilíneas.
   *
   * Un segmento SIN `ruta_geojson` —la mayoría al principio, hasta que alguien levante el
   * trazado en campo— se dibuja como recta entre sus nodos, marcada `trazadoLevantado:
   * false`. El frontend la pinta punteada. Es honesto: muestra la conectividad real sin
   * afirmar por dónde va el cable. Ocultarlos dejaría la red visualmente rota; dibujarlos
   * sólidos sería mentir sobre el recorrido.
   */
  private async _fibra(empresaId: string, bbox: BoundingBox) {
    const filas = await this.ds.query(
      `SELECT s.id, s.codigo, s.jerarquia, s.estado, s.hilos_totales, s.longitud_m,
              s.ruta_geojson,
              COALESCE(om.latitud, onap.latitud, osite.latitud)    AS lat_origen,
              COALESCE(om.longitud, onap.longitud, osite.longitud) AS lng_origen,
              COALESCE(dm.latitud, dnap.latitud, dsite.latitud)    AS lat_destino,
              COALESCE(dm.longitud, dnap.longitud, dsite.longitud) AS lng_destino
         FROM pe_fibra_segmento s
         LEFT JOIN pe_mufa om   ON om.id   = s.origen_mufa_id
         LEFT JOIN pe_nap  onap ON onap.id = s.origen_nap_id
         LEFT JOIN sites   osite ON osite.id = s.origen_site_id
         LEFT JOIN pe_mufa dm   ON dm.id   = s.destino_mufa_id
         LEFT JOIN pe_nap  dnap ON dnap.id = s.destino_nap_id
         LEFT JOIN sites   dsite ON dsite.id = s.destino_site_id
        WHERE s.empresa_id = $1 AND s.deleted_at IS NULL
        LIMIT ${MAX_FEATURES}`,
      [empresaId],
    );

    const features: Feature[] = [];

    for (const f of filas) {
      const props = {
        id: f.id, etiqueta: f.codigo, jerarquia: f.jerarquia, estado: f.estado,
        hilosTotales: f.hilos_totales, longitudM: Number(f.longitud_m),
        trazadoLevantado: !!f.ruta_geojson,
      };

      if (f.ruta_geojson?.coordinates?.length) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: f.ruta_geojson.coordinates },
          properties: props,
        });
        continue;
      }

      // Sin trazado: recta entre extremos. Si a alguno le falta la coordenada, no se
      // dibuja — media línea apuntando a la nada confunde más que la ausencia.
      if (f.lat_origen == null || f.lat_destino == null) continue;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [Number(f.lng_origen), Number(f.lat_origen)],
            [Number(f.lng_destino), Number(f.lat_destino)],
          ],
        },
        properties: props,
      });
    }

    return { type: 'FeatureCollection' as const, features };
  }

  /**
   * Abonados georreferenciados. SÓLO se llama con permiso `red:mapa:clientes`.
   *
   * Devuelve el mínimo indispensable para el pin y su tooltip. Nada de documento,
   * teléfono ni deuda: si alguien necesita la ficha, la abre — el mapa no es un exportador
   * de padrón.
   */
  private async _clientes(empresaId: string, bbox: BoundingBox, zoom: number) {
    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*)::int AS total FROM clientes
        WHERE empresa_id = $1 AND deleted_at IS NULL
          AND latitud BETWEEN $2 AND $3 AND longitud BETWEEN $4 AND $5`,
      [empresaId, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng],
    );

    if (zoom < ZOOM_DETALLE || total > MAX_FEATURES) {
      return this._agregar('clientes', empresaId, bbox, zoom);
    }

    const filas = await this.ds.query(
      `SELECT c.id, c.latitud, c.longitud,
              TRIM(CONCAT(c.nombres, ' ', COALESCE(c.apellido_paterno, ''))) AS etiqueta,
              a.confianza
         FROM clientes c
         LEFT JOIN contratos co ON co.cliente_id = c.id AND co.deleted_at IS NULL
         LEFT JOIN pe_acometida a ON a.contrato_id = co.id AND a.deleted_at IS NULL
        WHERE c.empresa_id = $1 AND c.deleted_at IS NULL
          AND c.latitud BETWEEN $2 AND $3 AND c.longitud BETWEEN $4 AND $5
        LIMIT ${MAX_FEATURES}`,
      [empresaId, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng],
    );

    return {
      type: 'FeatureCollection' as const,
      features: filas.map((f: any) =>
        this._punto(Number(f.longitud), Number(f.latitud), {
          id: f.id,
          etiqueta: f.etiqueta,
          // `confianza` es lo que hace útil esta capa: distingue al cliente cuya NAP
          // documentada coincide con el puerto PON real (verificado) del que sólo tiene
          // el dato que alguien tecleó (declarado). Un mapa que los pinta igual no
          // delata errores de documentación.
          confianza: f.confianza ?? 'sin_acometida',
        }),
      ),
    };
  }

  private _punto(lng: number, lat: number, properties: Record<string, unknown>): Feature {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties,
    };
  }
}
