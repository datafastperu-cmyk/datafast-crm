'use client';

import { useEffect, useState, lazy, Suspense } from 'react';
import { Crosshair, Loader2, ShieldAlert, AlertTriangle, Map as MapIcon } from 'lucide-react';

// Carga diferida: MapLibre pesa ~250 kB y este componente vive en formularios que la
// mayoría de las veces se completan pegando o con GPS, sin abrir el mapa nunca.
const MapaPickerModal = lazy(() =>
  import('./MapaPickerModal').then((m) => ({ default: m.MapaPickerModal })),
);

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

/**
 * Ambas variantes declaran los cuatro campos (los ausentes como `undefined`) en vez de ser
 * un union discriminado puro: el `tsconfig` del frontend tiene `strict: false`, y sin
 * `strictNullChecks` el compilador no estrecha por `ok`. Declararlos así mantiene el tipado
 * útil sin obligar a cada lector a saber por qué hace falta un cast.
 */
type Parseo =
  | { ok: true;  latitud: number;     longitud: number;     motivo?: undefined }
  | { ok: false; latitud?: undefined; longitud?: undefined; motivo: string | null };

/**
 * Interpreta un par de coordenadas escrito o pegado en UN SOLO campo.
 *
 * En la base de datos son dos columnas —el visor consulta por bounding box sobre un índice
 * compuesto `(empresa_id, latitud, longitud)`, y con un texto concatenado ese índice no
 * existe—. Pero el operador no escribe coordenadas: las PEGA, y Google Maps las entrega
 * como una sola cadena. Obligarlo a partirla a mano en dos campos es exactamente donde se
 * cuelan los errores de pegado.
 *
 * Acepta los separadores que aparecen en la práctica: coma, punto y coma, o espacios.
 */
export function parsearCoordenadas(entrada: string): Parseo {
  const texto = entrada.trim();
  if (texto === '') return { ok: false, motivo: null };

  // Grados/minutos/segundos: es lo que Google Maps MUESTRA en pantalla (12°02'47.0"S),
  // aunque "copiar coordenadas" entregue decimales. Se detecta para explicarlo en vez de
  // fallar con un "formato inválido" que no dice qué hacer.
  if (/[°'"′″]|[NSEWO]\s*$/i.test(texto)) {
    return {
      ok: false,
      motivo: 'Formato en grados/minutos/segundos. Usa decimales: en Google Maps, clic derecho sobre el punto → la primera opción copia el par decimal.',
    };
  }

  const partes = texto.split(/[,;\s]+/).filter(Boolean);
  if (partes.length !== 2) {
    return { ok: false, motivo: 'Escribe dos valores: latitud y longitud, separados por coma.' };
  }

  const [lat, lng] = partes.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, motivo: 'Alguno de los dos valores no es un número.' };
  }

  // Inversión de orden: si el PRIMER valor supera ±90 no puede ser una latitud.
  //
  // ALCANCE REAL, medido: sólo detecta la inversión cuando la longitud supera 90°, es
  // decir buena parte de Asia, Oceanía y el Pacífico. **En Perú NO se dispara** —la
  // longitud ronda −77, dentro del rango válido de latitud— así que un par invertido de
  // Lima pasa este control sin problema. Es matemáticamente indetectable: ambos valores
  // son latitudes y longitudes plausibles.
  //
  // Lo que protege ese caso es el eco de abajo ("Lat … · Lng …"), que muestra lo que el
  // sistema ENTENDIÓ y deja que el operador lo confirme. Por eso el eco no es decoración.
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    return {
      ok: false,
      motivo: `Parecen invertidos: el primer valor debe ser la latitud. ¿Querías ${lng}, ${lat}?`,
    };
  }

  if (Math.abs(lat) > 90)  return { ok: false, motivo: 'La latitud debe estar entre −90 y 90.' };
  if (Math.abs(lng) > 180) return { ok: false, motivo: 'La longitud debe estar entre −180 y 180.' };

  // 0,0 es el "null island" del Atlántico: casi siempre significa un campo sin llenar que
  // se guardó igual, no una coordenada real. Rechazarlo evita un pin en medio del océano.
  if (lat === 0 && lng === 0) {
    return { ok: false, motivo: 'Coordenada 0, 0 — eso apunta al Atlántico. Revisa el valor.' };
  }

  return { ok: true, latitud: lat, longitud: lng };
}

interface Props {
  value: Partial<Coordenadas>;
  onChange: (_coords: Partial<Coordenadas>) => void;
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

  /**
   * Lo que el operador tiene escrito, tal cual. Es estado propio y no derivado de `value`
   * a propósito: mientras teclea "-12.04, " el texto todavía no es una coordenada válida,
   * y reconstruirlo desde el valor padre le borraría lo escrito a media palabra.
   */
  const [texto, setTexto] = useState(
    value.latitud != null && value.longitud != null
      ? `${value.latitud}, ${value.longitud}`
      : '',
  );

  const [pickerAbierto, setPickerAbierto] = useState(false);

  const parseado = parsearCoordenadas(texto);
  /** Motivo del rechazo, o `null` si el texto es válido o está vacío (nada que explicar). */
  const errorParseo = parseado.ok ? null : parseado.motivo;

  /**
   * Coordenada elegida en el mapa. Se escribe en el MISMO campo de texto y se vuelve a
   * parsear, en vez de saltar directo al valor: así los tres caminos —tecleado, GPS y
   * mapa— pasan por una sola regla de validación. Dos rutas distintas para el mismo dato
   * terminan con una desactualizada.
   */
  const aplicarDelMapa = (lat: number, lng: number) => {
    escribir(`${lat}, ${lng}`);
    setPickerAbierto(false);
  };

  const escribir = (raw: string) => {
    setTexto(raw);
    const r = parsearCoordenadas(raw);

    // Sólo se propaga una coordenada VÁLIDA. Mientras el texto está a medias, el
    // formulario padre ve `undefined` y su botón de guardar sigue deshabilitado — no hay
    // forma de guardar media coordenada.
    onChange(
      r.ok
        ? { latitud: r.latitud, longitud: r.longitud, precisionGpsM: undefined }
        : { latitud: undefined, longitud: undefined, precisionGpsM: undefined },
    );
  };

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

        const lat = Number(pos.coords.latitude.toFixed(7));
        const lng = Number(pos.coords.longitude.toFixed(7));

        // El campo de texto se sincroniza con lo capturado: el operador ve la coordenada
        // que se va a guardar y puede corregirla, en vez de un campo vacío que aparenta
        // que el GPS no hizo nada.
        setTexto(`${lat}, ${lng}`);
        onChange({ latitud: lat, longitud: lng, precisionGpsM: precision });
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className={labelCls}>Coordenadas *</label>

        <div className="flex items-center gap-3">
          {/* El mapa NO depende de secure context, así que está siempre disponible. Es el
              camino principal desde escritorio, donde se documenta la mayor parte de la
              planta — y el único que funciona en instalaciones sin HTTPS. */}
          <button
            type="button"
            onClick={() => setPickerAbierto(true)}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
          >
            <MapIcon className="w-3.5 h-3.5" /> Elegir en el mapa
          </button>

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
      </div>

      <input
        className={inputCls}
        type="text"
        inputMode="text"
        placeholder="-12.0464, -77.0428"
        value={texto}
        onChange={(e) => escribir(e.target.value)}
        disabled={disabled}
      />

      {/* Se muestra lo que el sistema ENTENDIÓ, no lo que el operador escribió. Un pegado
          con un carácter de más se ve idéntico al ojo; el eco separado en lat y lng lo
          delata de un vistazo, antes de guardar. */}
      {parseado.ok && (
        <p className="text-[11px] text-emerald-500">
          Lat {parseado.latitud.toFixed(6)} · Lng {parseado.longitud.toFixed(6)}
        </p>
      )}

      {errorParseo && texto.trim() !== '' && (
        <p className="text-[11px] text-destructive">{errorParseo}</p>
      )}

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

      {pickerAbierto && (
        <Suspense fallback={null}>
          <MapaPickerModal
            latitud={parseado.ok ? parseado.latitud : undefined}
            longitud={parseado.ok ? parseado.longitud : undefined}
            onConfirmar={aplicarDelMapa}
            onCerrar={() => setPickerAbierto(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
