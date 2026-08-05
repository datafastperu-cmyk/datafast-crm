'use client';

import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Crosshair, Loader2, ShieldAlert, AlertTriangle, Settings, Map as MapIcon } from 'lucide-react';

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

/**
 * Tiempo máximo esperando una lectura suficientemente precisa.
 *
 * 60 s y no 15: un GPS que arranca en frío tarda entre 20 y 60 segundos en fijar
 * satélites. El corte anterior expiraba antes de que el receptor llegara a funcionar y
 * reportaba un fallo donde sólo había prisa.
 */
const TIEMPO_MAX_MS = 60_000;

/**
 * Enlace a la pantalla de ajustes de ubicación de Android.
 *
 * Es lo MÁS que puede hacer una página web, y conviene tenerlo claro: el diálogo nativo de
 * "Activar ubicación / Aceptar" que muestran las apps de reparto viene de Google Play
 * Services (`SettingsClient`), una API exclusiva de aplicaciones. Una web no puede
 * encender el GPS ni pedirlo; como mucho puede llevar al operador a la pantalla correcta.
 *
 * Best-effort a propósito: Chrome en Android suele abrir estos `intent://`, pero otros
 * navegadores los ignoran en silencio. Por eso las instrucciones escritas se muestran
 * SIEMPRE junto al botón — si el enlace no hace nada, la salida sigue estando a la vista.
 */
const INTENT_AJUSTES_UBICACION =
  'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end';

/** Android es el único donde existe ese atajo; iOS no expone nada equivalente. */
function esAndroid(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

/**
 * Traduce el fallo del navegador a algo sobre lo que el operador pueda actuar.
 *
 * El mensaje nativo (`err.message`) suele venir vacío o decir "Timeout expired", que no
 * indica qué hacer. Y la distinción que más importa no aparece en ninguna parte: **el
 * navegador no puede encender el GPS del teléfono**. Si la ubicación del sistema está
 * apagada, ningún permiso concedido en el sitio va a servir, y pedirle al operador que
 * "habilite el permiso" lo manda al lugar equivocado.
 */
interface AvisoGps {
  texto: string;
  /** Si el fallo se resuelve encendiendo la ubicación del sistema, no dentro del navegador. */
  ajustesDelSistema: boolean;
}

function explicarErrorGps(err: GeolocationPositionError): AvisoGps {
  if (err.code === err.PERMISSION_DENIED) {
    // Este NO se arregla en los ajustes del teléfono: es permiso del sitio en el navegador.
    // Ofrecer ahí el botón de ubicación mandaría al operador a dar vueltas.
    return {
      ajustesDelSistema: false,
      texto: 'El navegador tiene bloqueada la ubicación para este sitio. Ábrelo desde el candado ' +
             'junto a la dirección → Permisos → Ubicación. Si ya la rechazaste antes, el navegador ' +
             'lo recuerda y no vuelve a preguntar hasta que lo restablezcas.',
    };
  }
  if (err.code === err.POSITION_UNAVAILABLE) {
    return {
      ajustesDelSistema: true,
      texto: 'La ubicación del dispositivo está apagada o sin señal. Hay que encenderla en los ' +
             'ajustes del teléfono: el navegador no puede hacerlo por ti.',
    };
  }
  return {
    ajustesDelSistema: true,
    texto: 'El GPS tardó demasiado en responder. Suele ser que la ubicación del teléfono esté ' +
           'apagada, o que estés bajo techo.',
  };
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
  const [aviso, setAviso] = useState<AvisoGps | null>(null);
  /** Qué está haciendo el GPS ahora mismo. Un botón que gira en silencio parece colgado. */
  const [progreso, setProgreso] = useState<string | null>(null);

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

  /**
   * Captura por GPS con lecturas sucesivas.
   *
   * `watchPosition` y no `getCurrentPosition`: un GPS en frío —el teléfono recién sacado
   * del bolsillo, que es el caso real en campo— tarda entre 20 y 60 segundos en fijar
   * satélites, y mientras tanto entrega lecturas que van mejorando: primero ±2000 m por
   * antenas de telefonía, luego ±100 m, y al final ±5 m. Una sola consulta con 15 s de
   * espera fallaba justo en el escenario para el que existe este botón.
   *
   * Se acepta la primera lectura que baje del umbral y se corta el seguimiento. Mientras
   * tanto se muestra la precisión actual, porque un botón que gira sin decir nada durante
   * un minuto parece colgado y el operador lo abandona antes de que el GPS fije.
   */
  /**
   * Seguimiento en curso, para poder cortarlo al desmontar.
   *
   * Sin esto, cerrar el modal mientras el GPS busca deja el `watchPosition` vivo: sigue
   * consumiendo batería en el teléfono del técnico y escribiendo estado en un componente
   * que ya no existe. Es la misma regla que rige los wizards — lo que se cierra no deja
   * nada corriendo detrás.
   */
  const enCurso = useRef<{ watch: number; limite: number } | null>(null);

  useEffect(() => () => {
    if (!enCurso.current) return;
    navigator.geolocation.clearWatch(enCurso.current.watch);
    window.clearTimeout(enCurso.current.limite);
  }, []);

  const capturar = () => {
    if (!gpsDisponible || capturando) return;
    setCapturando(true);
    setAviso(null);
    setProgreso('Buscando satélites…');

    let mejor: GeolocationPosition | null = null;

    const terminar = () => {
      navigator.geolocation.clearWatch(id);
      window.clearTimeout(limite);
      enCurso.current = null;
      setCapturando(false);
      setProgreso(null);
    };

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const precision = Math.round(pos.coords.accuracy);
        if (!mejor || pos.coords.accuracy < mejor.coords.accuracy) mejor = pos;

        // Una captura imprecisa se RECHAZA, no se guarda con una advertencia que nadie
        // lee. Guardarla igual sería documentar una mufa en el lugar equivocado con la
        // misma confianza que una bien medida.
        if (precision > PRECISION_MAX_M) {
          setProgreso(`Afinando… precisión actual ±${precision} m (se necesita ±${PRECISION_MAX_M} m)`);
          return;
        }

        terminar();
        const lat = Number(pos.coords.latitude.toFixed(7));
        const lng = Number(pos.coords.longitude.toFixed(7));

        // El campo de texto se sincroniza con lo capturado: el operador ve la coordenada
        // que se va a guardar y puede corregirla, en vez de un campo vacío que aparenta
        // que el GPS no hizo nada.
        setTexto(`${lat}, ${lng}`);
        onChange({ latitud: lat, longitud: lng, precisionGpsM: precision });
      },
      (err) => {
        terminar();
        setAviso(explicarErrorGps(err));
      },
      // Alta precisión: sin esto el navegador puede devolver la posición por IP, que en
      // Perú suele apuntar al centro de Lima. Sería una coordenada plausible y falsa.
      // Sin `timeout` propio: lo gobierna el corte de abajo, que sí sabe qué se llegó a
      // medir y puede decirlo.
      { enableHighAccuracy: true, maximumAge: 0 },
    );

    const limite = window.setTimeout(() => {
      const alcanzada = mejor ? Math.round(mejor.coords.accuracy) : null;
      terminar();
      setAviso(
        alcanzada == null
          // Ninguna lectura en 60 s apunta casi siempre a la ubicación del sistema apagada.
          ? {
            ajustesDelSistema: true,
            texto: 'El GPS no devolvió ninguna lectura en 60 segundos. Suele ser que la ubicación ' +
                   'del teléfono esté apagada.',
          }
          // Aquí SÍ hubo señal: el receptor funciona y el problema es el entorno. Mandar a los
          // ajustes sería el consejo equivocado.
          : {
            ajustesDelSistema: false,
            texto: `La mejor precisión en 60 segundos fue ±${alcanzada} m, y se necesita ` +
                   `±${PRECISION_MAX_M} m. Aléjate de paredes y techos y reintenta, o marca el ` +
                   'punto en el mapa.',
          },
      );
    }, TIEMPO_MAX_MS);

    enCurso.current = { watch: id, limite };
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

      {/* Estado en vivo del GPS. Fijar satélites puede tardar un minuto, y sin decir qué
          está pasando el operador cree que se colgó y abandona antes de que llegue la
          lectura buena. La precisión que se va alcanzando también le dice si moverse. */}
      {progreso && (
        <div className="flex items-start gap-2 rounded-lg bg-muted/40 border border-border px-3 py-2">
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5 animate-spin" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">{progreso}</p>
        </div>
      )}

      {aviso && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
            <p className="text-[11px] text-destructive leading-relaxed">{aviso.texto}</p>
          </div>

          {aviso.ajustesDelSistema && (
            <div className="pl-6 space-y-1.5">
              {/* Sólo Android: iOS no expone ningún atajo a los ajustes desde el navegador. */}
              {esAndroid() && (
                <a href={INTENT_AJUSTES_UBICACION}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-destructive/15
                             text-[11px] font-medium text-destructive hover:bg-destructive/25 transition-colors">
                  <Settings className="w-3 h-3" /> Abrir ajustes de ubicación
                </a>
              )}
              {/* Las instrucciones se muestran SIEMPRE, también junto al botón: el enlace es
                  best-effort —hay navegadores que lo ignoran sin avisar— y un botón que no
                  hace nada, sin alternativa a la vista, deja al técnico parado en la calle. */}
              <p className="text-[11px] text-destructive/80 leading-relaxed">
                {esAndroid()
                  ? 'Si el botón no abre nada: desliza desde arriba y toca el icono de Ubicación, o entra en Ajustes → Ubicación.'
                  : 'Actívala en Ajustes → Privacidad → Localización.'}
                {' '}Luego vuelve aquí y pulsa «Usar mi ubicación». También puedes marcar el punto en el mapa.
              </p>
            </div>
          )}
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
