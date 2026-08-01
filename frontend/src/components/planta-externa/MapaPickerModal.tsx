'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { X, MapPin, Check } from 'lucide-react';

import { Portal } from '@/components/ui/portal';

const TILE_URL =
  process.env.NEXT_PUBLIC_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIB =
  process.env.NEXT_PUBLIC_TILE_ATTRIB || '© OpenStreetMap contributors';

const CENTRO_POR_DEFECTO: [number, number] = [
  Number(process.env.NEXT_PUBLIC_MAPA_LNG ?? -77.0428),
  Number(process.env.NEXT_PUBLIC_MAPA_LAT ?? -12.0464),
];

interface Props {
  /** Coordenada de partida. Si no hay, se abre en el centro configurado del operador. */
  latitud?: number;
  longitud?: number;
  onConfirmar: (_lat: number, _lng: number) => void;
  onCerrar: () => void;
}

/**
 * Selección de coordenada arrastrando un pin sobre el mapa — Variante B del expediente.
 *
 * Es el camino principal desde escritorio, que es donde se documenta la mayor parte de la
 * planta: el operador rara vez está parado junto a la mufa, y pegar coordenadas exige que
 * alguien ya las haya obtenido de otro lado.
 *
 * Al confirmar entrega el par al formulario, que lo trata igual que uno tecleado o
 * capturado por GPS. No hay un tercer camino de validación: si esta pantalla pudiera
 * producir un valor que el parser rechaza, tendríamos dos reglas distintas para el mismo
 * dato — y una de ellas acabaría desactualizada.
 */
export function MapaPickerModal({ latitud, longitud, onConfirmar, onCerrar }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapLibreMap | null>(null);
  const marcador = useRef<Marker | null>(null);

  const inicial: [number, number] =
    latitud != null && longitud != null ? [longitud, latitud] : CENTRO_POR_DEFECTO;

  const [pos, setPos] = useState<[number, number]>(inicial);

  useEffect(() => {
    if (!contenedor.current || mapa.current) return undefined;

    const m = new maplibregl.Map({
      container: contenedor.current,
      style: {
        version: 8,
        sources: {
          base: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIB },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
      center: inicial,
      // Zoom alto de entrada: a nivel de ciudad el pin no se puede colocar sobre un poste
      // concreto, que es la precisión que este módulo necesita.
      zoom: latitud != null ? 18 : 15,
    });

    m.addControl(new maplibregl.NavigationControl({}), 'top-right');

    const marker = new maplibregl.Marker({ draggable: true, color: '#2563eb' })
      .setLngLat(inicial)
      .addTo(m);

    marker.on('dragend', () => {
      const l = marker.getLngLat();
      setPos([l.lng, l.lat]);
    });

    // Clic en cualquier punto = mover el pin ahí. Arrastrar es preciso pero lento para
    // recorrer distancias; el clic cubre el movimiento grueso.
    m.on('click', (ev) => {
      marker.setLngLat(ev.lngLat);
      setPos([ev.lngLat.lng, ev.lngLat.lat]);
    });

    mapa.current = m;
    marcador.current = marker;

    return () => { m.remove(); mapa.current = null; marcador.current = null; };
    // Deps vacías a propósito: el mapa se construye UNA vez. Incluir `inicial`/`latitud`
    // lo recrearía cada vez que el operador mueve el pin —el estado cambia en cada
    // arrastre— y perdería la posición justo mientras la está eligiendo.
  }, []); // eslint-disable-line

  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={onCerrar}>
        <div role="dialog" aria-modal="true"
          className="w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}>

          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Elegir ubicación en el mapa</h3>
                <p className="text-[11px] text-muted-foreground">
                  Haz clic o arrastra el pin hasta el punto exacto
                </p>
              </div>
            </div>
            <button onClick={onCerrar} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={contenedor} className="h-[60vh] w-full" />

          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
            {/* La coordenada se muestra mientras se mueve el pin: el operador confirma un
                número concreto, no "donde quedó el pin". */}
            <p className="text-[11px] text-muted-foreground font-mono">
              {pos[1].toFixed(6)}, {pos[0].toFixed(6)}
            </p>
            <div className="flex gap-2">
              <button onClick={onCerrar}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
                Cancelar
              </button>
              <button
                onClick={() => onConfirmar(Number(pos[1].toFixed(7)), Number(pos[0].toFixed(7)))}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" /> Usar esta ubicación
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
