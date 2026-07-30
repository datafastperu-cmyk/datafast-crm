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

export function PortalWifi() {
  const queryClient = useQueryClient();
  const { servicio } = useServicioActual();
  const contratoId = servicio?.contratoId;

  const { data: estado, isLoading } = useQuery({
    queryKey: ['portal-onu-estado', contratoId],
    queryFn:  () => portalApi.onuEstado(contratoId!),
    enabled:  Boolean(contratoId),
    // Solo se repregunta mientras hay algo en curso. Un poll permanente contra el ACS
    // multiplicado por todos los abonados es carga que nadie necesita.
    refetchInterval: (q) => (q.state.data?.carril === 'conectando' ? POLL_MS : false),
  });

  const conectado = estado?.carril === 'conectado';

  // El latido solo tiene sentido con el carril arriba.
  useEffect(() => {
    if (!contratoId || !conectado) return undefined;
    portalApi.onuHeartbeat(contratoId);
    const id = setInterval(() => portalApi.onuHeartbeat(contratoId), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [contratoId, conectado]);

  const { mutate: conectar, isPending: conectando } = useMutation({
    mutationFn: () => portalApi.onuConectar(contratoId!),
    onSuccess: (res) => queryClient.setQueryData(['portal-onu-estado', contratoId], res),
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
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-4">
        <Router className="w-10 h-10 text-primary mx-auto" />
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">Conecta tu router</p>
          <p className="text-sm text-muted-foreground">{estado.mensaje}</p>
        </div>

        {estado.carril === 'conectando' ? (
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Conectando… puede tomar unos minutos
          </div>
        ) : (
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
            Conectar router
          </button>
        )}
      </div>
    );
  }

  return <BandasWifi contratoId={contratoId!} />;
}

function BandasWifi({ contratoId }: { contratoId: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['portal-wifi', contratoId],
    queryFn:  () => portalApi.onuWifi(contratoId),
    refetchOnWindowFocus: false,
  });

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
      {/* La hora de la lectura va SIEMPRE a la vista: es lo que le dice al abonado si lo
          que ve es de ahora o de hace un rato. */}
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          {data.ultimaLectura
            ? `Datos de ${new Date(data.ultimaLectura).toLocaleString('es-PE')}`
            : 'Sin lectura previa del equipo'}
        </p>
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

      {!data.editable && data.motivoNoEditable && (
        <Aviso icono={AlertTriangle} titulo="Solo lectura" mensaje={data.motivoNoEditable} />
      )}

      {data.bandas.map((banda) => (
        <TarjetaBanda
          key={banda.banda}
          contratoId={contratoId}
          banda={banda}
          editable={data.editable}
        />
      ))}

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

function TarjetaBanda({
  contratoId, banda, editable,
}: {
  contratoId: string;
  banda: PortalBandaWifi;
  editable: boolean;
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
              Se desconectarán todos los dispositivos conectados a esta red. Tendrás que
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
}: {
  icono: typeof Wifi;
  titulo: string;
  mensaje: string;
  onReintentar?: () => void;
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
        >
          Reintentar
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
