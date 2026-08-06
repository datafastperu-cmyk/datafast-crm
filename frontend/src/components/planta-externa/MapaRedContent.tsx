'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Layers, Loader2, AlertCircle, Info } from 'lucide-react';

import { plantaExternaApi, type CapaMapa, type RespuestaMapa } from '@/lib/api/planta-externa';
import { urlComoLlegar } from './BotonComoLlegar';
import { parseApiError, cn } from '@/lib/utils';

/**
 * Fuente de teselas del mapa base.
 *
 * NO se usan las de Google, aunque el ERP tenga clave de Maps: sus términos exigen
 * renderizarlas con el SDK de Google, y usarlas dentro de MapLibre las incumple. Fue una
 * recomendación equivocada mía al diseñar esto, corregida aquí.
 *
 * OpenStreetMap es válido para el volumen de un ERP interno (unos pocos operadores). Su
 * política prohíbe la descarga masiva, así que el modo offline exigirá auto-hospedar las
 * teselas o usar vectoriales propias (PMTiles) — y por eso la URL sale de una variable de
 * entorno: cambiar de proveedor es cambiar el `.env` de ese VPS, no tocar código.
 */
const TILE_URL =
  process.env.NEXT_PUBLIC_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIB =
  process.env.NEXT_PUBLIC_TILE_ATTRIB || '© OpenStreetMap contributors';

/**
 * Vista satélite. Esri World Imagery no exige clave de API, que es la razón de elegirla:
 * una instalación nueva la tiene funcionando sin registrarse en ningún servicio.
 *
 * Ojo al orden de los ejes: esta capa es `{z}/{y}/{x}`, no `{z}/{x}/{y}` como OSM. Con el
 * orden equivocado devuelve teselas válidas del sitio equivocado — un error que no falla,
 * sólo miente.
 *
 * Sirve para verificar en gabinete lo que se documentó en campo: sobre el plano callejero
 * un poste es una coordenada, sobre la imagen se ve el techo, el patio y por dónde entra
 * la acometida.
 */
const SAT_URL = process.env.NEXT_PUBLIC_TILE_SAT_URL
  || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTRIB = process.env.NEXT_PUBLIC_TILE_SAT_ATTRIB
  || 'Esri, Maxar, Earthstar Geographics';

type VistaBase = 'normal' | 'satelite';
const CLAVE_VISTA = 'red-mapa-vista';

/**
 * Centro de RESPALDO, sólo para el primer día: cuando todavía no hay ni un elemento con
 * coordenadas, no hay planta que encuadrar. En cuanto exista una, el mapa se centra en
 * ella (ver `fitBounds` más abajo) y estas variables dejan de intervenir — por eso una
 * instalación en cualquier país funciona sin configurarlas.
 */
const CENTRO_INICIAL: [number, number] = [
  Number(process.env.NEXT_PUBLIC_MAPA_LNG ?? -77.0428),
  Number(process.env.NEXT_PUBLIC_MAPA_LAT ?? -12.0464),
];

/**
 * Escapa texto antes de meterlo en el HTML del popup.
 *
 * NO es opcional: la etiqueta sale de la base de datos —el nombre de un abonado, el código
 * de una caja— y `setHTML` de MapLibre inyecta la cadena tal cual. Un cliente registrado
 * como `<img src=x onerror=...>` ejecutaría ese script en la sesión de quien abra el mapa.
 * Es XSS almacenado, y el vector de entrada es un formulario de alta que cualquier
 * vendedor puede rellenar.
 */
function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Estado físico del enlace del abonado, tal como lo clasifica la OLT.
 *
 * Los cuatro primeros salen de `_map_estado_operativo` en el microservicio: la OLT reporta
 * la CAUSA de la caída, y por eso `apagada` (dying-gasp: se fue la luz en casa del cliente)
 * se distingue de `ruptura_fibra` (LOS/LOF: pérdida de señal óptica). No es una inferencia
 * nuestra, es lo que dice el equipo.
 *
 * `sin_datos` NO es un estado de red: es la ausencia de información —contrato sin ONU
 * registrada, o ONU que no aparece en el inventario—. Pintarlo como una avería haría que un
 * hueco de documentación mandara a un técnico a revisar una fibra sana.
 */
const ESTADOS_RED = {
  online:        { color: '#10b981', etiqueta: 'En línea' },
  apagada:       { color: '#f59e0b', etiqueta: 'Apagado (sin energía)' },
  ruptura_fibra: { color: '#ef4444', etiqueta: 'Ruptura de fibra' },
  desactivada:   { color: '#6b7280', etiqueta: 'Deshabilitado' },
  offline:       { color: '#f97316', etiqueta: 'Fuera de línea' },
  sin_datos:     { color: '#94a3b8', etiqueta: 'Sin datos' },
} as const;

type EstadoRed = keyof typeof ESTADOS_RED;

/** Expresión MapLibre que traduce la propiedad `estadoRed` al color del pin. */
const COLOR_POR_ESTADO: unknown[] = [
  'match', ['get', 'estadoRed'],
  ...Object.entries(ESTADOS_RED).flatMap(([k, v]) => [k, v.color]),
  ESTADOS_RED.sin_datos.color,
];

/**
 * Silueta de usuario, dibujada en un canvas y registrada como icono SDF.
 *
 * Se genera en código y no se carga de un archivo por portabilidad: un PNG en `public/`
 * obligaría a servirlo, y este ERP se instala en servidores sin salida a internet donde
 * cualquier recurso externo es un punto de fallo más.
 *
 * `sdf: true` es lo que permite recolorear el mismo icono por expresión. Sin eso haría
 * falta un PNG por estado, y añadir un estado significaría añadir una imagen.
 */
function registrarIconoUsuario(m: MapLibreMap): void {
  if (m.hasImage('usuario')) return;

  const T = 64;
  const cv = document.createElement('canvas');
  cv.width = T; cv.height = T;
  const ctx = cv.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  // Cabeza
  ctx.beginPath();
  ctx.arc(T / 2, T * 0.34, T * 0.17, 0, Math.PI * 2);
  ctx.fill();
  // Hombros: media elipse, recortada abajo para que no parezca un óvalo suelto.
  ctx.beginPath();
  ctx.ellipse(T / 2, T * 0.82, T * 0.30, T * 0.24, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  const { data, width, height } = ctx.getImageData(0, 0, T, T);
  m.addImage('usuario', { width, height, data: new Uint8Array(data) }, { sdf: true });
}

/** "hace 6 h" en vez de una marca de tiempo: lo que importa es si el dato es reciente. */
function antiguedad(minutos: number | null): string {
  if (minutos == null) return 'sin fecha';
  if (minutos < 2)  return 'ahora';
  if (minutos < 60) return `hace ${minutos} min`;
  const h = Math.floor(minutos / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

function pastilla(estado: string, cuando: string): string {
  const def = ESTADOS_RED[estado as EstadoRed] ?? ESTADOS_RED.sin_datos;
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;
                       background:${def.color};margin-right:5px"></span>
          <strong>${escaparHtml(def.etiqueta)}</strong>
          <span style="color:#6b7280"> · ${escaparHtml(cuando)}</span>`;
}

function fila(clave: string, valor: string): string {
  return `<div style="display:flex;gap:6px"><span style="color:#6b7280;min-width:52px">${clave}</span>
          <span>${valor}</span></div>`;
}

/**
 * Ficha del abonado dentro del popup.
 *
 * Dos fases deliberadas:
 *
 *  1. Se pinta de inmediato lo que la BD ya sabe —incluido el estado del inventario, que se
 *     sincroniza cada 6 h— con su antigüedad a la vista. El operador tiene algo útil al
 *     instante en vez de un spinner.
 *  2. En paralelo se pregunta a la OLT **en vivo**, reutilizando el endpoint que ya usa
 *     `/red/olt` (`clasificarOnus`). Cuando responde, el estado se reemplaza y pasa a decir
 *     "ahora". No se construyó una segunda lectura de hardware: la que existe clasifica la
 *     causa de caída mejor de lo que haría una nueva.
 *
 * Por qué la lectura en vivo NO se usa para pintar los pines: es por PUERTO PON, no por
 * abonado, y el mapa recarga en cada movimiento. Treinta abonados repartidos en ocho puertos
 * serían ocho sesiones SSH por arrastre, contra una OLT que admite pocas sesiones VTY
 * concurrentes — la misma razón por la que los crons de ONU van serializados y desfasados.
 */
async function abrirFichaAbonado(
  popup: maplibregl.Popup,
  contratoId: string,
  etiqueta: string,
  lat: number,
  lng: number,
): Promise<void> {
  const pintar = (cuerpo: string) => {
    // Si el operador ya cerró el popup, no se toca nada: escribir en un popup cerrado
    // lanzaría al llegar la respuesta de la OLT, que puede tardar segundos.
    if (!popup.isOpen()) return;
    popup.setHTML(
      `<div style="font-size:12px;line-height:1.6;min-width:210px">
         <div style="font-weight:600;margin-bottom:4px">${escaparHtml(etiqueta)}</div>
         ${cuerpo}
         <div style="margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb">
           <a href="${escaparHtml(urlComoLlegar(lat, lng, etiqueta))}" target="_blank"
              rel="noopener noreferrer" style="color:#2563eb;font-weight:500">Cómo llegar →</a>
         </div>
       </div>`,
    );
  };

  let datos: Awaited<ReturnType<typeof plantaExternaApi.abonadoMapa>>;
  try {
    datos = await plantaExternaApi.abonadoMapa(contratoId);
  } catch {
    // El popup básico ya está en pantalla con el nombre y "cómo llegar"; dejarlo es mejor
    // que sustituirlo por un error que no aporta.
    return;
  }
  if (!datos) return;

  const bloque = (estado: string, cuando: string) => [
    `<div style="margin-bottom:4px">${pastilla(estado, cuando)}</div>`,
    datos.plan     ? fila('Plan', escaparHtml(datos.plan)) : '',
    datos.telefono
      // Enlace `tel:`: en el móvil del técnico, un toque llama. Es el uso real de este dato.
      ? fila('Tel.', `<a href="tel:${escaparHtml(datos.telefono)}" style="color:#2563eb">${escaparHtml(datos.telefono)}</a>`)
      : '',
    datos.nap      ? fila('NAP', escaparHtml(`${datos.nap.codigo} · puerto ${datos.nap.puerto ?? '—'}`)) : '',
    datos.rxPowerDbm != null ? fila('Señal', `${datos.rxPowerDbm.toFixed(2)} dBm`) : '',
    datos.estadoContrato !== 'activo'
      ? fila('Contrato', `<span style="color:#f59e0b">${escaparHtml(datos.estadoContrato)}</span>`) : '',
  ].filter(Boolean).join('');

  pintar(bloque(datos.estadoRed, antiguedad(datos.medidoHaceMin)));

  // Sin ONU registrada no hay nada que consultar en la OLT.
  if (!datos.onu) return;

  try {
    const vivo = await oltNativoApi.clasificarOnus(datos.onu.oltId, datos.onu.slot, datos.onu.port);
    const mia = (vivo?.onus ?? []).find(
      (o: any) => Number(o.onu_id) === Number(datos.onu!.onuId),
    );
    if (mia?.estado_operativo) pintar(bloque(String(mia.estado_operativo), 'ahora'));
  } catch {
    // La OLT puede estar inalcanzable. El estado del inventario ya está en pantalla CON su
    // antigüedad, que es información honesta: no se degrada a un error ni se finge que el
    // dato es actual.
  }
}

interface DefCapa {
  key: CapaMapa;
  label: string;
  color: string;
  tipo: 'punto' | 'linea';
}

const CAPAS: DefCapa[] = [
  { key: 'fibra',    label: 'Fibra óptica', color: '#ef4444', tipo: 'linea' },
  { key: 'sites',    label: 'Sites',        color: '#8b5cf6', tipo: 'punto' },
  { key: 'mufas',    label: 'Mufas',        color: '#f59e0b', tipo: 'punto' },
  { key: 'naps',     label: 'Cajas NAP',    color: '#10b981', tipo: 'punto' },
  { key: 'clientes', label: 'Clientes',     color: '#3b82f6', tipo: 'punto' },
];

const CLAVE_CAPAS = 'red-mapa-capas';

/**
 * Capas visibles al abrir. Se recuerda la última elección del operador.
 *
 * Sin esto, cada visita reiniciaba la selección: quien encendía "Clientes" lo encontraba
 * apagado al volver y lo leía como que la capa se desmarca sola. El estado de un panel de
 * capas es una preferencia de trabajo, no algo que deba reconstruirse en cada navegación.
 *
 * `clientes` NO va en el arranque por defecto: son datos personales y hay roles —Operador
 * NOC, Técnico— que ni siquiera tienen permiso para verla. Mostrarla de entrada a quien no
 * la pidió es lo contrario del criterio con que se otorgó ese permiso. En cuanto alguien la
 * enciende una vez, se recuerda.
 */
function leerCapasGuardadas(): Set<CapaMapa> {
  const porDefecto = new Set<CapaMapa>(['fibra', 'sites', 'mufas', 'naps']);
  // `typeof window` porque este componente se renderiza también en el servidor, donde no
  // existe localStorage: leerlo sin comprobar rompe el render antes de llegar al navegador.
  if (typeof window === 'undefined') return porDefecto;

  try {
    const crudo = window.localStorage.getItem(CLAVE_CAPAS);
    if (!crudo) return porDefecto;
    const claves = CAPAS.map((c) => c.key);
    // Se filtra contra las capas que existen HOY: un valor guardado hace meses puede
    // nombrar una capa retirada, y no debe llegar como parámetro al backend.
    const guardadas = (JSON.parse(crudo) as string[]).filter((k): k is CapaMapa =>
      claves.includes(k as CapaMapa),
    );
    return guardadas.length ? new Set(guardadas) : porDefecto;
  } catch {
    // localStorage puede estar bloqueado (modo privado, políticas del navegador) o el valor
    // corrupto. Ninguna de las dos cosas justifica dejar al operador sin mapa.
    return porDefecto;
  }
}

/** Última vista base elegida. Se recuerda por el mismo motivo que las capas. */
function leerVistaGuardada(): VistaBase {
  if (typeof window === 'undefined') return 'normal';
  try {
    return window.localStorage.getItem(CLAVE_VISTA) === 'satelite' ? 'satelite' : 'normal';
  } catch {
    return 'normal';
  }
}

export function MapaRedContent() {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapLibreMap | null>(null);
  const [listo, setListo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<RespuestaMapa>({});
  const [activas, setActivas] = useState<Set<CapaMapa>>(leerCapasGuardadas);
  const [vista, setVista] = useState<VistaBase>(leerVistaGuardada);

  /** Se guarda en ref además del estado: el handler de `moveend` de MapLibre captura el
   *  valor del closure, y sin la ref pediría siempre las capas del primer render. */
  const activasRef = useRef(activas);
  activasRef.current = activas;

  const cargar = useCallback(async () => {
    const m = mapa.current;
    if (!m) return;

    const capas = Array.from(activasRef.current);
    if (capas.length === 0) { setDatos({}); return; }

    const b = m.getBounds();
    setCargando(true);
    setError(null);
    try {
      const r = await plantaExternaApi.mapa({
        minLat: b.getSouth(), maxLat: b.getNorth(),
        minLng: b.getWest(),  maxLng: b.getEast(),
        zoom: Math.round(m.getZoom()),
        capas,
      });
      setDatos(r);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setCargando(false);
    }
  }, []);

  // ── Inicialización del mapa ───────────────────────────────────
  useEffect(() => {
    if (!contenedor.current || mapa.current) return undefined;

    // Se lee del almacenamiento y no del estado: incluir `vista` en las dependencias de
    // este efecto recrearía el mapa entero al alternar, perdiendo posición y zoom. El
    // cambio en caliente lo hace el efecto de abajo.
    const vistaInicial = leerVistaGuardada();

    const m = new maplibregl.Map({
      container: contenedor.current,
      style: {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: TILE_ATTRIB,
          },
          // Dos fuentes en vez de reescribir la URL de una sola: así cada proveedor
          // conserva su atribución y su zoom máximo, y al alternar no se descartan las
          // teselas ya descargadas de la otra vista.
          satelite: {
            type: 'raster',
            tiles: [SAT_URL],
            tileSize: 256,
            maxzoom: 19,
            attribution: SAT_ATTRIB,
          },
        },
        layers: [
          {
            id: 'base', type: 'raster', source: 'base',
            layout: { visibility: vistaInicial === 'satelite' ? 'none' : 'visible' },
          },
          {
            id: 'satelite', type: 'raster', source: 'satelite',
            layout: { visibility: vistaInicial === 'satelite' ? 'visible' : 'none' },
          },
        ],
        // Sin `glyphs` no hay tipografías que rasterizar, y toda capa `symbol` con
        // `text-field` —las etiquetas de mufas, NAPs y abonados— falla al renderizar.
        // Configurable porque una instalación sin salida a internet necesita servirlas
        // desde su propia red; el default sólo evita que haya que configurarlo el día uno.
        glyphs: process.env.NEXT_PUBLIC_MAPA_GLYPHS
          || 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      },
      center: CENTRO_INICIAL,
      zoom: 13,
    });

    // Los errores de MapLibre —estilo inválido, tipografía que no carga, expresión que no
    // evalúa— se emiten por este evento. Sin un manejador quedan mudos: la capa no se pinta
    // y la consola no dice nada, que es exactamente lo que costó diagnosticar por qué los
    // abonados no aparecían aunque el backend devolvía sus coordenadas.
    m.on('error', (ev: { error?: Error }) => {
      console.error('[mapa-red] MapLibre:', ev?.error?.message ?? ev); // eslint-disable-line
    });

    m.addControl(new maplibregl.NavigationControl({}), 'top-right');
    m.addControl(new maplibregl.ScaleControl({}), 'bottom-left');

    m.on('load', () => {
      // Encuadre automático sobre la planta de la empresa.
      //
      // El centro por variable de entorno era una configuración que el sistema puede
      // deducir solo: una instalación en España abría el mapa sobre Lima —el valor por
      // defecto— y el operador tenía que navegar medio mundo a mano, o alguien tenía que
      // acordarse de cambiar la variable el día de la instalación.
      //
      // Falla en silencio a propósito: si la consulta no responde, el mapa se queda en el
      // centro por defecto y sigue siendo usable. Un visor que no abre porque no pudo
      // calcular dónde centrarse sería peor que uno mal centrado.
      plantaExternaApi.extensionMapa()
        .then((ext) => {
          if (!ext) return; // sin coordenadas cargadas: no hay nada que encuadrar
          m.fitBounds(
            [[ext.minLng, ext.minLat], [ext.maxLng, ext.maxLat]],
            { padding: 60, animate: false, maxZoom: 17 },
          );
        })
        .catch(() => { /* el centro por defecto sigue siendo válido */ });

      // Una fuente y sus capas por cada capa lógica. Se crean vacías y después sólo se
      // reemplaza el GeoJSON: recrear capas en cada movimiento haría parpadear el mapa.
      registrarIconoUsuario(m);

      for (const c of CAPAS) {
        m.addSource(c.key, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        if (c.tipo === 'linea') {
          m.addLayer({
            id: `${c.key}-linea`, type: 'line', source: c.key,
            paint: {
              // El color sigue la jerarquía, igual que en la pestaña Fibra: rojo troncal,
              // azul sub-troncal, verde distribución.
              'line-color': [
                'match', ['get', 'jerarquia'],
                'troncal', '#ef4444', 'subtroncal', '#3b82f6', 'distribucion', '#10b981',
                '#9ca3af',
              ],
              'line-width': 3,
              // Punteado = trazado no levantado en campo. Muestra la conectividad real
              // sin afirmar por dónde va el cable.
              // `== true` y no `['get', …]` a secas: en una feature sin esa propiedad el
              // `get` devuelve null, y `case` exige un booleano — la expresión falla al
              // evaluar y la regla de pintado se descarta entera.
              'line-dasharray': ['case', ['==', ['get', 'trazadoLevantado'], true], ['literal', [1]], ['literal', [2, 1.5]]],
            },
          });
        } else {
          m.addLayer({
            id: `${c.key}-punto`, type: 'circle', source: c.key,
            paint: {
              // Los conglomerados crecen con la cantidad que representan.
              // Los abonados se pintan más grandes: llevan un icono dentro y compiten con
              // la imagen del satélite, donde un punto de 6 px se pierde entre los techos.
              'circle-radius': ['case', ['==', ['get', 'cluster'], true], 14, c.key === 'clientes' ? 10 : 6],
              'circle-color': c.key === 'clientes'
                // El color dice el ESTADO DEL SERVICIO, que es lo que se mira en el mapa
                // cuando entra un reclamo. La discrepancia de documentación —que antes
                // ocupaba este color— se muestra en el popup, donde se consulta al
                // investigar un caso concreto y no compite con la operación diaria.
                ? COLOR_POR_ESTADO
                : c.color,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
            },
          });
          // Silueta blanca dentro del pin del abonado. Va en su propia capa symbol y no en
          // el circle porque MapLibre no dibuja iconos dentro de un círculo: son dos capas
          // superpuestas sobre la misma fuente, así que se mueven juntas siempre.
          if (c.key === 'clientes') {
            m.addLayer({
              id: 'clientes-icono', type: 'symbol', source: c.key,
              // Los conglomerados muestran su número, no una silueta: representan a muchos.
              filter: ['!=', ['get', 'cluster'], true],
              layout: {
                'icon-image': 'usuario',
                'icon-size': 0.22,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              },
              paint: { 'icon-color': '#ffffff' },
            });
          }

          m.addLayer({
            id: `${c.key}-etiqueta`, type: 'symbol', source: c.key,
            layout: {
              'text-field': ['case', ['==', ['get', 'cluster'], true], ['to-string', ['get', 'total']], ['get', 'etiqueta']],
              'text-size': 10,
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
              'text-allow-overlap': false,
            },
            paint: { 'text-color': '#374151', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
          });
        }
      }

      // Popup al pulsar un pin, con el enlace de navegación. Es la razón principal por la
      // que soporte y campo abren este mapa: ubicar un elemento y arrancar hacia él.
      for (const c of CAPAS.filter((x) => x.tipo === 'punto')) {
        m.on('click', `${c.key}-punto`, (ev) => {
          const f = ev.features?.[0];
          if (!f) return;
          const props = f.properties ?? {};
          if (props.cluster) return; // un conglomerado no es un destino

          const [lng, lat] = (f.geometry as any).coordinates as [number, number];
          const etiqueta = String(props.etiqueta ?? c.label);

          const popup = new maplibregl.Popup({ closeButton: true, offset: 14, maxWidth: '300px' })
            .setLngLat([lng, lat])
            .setHTML(
              `<div style="font-size:12px;line-height:1.5">
                 <strong>${escaparHtml(etiqueta)}</strong><br/>
                 <span style="color:#6b7280">${lat.toFixed(6)}, ${lng.toFixed(6)}</span><br/>
                 <a href="${escaparHtml(urlComoLlegar(lat, lng, etiqueta))}" target="_blank"
                    rel="noopener noreferrer"
                    style="color:#2563eb;font-weight:500">Cómo llegar →</a>
               </div>`,
            )
            .addTo(m);

          // Los abonados abren una ficha: estado, teléfono y plan. El resto de las capas
          // se quedan con el popup básico — una mufa no tiene titular al que llamar.
          if (c.key === 'clientes' && props.id) {
            void abrirFichaAbonado(popup, String(props.id), etiqueta, lat, lng);
          }
        });

        m.on('mouseenter', `${c.key}-punto`, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', `${c.key}-punto`, () => { m.getCanvas().style.cursor = ''; });
      }

      setListo(true);
      void cargar();
    });

    // Cada desplazamiento o zoom pide sólo el rectángulo visible. Es la razón por la que
    // este visor sigue respondiendo con la planta completa cargada.
    m.on('moveend', (): void => { void cargar(); });

    mapa.current = m;
    // Referencia para diagnóstico desde la consola del navegador. El mapa falla de formas
    // que no dejan rastro —una capa que no se crea, una fuente vacía, una expresión que se
    // descarta— y sin poder interrogarlo hay que deducir el estado a ciegas.
    (window as unknown as { __mapaRed?: MapLibreMap }).__mapaRed = m;
    return () => { m.remove(); mapa.current = null; };
  }, [cargar]);

  // ── Volcado de datos y visibilidad ────────────────────────────
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;

    for (const c of CAPAS) {
      const src = m.getSource(c.key) as GeoJSONSource | undefined;
      src?.setData(datos[c.key] ?? { type: 'FeatureCollection', features: [] });

      const visible = activas.has(c.key) ? 'visible' : 'none';
      for (const sufijo of ['-linea', '-punto', '-icono', '-etiqueta']) {
        if (m.getLayer(`${c.key}${sufijo}`)) {
          m.setLayoutProperty(`${c.key}${sufijo}`, 'visibility', visible);
        }
      }
    }
  }, [datos, activas, listo]);

  // ── Vista base ────────────────────────────────────────────────
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo || !m.getLayer('satelite')) return;
    const sat = vista === 'satelite';
    m.setLayoutProperty('satelite', 'visibility', sat ? 'visible' : 'none');
    // La capa de calles se apaga, no se deja tapada debajo: si sigue activa, su atribución
    // se muestra junto a la del satélite —acreditando a OSM por una imagen que no es suya—
    // y además se siguen descargando teselas que nadie ve.
    m.setLayoutProperty('base', 'visibility', sat ? 'none' : 'visible');
  }, [vista, listo]);

  const cambiarVista = (v: VistaBase) => {
    setVista(v);
    try {
      window.localStorage.setItem(CLAVE_VISTA, v);
    } catch { /* localStorage bloqueado: se pierde la preferencia, no la vista */ }
  };

  const alternar = (key: CapaMapa) => {
    setActivas((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      try {
        window.localStorage.setItem(CLAVE_CAPAS, JSON.stringify(Array.from(s)));
      } catch { /* localStorage bloqueado: se pierde la preferencia, no el mapa */ }
      return s;
    });
    // Encender una capa exige pedirla: el backend sólo devuelve lo solicitado.
    setTimeout(() => void cargar(), 0);
  };

  // Una capa pedida que NO vuelve en la respuesta es una capa DENEGADA por permisos, no
  // una capa vacía. Distinguirlo evita que el operador crea que no hay clientes cargados.
  const denegadas = Array.from(activas).filter(
    (k) => datos[k] === undefined && !cargando && listo && Object.keys(datos).length > 0,
  );

  const hayDatos = Object.values(datos).some((c) => (c?.features.length ?? 0) > 0);
  const algunAgregado = Object.values(datos).some((c) => c?.agregado);

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      {/* `h-full` y no `absolute inset-0`: el CSS de MapLibre declara
          `.maplibregl-map { position: relative }` y se carga DESPUÉS de las utilities de
          Tailwind, así que gana a `.absolute`. Al dejar de ser absoluto, `inset-0` ya no
          dimensiona nada y el contenedor colapsaba a 0 de alto — las tiles se descargaban
          (200 OK) y el canvas se pintaba, pero quedaba recortado por su propio
          `overflow:hidden`. Mapa en blanco, sin un solo error en consola. */}
      <div ref={contenedor} className="h-full w-full" />

      {/* Panel de capas */}
      <div className="absolute top-3 left-3 z-10 rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg p-3 space-y-2 min-w-[190px]">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Layers className="w-3.5 h-3.5" /> Capas
          {cargando && <Loader2 className="w-3 h-3 animate-spin ml-auto text-muted-foreground" />}
        </div>

        {CAPAS.map((c) => {
          const denegada = denegadas.includes(c.key);
          return (
            <label key={c.key}
              className={cn('flex items-center gap-2 text-xs cursor-pointer',
                denegada && 'opacity-50 cursor-not-allowed')}>
              <input type="checkbox" checked={activas.has(c.key)}
                onChange={() => alternar(c.key)} className="accent-primary" />
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
              <span className="text-foreground">{c.label}</span>
              {denegada
                ? <span className="text-[10px] text-muted-foreground ml-auto">sin permiso</span>
                // Cuántos elementos hay en la vista actual, por capa. Sin esto, "no veo
                // nada" es ambiguo: no se distingue una capa vacía de una que trae datos
                // pero no llega a dibujarse, y son dos averías distintas.
                : activas.has(c.key) && (
                  <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                    {datos[c.key]?.features.length ?? 0}
                  </span>
                )}
            </label>
          );
        })}

        {/* Vista base. Va en el mismo panel y no en un control aparte: es la misma
            decisión —qué se ve— y separarla obligaría a buscarla en otro sitio. */}
        <div className="pt-2 mt-1 border-t border-border flex gap-1">
          {([['normal', 'Mapa'], ['satelite', 'Satélite']] as const).map(([v, etiqueta]) => (
            <button key={v} type="button" onClick={() => cambiarVista(v)}
              className={cn(
                'flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                vista === v
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}>
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* Estados que el operador necesita distinguir */}
      {error && (
        <div className="absolute bottom-3 left-3 z-10 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 max-w-sm">
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-[11px] text-destructive">{error}</p>
        </div>
      )}

      {!error && listo && !cargando && !hayDatos && (
        <div className="absolute bottom-3 left-3 z-10 flex items-start gap-2 rounded-lg bg-card/95 border border-border px-3 py-2 max-w-sm">
          <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Sin elementos en esta zona. Carga la planta desde Planta Externa, o mueve el
            mapa a donde esté tu red.
          </p>
        </div>
      )}

      {algunAgregado && (
        <div className="absolute bottom-3 right-3 z-10 rounded-lg bg-card/95 border border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            Vista agrupada — acerca el zoom para ver elementos individuales
          </p>
        </div>
      )}
    </div>
  );
}
