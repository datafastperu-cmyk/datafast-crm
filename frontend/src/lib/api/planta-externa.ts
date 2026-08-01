import api from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────

export type ElementoEstado =
  | 'planificado' | 'instalado' | 'operativo' | 'averiado' | 'retirado';

/**
 * `no_habilitado` es la distinción que el módulo existe para hacer: el adaptador
 * físico está en la caja pero no hay splitter detrás. Contarlo como "libre" —que es
 * lo que hacía el diseño original— hace que el planificador vea capacidad donde no
 * puede conectar a nadie.
 */
export type PuertoEstado =
  | 'no_habilitado' | 'libre' | 'reservado' | 'ocupado' | 'averiado' | 'retirado';

export type SplitterRelacion = '1x2' | '1x4' | '1x8' | '1x16' | '1x32';

export interface Nap {
  id:                    string;
  codigo:                string;
  descripcion:           string | null;
  direccion:             string | null;
  latitud:               number;
  longitud:              number;
  precisionGpsM:         number | null;
  capacidadPuertos:      number;
  /** Con splitter detrás y sin cliente: se puede conectar hoy. */
  puertosLibres:         number;
  /** Sin splitter detrás: la caja necesita inversión, no un técnico. */
  puertosNoHabilitados:  number;
  mufaOrigenId:          string | null;
  estado:                ElementoEstado;
  createdAt:             string;
}

export interface NapPuerto {
  id:               string;
  napId:            string;
  numero:           number;
  estado:           PuertoEstado;
  splitterSalidaId: string | null;
  reservadoHasta:   string | null;
}

export interface Mufa {
  id:            string;
  codigo:        string;
  jerarquia:     'primer_nivel' | 'segundo_nivel';
  descripcion:   string | null;
  direccion:     string | null;
  latitud:       number;
  longitud:      number;
  precisionGpsM: number | null;
  estado:        ElementoEstado;
}

export interface CrearNapDto {
  codigo:            string;
  latitud:           number;
  longitud:          number;
  capacidadPuertos:  number;
  direccion?:        string;
  descripcion?:      string;
  precisionGpsM?:    number;
  mufaOrigenId?:     string;
}

export interface CrearMufaDto {
  codigo:         string;
  latitud:        number;
  longitud:       number;
  jerarquia?:     'primer_nivel' | 'segundo_nivel';
  direccion?:     string;
  descripcion?:   string;
  precisionGpsM?: number;
}

export type SegmentoJerarquia = 'troncal' | 'subtroncal' | 'distribucion';
export type TipoInstalacion   = 'aereo' | 'subterraneo' | 'fachada';

/** Capacidades de cable admitidas. Fuera de esta lista es un error de tipeo. */
export const HILOS_VALIDOS = [2, 4, 6, 8, 12, 24, 48, 96, 144, 288];

export interface FibraSegmento {
  id:              string;
  codigo:          string;
  jerarquia:       SegmentoJerarquia;
  descripcion:     string | null;
  hilosTotales:    number;
  tipoInstalacion: TipoInstalacion;
  longitudM:       number;
  atenuacionDbKm:  number;
  origenSiteId:    string | null;
  origenMufaId:    string | null;
  origenNapId:     string | null;
  destinoSiteId:   string | null;
  destinoMufaId:   string | null;
  destinoNapId:    string | null;
  /** Polilínea del trazado. Vacía mientras no se levante en campo. */
  rutaGeojson:     Record<string, unknown> | null;
  estado:          ElementoEstado;
}

export interface CrearSegmentoDto {
  codigo:           string;
  jerarquia:        SegmentoJerarquia;
  hilosTotales:     number;
  longitudM:        number;
  tipoInstalacion?: TipoInstalacion;
  descripcion?:     string;
  origenSiteId?:    string;
  origenMufaId?:    string;
  origenNapId?:     string;
  destinoSiteId?:   string;
  destinoMufaId?:   string;
  destinoNapId?:    string;
}

/**
 * Extremo de un segmento en la UI. El backend exige exactamente un origen y un destino
 * de tres tipos posibles (site, mufa, NAP) con un CHECK en la BD; el formulario lo
 * expresa como un selector de tipo + un selector de elemento, que es cómo lo piensa un
 * operador — "de la mufa X a la caja Y" — en vez de seis campos donde cinco van vacíos.
 */
export type TipoNodo = 'site' | 'mufa' | 'nap';

export function extremoADto(
  lado: 'origen' | 'destino',
  tipo: TipoNodo,
  id: string,
): Partial<CrearSegmentoDto> {
  const sufijo = tipo === 'site' ? 'SiteId' : tipo === 'mufa' ? 'MufaId' : 'NapId';
  return { [`${lado}${sufijo}`]: id } as Partial<CrearSegmentoDto>;
}

/**
 * Respuesta del borde HTTP cuando el backend habla en vocabulario de dominio.
 * `clase` viaja hasta aquí a propósito: la UI necesita distinguir un rechazo
 * definitivo (mostrar el motivo y parar) de uno reintentable (ofrecer reintentar).
 */
export interface ResultadoHttp {
  exitoso: boolean;
  mensaje: string;
  error?:  string;
  clase:   'aplicado' | 'ya_en_destino' | 'no_aplica' | 'reintentable' | 'indeterminado';
  id?:     string;
}

// ─── Client ───────────────────────────────────────────────────

export const plantaExternaApi = {
  listarNaps: async (): Promise<Nap[]> => {
    const { data } = await api.get('/planta-externa/naps');
    return data.data;
  },

  listarPuertos: async (napId: string): Promise<NapPuerto[]> => {
    const { data } = await api.get(`/planta-externa/naps/${napId}/puertos`);
    return data.data;
  },

  crearNap: async (dto: CrearNapDto): Promise<ResultadoHttp> => {
    const { data } = await api.post('/planta-externa/naps', dto);
    return data.data;
  },

  listarMufas: async (): Promise<Mufa[]> => {
    const { data } = await api.get('/planta-externa/mufas');
    return data.data;
  },

  crearMufa: async (dto: CrearMufaDto): Promise<Mufa> => {
    const { data } = await api.post('/planta-externa/mufas', dto);
    return data.data;
  },

  listarSegmentos: async (): Promise<FibraSegmento[]> => {
    const { data } = await api.get('/planta-externa/segmentos');
    return data.data;
  },

  crearSegmento: async (dto: CrearSegmentoDto): Promise<ResultadoHttp> => {
    const { data } = await api.post('/planta-externa/segmentos', dto);
    return data.data;
  },

  instalarSplitter: async (
    napId: string,
    dto: { relacion: SplitterRelacion; codigo?: string; perdidaDb?: number },
  ): Promise<ResultadoHttp> => {
    const { data } = await api.post(`/planta-externa/naps/${napId}/splitters`, dto);
    return data.data;
  },

  reservarPuerto: async (puertoId: string): Promise<ResultadoHttp> => {
    const { data } = await api.post(`/planta-externa/puertos/${puertoId}/reservar`);
    return data.data;
  },

  /** Extiende la reserva del wizard. Tiene techo absoluto en el servidor. */
  heartbeatPuerto: async (puertoId: string): Promise<ResultadoHttp> => {
    const { data } = await api.post(`/planta-externa/puertos/${puertoId}/heartbeat`);
    return data.data;
  },

  asignarPuerto: async (
    puertoId: string,
    dto: { contratoId: string; longitudM?: number },
  ): Promise<ResultadoHttp> => {
    const { data } = await api.post(`/planta-externa/puertos/${puertoId}/asignar`, dto);
    return data.data;
  },

  liberarPuerto: async (puertoId: string): Promise<ResultadoHttp> => {
    const { data } = await api.post(`/planta-externa/puertos/${puertoId}/liberar`);
    return data.data;
  },
};
