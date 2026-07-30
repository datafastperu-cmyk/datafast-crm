'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wifi, WifiOff, Loader2, AlertTriangle, CheckCircle2, Clock,
  Eye, EyeOff, Router, Smartphone,
} from 'lucide-react';

import {
  portalApi, PortalError,
  type PortalBandaWifi, type ResultadoWifi,
} from '@/lib/api/portal';
import { useServicioActual } from './useServicioActual';
import { cn } from '@/lib/utils';

// Cada 60 s mientras la pantalla está abierta: el latido SUPRIME el barrido por
// inactividad que cerraría el carril debajo del abonado. No autoriza nada por sí mismo.
const HEARTBEAT_MS = 60_000;
// Mientras el carril se está abriendo, se consulta el estado cada 5 s.
const POLL_MS = 5_000;
// Tope de espera. La causa más común de que no converja es una ONU apagada o sin fibra,
// y eso no se arregla esperando: sin este límite el abonado mira un spinner indefinido
// sin saber que la solución está en su propia casa.
const ESPERA_MAX_MS = 5 * 60_000;
// Con el carril arriba, cada cuánto se revisa si el router sigue respondiendo. Por
// debajo de los 12 min con que el backend considera viva la sesión, para que el
// indicador no se entere tarde.
const LATIDO_ESTADO_MS = 60_000;

export function PortalWifi() {
  const queryClient = useQueryClient();
  const { servicio, perfil } = useServicioActual();
  const contratoId = servicio?.contratoId;
  const variosServicios = (perfil?.servicios.length ?? 0) > 1;

  // Momento en que empezó la conexión en curso, para poder rendirse a tiempo.
  const [conectandoDesde, setConectandoDesde] = useState<number | null>(null);
  const [seAgotoLaEspera, setSeAgotoLaEspera] = useState(false);

  const { data: estado, isLoading } = useQuery({
    queryKey: ['portal-onu-estado', contratoId],
    queryFn:  () => portalApi.onuEstado(contratoId!),
    enabled:  Boolean(contratoId),
    refetchInterval: (q) => {
      // Mientras se abre el carril, ritmo corto para no hacer esperar de más.
      if (q.state.data?.carril === 'conectando') return seAgotoLaEspera ? false : POLL_MS;
      // Ya conectado, ritmo lento: solo para mantener honesto el indicador de "está
      // respondiendo". Un semáforo que se consulta una vez al abrir miente a los cinco
      // minutos, y este decide si los campos se pueden editar. Es una lectura del ACS,
      // no una llamada al equipo: barata.
      if (q.state.data?.carril === 'conectado') return LATIDO_ESTADO_MS;
      return false;
    },
  });

  const conectado = estado?.carril === 'conectado';

  // Cambiar de servicio reinicia la espera: cada contrato tiene su propio carril.
  useEffect(() => {
    setConectandoDesde(null);
    setSeAgotoLaEspera(false);
  }, [contratoId]);

  useEffect(() => {
    if (estado?.carril !== 'conectando') {
      setConectandoDesde(null);
      setSeAgotoLaEspera(false);
      return undefined;
    }
    // El carril puede estar "conectando" desde antes de abrir la pantalla; se cuenta
    // desde que ESTA sesión lo observa, que es lo que el abonado percibe como espera.
    const inicio = conectandoDesde ?? Date.now();
    if (conectandoDesde === null) setConectandoDesde(inicio);

    const restante = ESPERA_MAX_MS - (Date.now() - inicio);
    if (restante <= 0) { setSeAgotoLaEspera(true); return undefined; }

    const id = setTimeout(() => setSeAgotoLaEspera(true), restante);
    return () => clearTimeout(id);
  }, [estado?.carril, conectandoDesde]);

  // El latido solo tiene sentido con el carril arriba.
  useEffect(() => {
    if (!contratoId || !conectado) return undefined;
    portalApi.onuHeartbeat(contratoId);
    const id = setInterval(() => portalApi.onuHeartbeat(contratoId), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [contratoId, conectado]);

  const { mutate: conectar, isPending: conectando } = useMutation({
    mutationFn: () => portalApi.onuConectar(contratoId!),
    onSuccess: (res) => {
      setConectandoDesde(Date.now());
      setSeAgotoLaEspera(false);
      queryClient.setQueryData(['portal-onu-estado', contratoId], res);
    },
  });

  if (isLoading || !servicio) {
    return <div className="h-40 rounded-xl bg-card border border-border animate-pulse" />;
  }

  // Servicio sin equipo administrado o plano TR-069 caído: se explica, no se deja vacío.
  if (!estado?.disponible) {
    return (
      <Aviso
        icono={WifiOff}
        titulo="Gestión de WiFi no disponible"
        mensaje={estado?.mensaje ?? 'Esta sección no está disponible para tu servicio.'}
      />
    );
  }

  if (!conectado) {
    const esperando = estado.carril === 'conectando' && !seAgotoLaEspera;

    return (
      <div className="space-y-4">
        {variosServicios && <ServicioEnUso servicio={servicio} />}

        <div className="rounded-xl border border-border bg-card p-6 text-center space-y-4">
          <Router className="w-10 h-10 text-primary mx-auto" />
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">Conecta tu router</p>
            <p className="text-sm text-muted-foreground">
              {seAgotoLaEspera
                ? 'No conseguimos contactar tu router.'
                : estado.mensaje}
            </p>
          </div>

          {esperando ? (
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Conectando… puede tomar unos minutos
            </div>
          ) : (
            <>
              {/* Rendirse a tiempo y decir qué hacer: la causa habitual está en casa del
                  abonado, y esperar más no la resuelve. */}
              {seAgotoLaEspera && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left space-y-1.5">
                  <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">
                    Revisa antes de reintentar:
                  </p>
                  <ul className="text-sm text-amber-800 dark:text-amber-300 list-disc pl-5 space-y-0.5">
                    <li>Que el router esté encendido y con las luces habituales.</li>
                    <li>Que el cable de fibra no se haya desconectado.</li>
                  </ul>
                  <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                    Si todo está bien y sigue sin conectar, escríbenos por soporte.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => conectar()}
                disabled={conectando}
                className={cn(
                  'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg',
                  'text-sm font-medium bg-primary text-primary-foreground',
                  'hover:opacity-90 transition-opacity disabled:opacity-50',
                )}
              >
                {conectando && <Loader2 className="w-4 h-4 animate-spin" />}
                {seAgotoLaEspera ? 'Reintentar' : 'Conectar router'}
              </button>
            </>
          )}

          {/* El carril es una SESIÓN de gestión, no un estado permanente: se cierra solo
              tras unos días sin uso. Sin decirlo, el abonado vuelve la semana siguiente,
              ve este mismo botón y cree que algo se rompió. */}
          <p className="text-xs text-muted-foreground">
            La conexión con tu router se cierra sola tras unos días sin usarla. Volver a
            abrirla no afecta a tu servicio de internet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BandasWifi
      contratoId={contratoId!}
      servicio={variosServicios ? servicio : null}
      sesionViva={estado.vivo}
      onReconectar={() => conectar()}
      reconectando={conectando}
    />
  );
}

// Estado del router, junto a la fecha de la lectura.
//
// Muestra si el equipo RESPONDE AHORA, no si el carril está abierto: en esta pantalla el
// carril siempre lo está —si no, se vería la de "Conectar router"—, así que un
// "Conectado" permanente sería decorativo y daría confianza justo cuando no toca. Lo que
// varía, y lo que decide si los campos se pueden editar, es esto.
//
// El color acompaña al texto, nunca lo sustituye: el estado se lee, no se deduce.
function EstadoRouter({ vivo }: { vivo: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium flex-shrink-0',
        vivo
          ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
          : 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
      )}
      title={vivo
        ? 'Tu router está en contacto con nosotros'
        : 'Tu router no ha respondido en los últimos minutos'}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', vivo ? 'bg-emerald-500' : 'bg-amber-500')} />
      {vivo ? 'Router conectado' : 'Sin respuesta'}
    </span>
  );
}

// Qué servicio se está configurando. Solo aparece con más de un servicio: cambiar el
// nombre o la clave del WiFi de la casa equivocada es un error caro y silencioso — el
// afectado no se entera hasta que sus equipos dejan de conectar.
function ServicioEnUso({ servicio }: { servicio: { planNombre: string; direccion: string | null; numeroContrato: string } }) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <p className="text-xs text-muted-foreground">Estás configurando el WiFi de</p>
      <p className="text-sm font-medium text-foreground">
        {servicio.planNombre} · {servicio.direccion ?? `Contrato ${servicio.numeroContrato}`}
      </p>
    </div>
  );
}

function BandasWifi({
  contratoId, servicio, sesionViva, onReconectar, reconectando,
}: {
  contratoId: string;
  /** Solo con más de un servicio: recordar cuál se está tocando. */
  servicio: { planNombre: string; direccion: string | null; numeroContrato: string } | null;
  sesionViva: boolean;
  onReconectar: () => void;
  reconectando: boolean;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['portal-wifi', contratoId],
    queryFn:  () => portalApi.onuWifi(contratoId),
    refetchOnWindowFocus: false,
  });

  // Arranca en la vista separada solo si las bandas YA están distintas: ese abonado las
  // separó a propósito y colapsarlas le borraría la configuración sin avisar.
  const bandasDistintas =
    (data?.bandas.length ?? 0) === 2 &&
    data!.bandas[0].ssid !== data!.bandas[1].ssid;
  const [porBanda, setPorBanda] = useState(false);
  useEffect(() => { if (bandasDistintas) setPorBanda(true); }, [bandasDistintas]);

  // Releer del equipo es explícito: espera al CPE y puede tardar. Al abrir la sección se
  // muestra la última lectura conocida con su hora — antes se forzaba el refresco y la
  // pantalla se quedaba en blanco al agotarse el tiempo.
  const { mutate: releer, isPending: releyendo } = useMutation({
    mutationFn: () => portalApi.onuWifi(contratoId, true),
    onSuccess: (fresco) => queryClient.setQueryData(['portal-wifi', contratoId], fresco),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-56 rounded-xl bg-card border border-border animate-pulse" />
        <div className="h-56 rounded-xl bg-card border border-border animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Aviso
        icono={AlertTriangle}
        titulo="No pudimos leer tu WiFi"
        mensaje={
          error instanceof PortalError
            ? error.message
            : 'Tu router no está respondiendo. Verifica que esté encendido.'
        }
        onReintentar={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      {servicio && <ServicioEnUso servicio={servicio} />}

      {/* La hora de la lectura va SIEMPRE a la vista: es lo que le dice al abonado si lo
          que ve es de ahora o de hace un rato. */}
      <div className="flex items-center justify-between gap-3 px-1 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <EstadoRouter vivo={sesionViva} />
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            {data.ultimaLectura
              ? `Datos de ${new Date(data.ultimaLectura).toLocaleString('es-PE')}`
              : 'Sin lectura previa del equipo'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => releer()}
          disabled={releyendo}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline flex-shrink-0"
        >
          {releyendo && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {releyendo ? 'Consultando tu router…' : 'Actualizar'}
        </button>
      </div>

      {/* Sin sesión viva la edición está cerrada. Explicarlo no basta: hay que ofrecer la
          salida, o el abonado queda en un callejón. Reconectar re-despierta el carril. */}
      {!data.editable && data.motivoNoEditable && (
        <Aviso
          icono={AlertTriangle}
          titulo="Solo lectura"
          mensaje={data.motivoNoEditable}
          onReintentar={!sesionViva ? onReconectar : undefined}
          textoReintentar={reconectando ? 'Reconectando…' : 'Reintentar conexión'}
          reintentando={reconectando}
        />
      )}

      {/* Vista unificada por defecto: para el abonado su WiFi es UNA red, no dos. El
          formulario por banda solo le daba dos oportunidades de dejarlas desincronizadas.
          La separada sigue disponible para quien la necesita — hay equipos IoT que solo
          funcionan en 2.4 y se confunden si ven el mismo nombre en 5 GHz. */}
      {porBanda ? (
        <>
          {data.bandas.map((banda) => (
            <TarjetaBanda
              key={banda.banda}
              contratoId={contratoId}
              banda={banda}
              editable={data.editable}
              ubicacion={servicio?.direccion ?? null}
            />
          ))}
        </>
      ) : (
        <TarjetaWifiUnificada
          contratoId={contratoId}
          bandas={data.bandas}
          editable={data.editable}
          ubicacion={servicio?.direccion ?? null}
        />
      )}

      <button
        type="button"
        onClick={() => setPorBanda((v) => !v)}
        className="text-xs font-medium text-primary hover:underline px-1"
      >
        {porBanda
          ? 'Usar el mismo nombre y clave en ambas redes'
          : 'Configurar cada banda por separado'}
      </button>

      {/* Único acceso a Equipos desde un móvil: la barra inferior solo admite 5 destinos
          legibles y esta es la sección con la que se relaciona de forma natural. */}
      <Link
        href="/portal/dispositivos"
        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4 hover:border-primary/50 transition-colors"
      >
        <span className="text-sm text-foreground">Ver los equipos conectados a mi red</span>
        <Smartphone className="w-4 h-4 text-muted-foreground" />
      </Link>
    </div>
  );
}

// Un solo nombre y una sola clave para las dos bandas. El equipo elige la mejor para
// cada dispositivo (band steering), que es como funciona cualquier router doméstico hoy.
function TarjetaWifiUnificada({
  contratoId, bandas, editable, ubicacion,
}: {
  contratoId: string;
  bandas: PortalBandaWifi[];
  editable: boolean;
  ubicacion: string | null;
}) {
  const queryClient = useQueryClient();
  // Si ambas coinciden se muestra ese nombre; si no, se deja vacío para no dar por bueno
  // el de una de las dos.
  const comun = bandas.length === 2 && bandas[0].ssid === bandas[1].ssid
    ? bandas[0].ssid ?? ''
    : '';

  const [ssid, setSsid]           = useState(comun);
  const [clave, setClave]         = useState('');
  const [verClave, setVerClave]   = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [resultado, setResultado] = useState<ResultadoWifi | null>(null);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => { setSsid(comun); }, [comun]);

  const cambioSsid  = ssid.trim() !== comun.trim() && ssid.trim() !== '';
  const cambioClave = clave.length > 0;
  const hayCambios  = cambioSsid || cambioClave;

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: () =>
      portalApi.onuGuardarWifiAmbas(contratoId, {
        ssid: cambioSsid ? ssid.trim() : undefined,
        password: cambioClave ? clave : undefined,
      }),
    onSuccess: (res) => {
      setResultado(res); setError(null); setClave(''); setConfirmar(false);
      queryClient.invalidateQueries({ queryKey: ['portal-wifi', contratoId] });
    },
    onError: (e) => {
      setError(e instanceof PortalError ? e.message : 'No pudimos aplicar el cambio.');
      setConfirmar(false);
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Wifi className="w-4 h-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Mi red WiFi</p>
        <span className="ml-auto text-xs text-muted-foreground">2.4 y 5 GHz</span>
      </div>

      <div className="p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Nombre de la red (SSID)</label>
          <input
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            disabled={!editable || isPending}
            maxLength={32}
            className={campo()}
            placeholder="MiRedWiFi"
          />
          {!comun && bandas.length === 2 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Ahora tus dos redes tienen nombres distintos. Al guardar quedarán con el mismo.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Contraseña</label>
          <div className="relative">
            <input
              type={verClave ? 'text' : 'password'}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              disabled={!editable || isPending}
              maxLength={63}
              className={cn(campo(), 'pr-11')}
              placeholder="Déjala vacía para no cambiarla"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
              aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {verClave ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
        </div>

        {error && (
          <p className="text-sm text-destructive flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        {resultado && (
          <p className={cn(
            'text-sm flex items-start gap-1.5',
            resultado.clase === 'confirmado'
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-amber-700 dark:text-amber-400',
          )}>
            {resultado.clase === 'confirmado'
              ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              : <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />}
            {resultado.mensaje}
          </p>
        )}

        {confirmar ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Se desconectarán todos los dispositivos conectados a tu WiFi
              {ubicacion ? <> de <strong>{ubicacion}</strong></> : null}. Tendrás que volver
              a conectarlos con los datos nuevos.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => guardar()}
                disabled={isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Sí, aplicar cambios
              </button>
              <button
                type="button"
                onClick={() => setConfirmar(false)}
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-foreground hover:opacity-90"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setResultado(null); setError(null); setConfirmar(true); }}
            disabled={!editable || !hayCambios || isPending}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-primary text-primary-foreground hover:opacity-90 transition-opacity',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            Guardar cambios
          </button>
        )}
      </div>
    </div>
  );
}

function TarjetaBanda({
  contratoId, banda, editable, ubicacion,
}: {
  contratoId: string;
  banda: PortalBandaWifi;
  editable: boolean;
  /** Dirección del servicio: solo con más de uno, para nombrarlo al confirmar. */
  ubicacion: string | null;
}) {
  const queryClient = useQueryClient();
  const [ssid, setSsid]         = useState(banda.ssid ?? '');
  const [clave, setClave]       = useState('');
  const [verClave, setVerClave] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [resultado, setResultado] = useState<ResultadoWifi | null>(null);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => { setSsid(banda.ssid ?? ''); }, [banda.ssid]);

  const cambioSsid  = ssid.trim() !== (banda.ssid ?? '').trim() && ssid.trim() !== '';
  const cambioClave = clave.length > 0;
  const hayCambios  = cambioSsid || cambioClave;

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: () =>
      portalApi.onuGuardarWifi(contratoId, banda.banda, {
        ssid: cambioSsid ? ssid.trim() : undefined,
        password: cambioClave ? clave : undefined,
      }),
    onSuccess: (res) => {
      setResultado(res);
      setError(null);
      setClave('');
      setConfirmar(false);
      queryClient.invalidateQueries({ queryKey: ['portal-wifi', contratoId] });
    },
    onError: (e) => {
      setError(e instanceof PortalError ? e.message : 'No pudimos aplicar el cambio.');
      setConfirmar(false);
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Wifi className="w-4 h-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Red {banda.banda} GHz</p>
        {banda.activa === false && (
          <span className="ml-auto text-xs text-muted-foreground">Desactivada</span>
        )}
      </div>

      <div className="p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Nombre de la red (SSID)</label>
          <input
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            disabled={!editable || isPending}
            maxLength={32}
            className={campo()}
            placeholder="MiRedWiFi"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Contraseña</label>
          <div className="relative">
            <input
              type={verClave ? 'text' : 'password'}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              disabled={!editable || isPending}
              maxLength={63}
              className={cn(campo(), 'pr-11')}
              // La clave actual NUNCA se precarga: el equipo no la devuelve (es de solo
              // escritura) y mostrar un valor falso invitaría a "guardar" lo que no es.
              placeholder="Déjala vacía para no cambiarla"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
              aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {verClave ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
        </div>

        {error && (
          <p className="text-sm text-destructive flex items-start gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        {resultado && (
          <p
            className={cn(
              'text-sm flex items-start gap-1.5',
              resultado.clase === 'confirmado'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400',
            )}
          >
            {resultado.clase === 'confirmado'
              ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              : <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />}
            {resultado.mensaje}
          </p>
        )}

        {/* Confirmación explícita: guardar desconecta TODOS los equipos del abonado.
            Enterarse después es una llamada a soporte garantizada. */}
        {confirmar ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Se desconectarán todos los dispositivos conectados a la red {banda.banda} GHz
              {ubicacion ? <> de <strong>{ubicacion}</strong></> : null}. Tendrás que
              volver a conectarlos con los datos nuevos.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => guardar()}
                disabled={isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Sí, aplicar cambios
              </button>
              <button
                type="button"
                onClick={() => setConfirmar(false)}
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-foreground hover:opacity-90"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setResultado(null); setError(null); setConfirmar(true); }}
            disabled={!editable || !hayCambios || isPending}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-primary text-primary-foreground hover:opacity-90 transition-opacity',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            Guardar cambios
          </button>
        )}
      </div>
    </div>
  );
}

function Aviso({
  icono: Icono, titulo, mensaje, onReintentar,
  textoReintentar = 'Reintentar', reintentando = false,
}: {
  icono: typeof Wifi;
  titulo: string;
  mensaje: string;
  onReintentar?: () => void;
  textoReintentar?: string;
  reintentando?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
      <Icono className="w-8 h-8 text-amber-500 mx-auto" />
      <p className="text-base font-semibold text-foreground">{titulo}</p>
      <p className="text-sm text-muted-foreground">{mensaje}</p>
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          disabled={reintentando}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {reintentando && <Loader2 className="w-4 h-4 animate-spin" />}
          {textoReintentar}
        </button>
      )}
    </div>
  );
}

function campo() {
  return cn(
    'w-full px-3 py-2.5 text-sm rounded-lg border border-input bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    'disabled:opacity-60 disabled:cursor-not-allowed',
  );
}
