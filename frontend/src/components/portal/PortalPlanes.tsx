'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check, Loader2, AlertTriangle, Clock, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

import { portalApi, PortalError, type PortalPlan } from '@/lib/api/portal';
import { useServicioActual } from './useServicioActual';
import { cn } from '@/lib/utils';

const soles = (n: number) =>
  `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PortalPlanes() {
  const { servicio } = useServicioActual();
  const contratoId = servicio?.contratoId;

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-planes', contratoId],
    queryFn:  () => portalApi.planes(contratoId!),
    enabled:  Boolean(contratoId),
  });

  const [elegido, setElegido] = useState<PortalPlan | null>(null);

  if (isLoading || !servicio) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <p className="text-sm text-foreground">
          {error instanceof PortalError ? error.message : 'No pudimos cargar los planes.'}
        </p>
      </div>
    );
  }

  const pendiente = data?.solicitudPendiente;
  const precioActual = servicio.precioMensual;

  return (
    <div className="space-y-4">
      {pendiente && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-1">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Tienes una solicitud en curso
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Pediste cambiar de {pendiente.planOrigen} a {pendiente.planDestino}.
            Te contactaremos para confirmarla.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {(data?.planes ?? []).map((plan) => {
          const esSubida = plan.precio > precioActual;
          return (
            <li
              key={plan.id}
              className={cn(
                'rounded-xl border bg-card p-5 space-y-3',
                plan.esActual ? 'border-primary' : 'border-border',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-foreground">{plan.nombre}</p>
                  <p className="text-sm text-muted-foreground">
                    {plan.velocidadBajada} Mbps de bajada · {plan.velocidadSubida} Mbps de subida
                  </p>
                </div>
                {plan.esActual && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-medium flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                    Tu plan
                  </span>
                )}
              </div>

              {plan.descripcion && (
                <p className="text-sm text-muted-foreground">{plan.descripcion}</p>
              )}

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                <span className="text-lg font-bold text-foreground">
                  {soles(plan.precio)}
                  <span className="text-xs font-normal text-muted-foreground"> / mes</span>
                </span>

                {!plan.esActual && (
                  plan.bloqueo ? (
                    // El motivo se muestra en lugar del botón: un botón deshabilitado sin
                    // explicación es una llamada a soporte garantizada.
                    <span className="text-xs text-muted-foreground text-right max-w-[55%]">
                      {plan.bloqueo}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setElegido(plan)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium',
                        'bg-primary text-primary-foreground hover:opacity-90 transition-opacity',
                      )}
                    >
                      {esSubida
                        ? <ArrowUpRight className="w-4 h-4" />
                        : <ArrowDownRight className="w-4 h-4" />}
                      Solicitar
                    </button>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {(data?.planes.length ?? 0) === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No hay planes disponibles para mostrar en este momento.
          </p>
        </div>
      )}

      {elegido && contratoId && (
        <ModalSolicitud
          contratoId={contratoId}
          plan={elegido}
          precioActual={precioActual}
          onCerrar={() => setElegido(null)}
        />
      )}
    </div>
  );
}

function ModalSolicitud({
  contratoId, plan, precioActual, onCerrar,
}: {
  contratoId: string;
  plan: PortalPlan;
  precioActual: number;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const [nota, setNota]   = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const { mutate: solicitar, isPending } = useMutation({
    mutationFn: () => portalApi.solicitarPlan(contratoId, plan.id, nota.trim() || undefined),
    onSuccess: () => {
      setListo(true);
      queryClient.invalidateQueries({ queryKey: ['portal-planes', contratoId] });
    },
    onError: (e) =>
      setError(e instanceof PortalError ? e.message : 'No pudimos registrar tu solicitud.'),
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
      onClick={onCerrar}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Solicitar cambio de plan"
      >
        {listo ? (
          <>
            <p className="text-lg font-semibold text-foreground">Solicitud registrada</p>
            <p className="text-sm text-muted-foreground">
              Te contactaremos para confirmar el cambio a {plan.nombre}. Tu servicio sigue
              funcionando igual hasta entonces.
            </p>
            <button
              type="button"
              onClick={onCerrar}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
            >
              Entendido
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="text-lg font-semibold text-foreground">Cambiar a {plan.nombre}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {plan.velocidadBajada} Mbps de bajada
              </p>
            </div>

            {/* Se dice exactamente qué implica: cuánto pasará a pagar y que NO es
                inmediato. Es una solicitud, no un cambio: prometer lo contrario genera
                el reclamo del día siguiente. */}
            <div className="rounded-lg bg-muted/60 p-3 space-y-1.5 text-sm">
              <p className="text-foreground">
                Pagas hoy: <span className="font-semibold">{soles(precioActual)}</span>
              </p>
              <p className="text-foreground">
                Pasarías a pagar: <span className="font-semibold">{soles(plan.precio)}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                El cambio se aplica desde tu siguiente ciclo de facturación y requiere que
                lo confirmemos. Esta solicitud no modifica tu servicio todavía.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                ¿Quieres agregar algo? (opcional)
              </label>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                className={cn(
                  'w-full px-3 py-2.5 text-sm rounded-lg border border-input bg-background',
                  'min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-primary',
                )}
                placeholder="Ej.: prefiero que el cambio sea a fin de mes."
              />
            </div>

            {error && (
              <p className="text-sm text-destructive flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => solicitar()}
                disabled={isPending}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Enviar solicitud
              </button>
              <button
                type="button"
                onClick={onCerrar}
                disabled={isPending}
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-muted text-foreground hover:opacity-90"
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
