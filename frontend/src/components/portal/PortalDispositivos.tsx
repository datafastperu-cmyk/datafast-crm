'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Smartphone, Laptop, Tv, Cable, Wifi, AlertTriangle, HelpCircle,
} from 'lucide-react';

import { portalApi, PortalError, type PortalDispositivo } from '@/lib/api/portal';
import { useServicioActual } from './useServicioActual';
import { cn } from '@/lib/utils';

// Tipo de dispositivo inferido del nombre que el propio equipo anuncia en la red. Es una
// pista, no un dato del router: por eso el ícono acompaña y el nombre real manda.
function iconoDe(nombre: string) {
  const n = nombre.toLowerCase();
  if (/(iphone|android|galaxy|redmi|moto|phone|celular)/.test(n)) return Smartphone;
  if (/(macbook|laptop|pc|desktop|windows|thinkpad)/.test(n))     return Laptop;
  if (/(tv|roku|chromecast|firestick|smart-?tv)/.test(n))         return Tv;
  return HelpCircle;
}

const CONEXION: Record<PortalDispositivo['conexion'], { label: string; icono: typeof Wifi }> = {
  '2.4': { label: 'WiFi 2.4 GHz', icono: Wifi },
  '5':   { label: 'WiFi 5 GHz',   icono: Wifi },
  wifi:  { label: 'WiFi',         icono: Wifi },
  lan:   { label: 'Cable',        icono: Cable },
};

export function PortalDispositivos() {
  const { servicio } = useServicioActual();
  const contratoId = servicio?.contratoId;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['portal-dispositivos', contratoId],
    queryFn:  () => portalApi.onuDispositivos(contratoId!),
    enabled:  Boolean(contratoId),
    refetchOnWindowFocus: false,
  });

  if (isLoading || !servicio) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <p className="text-sm text-foreground">
          {error instanceof PortalError
            ? error.message
            : 'No pudimos leer los dispositivos conectados.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const dispositivos = data ?? [];
  const activos = dispositivos.filter((d) => d.activo);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Dispositivos conectados
        </p>
        <p className="mt-2 text-3xl font-bold text-foreground">{activos.length}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {dispositivos.length > activos.length
            ? `${dispositivos.length - activos.length} más se conectaron recientemente`
            : 'Equipos conectados a tu red ahora'}
        </p>
      </div>

      {dispositivos.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Tu router aún no reporta dispositivos conectados.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {dispositivos.map((d, i) => {
            const Icono = iconoDe(d.nombre);
            const conexion = CONEXION[d.conexion];
            const IconoConexion = conexion.icono;
            return (
              <li
                key={`${d.mac ?? d.ip ?? d.nombre}-${i}`}
                className={cn(
                  'rounded-xl border border-border bg-card p-4 flex items-center gap-3',
                  !d.activo && 'opacity-60',
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                  <Icono className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{d.nombre}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {d.ip ?? 'Sin IP'}
                    {d.mac && ` · ${d.mac}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <IconoConexion className="w-3.5 h-3.5" />
                    {conexion.label}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      d.activo
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-muted-foreground',
                    )}
                  >
                    {d.activo ? 'Conectado' : 'Desconectado'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Solo lectura, a propósito: bloquear un dispositivo por error es un corte que el
          abonado no sabe deshacer y que soporte no puede rastrear. */}
      <p className="text-xs text-muted-foreground px-1">
        Esta lista es informativa. Si ves un equipo que no reconoces, cambia la contraseña
        de tu WiFi desde Mi WiFi.
      </p>
    </div>
  );
}
