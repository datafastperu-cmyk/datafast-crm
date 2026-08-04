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

export function MapaRedContent() {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapLibreMap | null>(null);
  const [listo, setListo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<RespuestaMapa>({});
  const [activas, setActivas] = useState<Set<CapaMapa>>(
    new Set<CapaMapa>(['fibra', 'sites', 'mufas', 'naps']),
  );

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
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
      center: CENTRO_INICIAL,
      zoom: 13,
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
              'line-dasharray': ['case', ['get', 'trazadoLevantado'], ['literal', [1]], ['literal', [2, 1.5]]],
            },
          });
        } else {
          m.addLayer({
            id: `${c.key}-punto`, type: 'circle', source: c.key,
            paint: {
              // Los conglomerados crecen con la cantidad que representan.
              'circle-radius': ['case', ['get', 'cluster'], 14, 6],
              'circle-color': c.key === 'clientes'
                // Un cliente cuya NAP documentada NO coincide con su puerto PON real se
                // pinta distinto. Es lo que convierte el mapa en detector de errores de
                // documentación en vez de un dibujo bonito.
                ? ['match', ['get', 'confianza'],
                    'verificado', '#10b981', 'discrepante', '#ef4444', '#3b82f6']
                : c.color,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
            },
          });
          m.addLayer({
            id: `${c.key}-etiqueta`, type: 'symbol', source: c.key,
            layout: {
              'text-field': ['case', ['get', 'cluster'], ['to-string', ['get', 'total']], ['get', 'etiqueta']],
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

          new maplibregl.Popup({ closeButton: true, offset: 12 })
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
      for (const sufijo of ['-linea', '-punto', '-etiqueta']) {
        if (m.getLayer(`${c.key}${sufijo}`)) {
          m.setLayoutProperty(`${c.key}${sufijo}`, 'visibility', visible);
        }
      }
    }
  }, [datos, activas, listo]);

  const alternar = (key: CapaMapa) => {
    setActivas((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
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
      <div ref={contenedor} className="absolute inset-0" />

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
              {denegada && <span className="text-[10px] text-muted-foreground ml-auto">sin permiso</span>}
            </label>
          );
        })}
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
