'use client';

import { useEffect, useState } from 'react';
import { Crosshair, Loader2, ShieldAlert, AlertTriangle } from 'lucide-react';

/**
 * Precisión máxima aceptable de una captura GPS, en metros.
 *
 * Un GPS con 2 km de error rellena el formulario exactamente igual que uno bueno, y
 * nadie se entera hasta que un técnico viaja a buscar una mufa que no está donde el
 * mapa dice. Por encima de este umbral la captura se rechaza y se explica por qué;
 * el operador puede tipear la coordenada a mano si sabe lo que hace.
 */
const PRECISION_MAX_M = 50;

export interface Coordenadas {
  latitud: number;
  longitud: number;
  precisionGpsM?: number;
}

interface Props {
  value: Partial<Coordenadas>;
  onChange: (c: Partial<Coordenadas>) => void;
  disabled?: boolean;
}

const inputCls =
  'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls = 'text-xs font-medium text-muted-foreground block mb-1';

/**
 * Captura de coordenadas con degradación explícita.
 *
 * El GPS del navegador (`navigator.geolocation`) SÓLO existe en un *secure context*:
 * HTTPS, o localhost. El ERP se instala también en VPS sin dominio y en servidores
 * locales sin IP pública, donde no hay certificado — y ahí esta función no existe. No es
 * algo que se arregle con código.
 *
 * Decisiones que este componente implementa:
 *
 *  1. Se evalúa `window.isSecureContext` AL MONTAR, no al hacer clic. Descubrirlo a
 *     media alta deja al operador en un callejón sin salida; saberlo desde el principio
 *     convierte la entrada manual en el camino principal sin sorpresas.
 *  2. Se comprueba `isSecureContext`, NO si la URL empieza con `https`. Importa porque
 *     `localhost` sí es secure context, una IP de LAN no lo es, y un certificado
 *     autofirmado aceptado por el navegador sí lo es.
 *  3. El mensaje ofrece la salida real (certificado autofirmado o CA interna) en vez de
 *     un "no disponible" sin explicación: quien instala en ese servidor necesita saberlo.
 *  4. NINGÚN alta se bloquea por esto. La coordenada siempre puede tipearse. El GPS es
 *     una comodidad, no una dependencia.
 */
export function CapturaCoordenadas({ value, onChange, disabled }: Props) {
  const [gpsDisponible, setGpsDisponible] = useState<boolean | null>(null);
  const [capturando, setCapturando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Al montar, no al hacer clic. `isSecureContext` no existe en SSR, de ahí el estado
  // inicial `null` (= "todavía no se sabe") en vez de un `false` que parpadearía como
  // "no disponible" en cada render del servidor.
  useEffect(() => {
    setGpsDisponible(
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      'geolocation' in navigator,
    );
  }, []);

  const capturar = () => {
    if (!gpsDisponible) return;
    setCapturando(true);
    setAviso(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCapturando(false);
        const precision = Math.round(pos.coords.accuracy);

        // Una captura imprecisa se RECHAZA, no se guarda con una advertencia que nadie
        // lee. Guardarla igual sería documentar una mufa en el lugar equivocado con la
        // misma confianza que una bien medida.
        if (precision > PRECISION_MAX_M) {
          setAviso(
            `Señal GPS débil: precisión de ±${precision} m (máximo aceptado: ${PRECISION_MAX_M} m). ` +
            `Muévete a cielo abierto y reintenta, o ingresa la coordenada a mano.`,
          );
          return;
        }

        onChange({
          latitud: Number(pos.coords.latitude.toFixed(7)),
          longitud: Number(pos.coords.longitude.toFixed(7)),
          precisionGpsM: precision,
        });
      },
      (err) => {
        setCapturando(false);
        setAviso(
          err.code === err.PERMISSION_DENIED
            ? 'Permiso de ubicación denegado. Habilítalo en el navegador o ingresa la coordenada a mano.'
            : `No se pudo obtener la ubicación: ${err.message}`,
        );
      },
      // Alta precisión: sin esto el navegador puede devolver la posición por IP, que en
      // Perú suele apuntar al centro de Lima. Sería una coordenada plausible y falsa.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const setCampo = (campo: 'latitud' | 'longitud', raw: string) => {
    const n = raw === '' ? undefined : Number(raw);
    // Editar a mano invalida la precisión GPS: ya no describe este dato.
    onChange({ ...value, [campo]: n, precisionGpsM: undefined });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className={labelCls}>Coordenadas *</label>

        {gpsDisponible === true && (
          <button
            type="button"
            onClick={capturar}
            disabled={disabled || capturando}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
          >
            {capturando
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Ubicando…</>
              : <><Crosshair className="w-3.5 h-3.5" /> Usar mi ubicación</>}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          className={inputCls}
          type="number"
          step="0.0000001"
          placeholder="Latitud"
          value={value.latitud ?? ''}
          onChange={(e) => setCampo('latitud', e.target.value)}
          disabled={disabled}
        />
        <input
          className={inputCls}
          type="number"
          step="0.0000001"
          placeholder="Longitud"
          value={value.longitud ?? ''}
          onChange={(e) => setCampo('longitud', e.target.value)}
          disabled={disabled}
        />
      </div>

      {value.precisionGpsM != null && (
        <p className="text-[11px] text-muted-foreground">
          Capturado por GPS con precisión de ±{value.precisionGpsM} m.
        </p>
      )}

      {/* Se explica la limitación Y su solución. Un "no disponible" a secas convierte
          una restricción con salida conocida en un muro. */}
      {gpsDisponible === false && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
            La captura por GPS requiere HTTPS y este servidor no lo tiene. Ingresa la
            coordenada a mano. Para habilitarla, el servidor necesita un dominio con
            certificado, o un certificado autofirmado / CA interna en instalaciones
            locales.
          </p>
        </div>
      )}

      {aviso && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-[11px] text-destructive leading-relaxed">{aviso}</p>
        </div>
      )}
    </div>
  );
}
