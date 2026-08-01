'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle } from 'lucide-react';

import { plantaExternaApi, type NapPuerto } from '@/lib/api/planta-externa';

const INPUT = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50';

interface Props {
  /** Puerto asignado hoy. Al editar hay que poder conservarlo aunque esté `ocupado`. */
  puertoIdActual?: string | null;
  napIdSeleccionada: string;
  puertoIdSeleccionado: string;
  onNap: (_napId: string) => void;
  onPuerto: (_puertoId: string) => void;
  disabled?: boolean;
}

/**
 * Selección de caja NAP y puerto contra la planta REAL.
 *
 * Reemplaza a `MOCK_CAJAS_NAP` y a los 8 puertos que se generaban con
 * `Array.from({length: 8})` — datos inventados que el operador elegía creyendo que
 * significaban algo, y que se guardaban como texto libre sin relación con `pe_nap`. Un
 * dato falso que parece real es peor que un campo vacío: nadie lo audita porque nadie
 * sospecha de él.
 *
 * Sólo ofrece puertos ASIGNABLES. Un puerto `no_habilitado` (sin splitter detrás) o
 * `averiado` no se puede vender, y listarlo obligaría al operador a descubrirlo por
 * rechazo, después de haberle prometido una fecha de instalación al cliente.
 */
export function SelectorAcometida({
  puertoIdActual, napIdSeleccionada, puertoIdSeleccionado, onNap, onPuerto, disabled,
}: Props) {
  const { data: naps = [], isLoading: cargandoNaps } = useQuery({
    queryKey: ['planta-externa-naps'],
    queryFn:  () => plantaExternaApi.listarNaps(),
  });

  const { data: puertos = [], isLoading: cargandoPuertos } = useQuery({
    queryKey: ['planta-externa-puertos', napIdSeleccionada],
    queryFn:  () => plantaExternaApi.listarPuertos(napIdSeleccionada),
    enabled:  !!napIdSeleccionada,
  });

  const asignable = (p: NapPuerto) =>
    p.estado === 'libre' || p.id === puertoIdActual;

  const disponibles = puertos.filter(asignable);
  const sinSplitter = puertos.filter((p) => p.estado === 'no_habilitado').length;

  const etiquetaPuerto = (p: NapPuerto) => {
    if (p.id === puertoIdActual && p.estado === 'ocupado') return `Puerto ${p.numero} (actual)`;
    return `Puerto ${p.numero}`;
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Caja NAP</label>
        <select
          className={INPUT}
          value={napIdSeleccionada}
          onChange={(e) => { onNap(e.target.value); onPuerto(''); }}
          disabled={disabled || cargandoNaps}
        >
          <option value="">— Sin asignar —</option>
          {naps.map((n) => (
            // La ocupación va en la etiqueta: elegir una caja saturada y descubrirlo al
            // abrir el segundo selector es un paso perdido.
            <option key={n.id} value={n.id} disabled={n.puertosLibres === 0}>
              {n.codigo} — {n.puertosLibres > 0 ? `${n.puertosLibres} libres` : 'saturada'}
            </option>
          ))}
        </select>

        {!cargandoNaps && naps.length === 0 && (
          <p className="text-[11px] text-amber-500 mt-1">
            No hay cajas NAP registradas. Créalas en Gestión de Red → Planta Externa.
          </p>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Puerto</label>
        <select
          className={INPUT}
          value={puertoIdSeleccionado}
          onChange={(e) => onPuerto(e.target.value)}
          disabled={disabled || !napIdSeleccionada || cargandoPuertos}
        >
          <option value="">— Sin asignar —</option>
          {disponibles.map((p) => (
            <option key={p.id} value={p.id}>{etiquetaPuerto(p)}</option>
          ))}
        </select>

        {cargandoPuertos && (
          <p className="text-[11px] text-muted-foreground mt-1 inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Cargando puertos…
          </p>
        )}

        {/* Distingue "caja llena de clientes" de "caja sin splitter instalado": son dos
            problemas distintos —uno pide obra nueva, el otro sólo un splitter— y el
            diseño original los mostraba igual. */}
        {!cargandoPuertos && napIdSeleccionada && disponibles.length === 0 && (
          <p className="text-[11px] text-amber-500 mt-1 inline-flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            {sinSplitter > 0
              ? `Sin puertos libres. Hay ${sinSplitter} sin splitter instalado: se habilitan desde Planta Externa.`
              : 'Todos los puertos de esta caja están ocupados.'}
          </p>
        )}
      </div>
    </div>
  );
}
