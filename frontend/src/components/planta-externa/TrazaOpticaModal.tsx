'use client';

import { useQuery } from '@tanstack/react-query';
import {
  X, Loader2, AlertCircle, Activity, CheckCircle2, AlertTriangle, HelpCircle,
  Home, Box, Split, Cable, GitMerge, Server,
} from 'lucide-react';

import { plantaExternaApi, type PasoTraza } from '@/lib/api/planta-externa';
import { Portal } from '@/components/ui/portal';
import { parseApiError, cn } from '@/lib/utils';

const ICONO: Record<PasoTraza['tipo'], typeof Home> = {
  acometida: Home,
  nap:       Box,
  splitter:  Split,
  fibra:     Cable,
  mufa:      GitMerge,
  fusion:    GitMerge,
  site:      Server,
};

interface Props {
  contratoId: string;
  titulo?: string;
  onClose: () => void;
}

/**
 * Camino óptico del abonado hasta la cabecera, con su presupuesto de pérdidas.
 *
 * Responde dos preguntas que antes exigían subir a un poste: por dónde pasa el servicio de
 * este cliente, y si la señal que recibe se explica por la planta documentada.
 */
export function TrazaOpticaModal({ contratoId, titulo, onClose }: Props) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['traza-optica', contratoId],
    queryFn:  () => plantaExternaApi.trazaContrato(contratoId),
  });

  const veredicto = data?.completa ? data.veredicto : null;

  const estiloVeredicto = {
    coherente:    { color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', Icono: CheckCircle2 },
    anomalia:     { color: 'text-destructive bg-destructive/10 border-destructive/20', Icono: AlertTriangle },
    sin_medicion: { color: 'text-muted-foreground bg-muted border-border',             Icono: HelpCircle },
  }[veredicto?.clase ?? 'sin_medicion'];

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
        onClick={onClose}>
        <div role="dialog" aria-modal="true"
          className="w-full max-w-lg my-8 bg-card border border-border rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}>

          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Traza óptica</h3>
                <p className="text-[11px] text-muted-foreground">{titulo ?? 'Camino hasta la cabecera'}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {isError && (
            <div className="m-5 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{parseApiError(error)}</p>
            </div>
          )}

          {data && (
            <div className="p-5 space-y-4">

              {/* Veredicto primero: es lo que el operador vino a saber. */}
              {data.completa && veredicto && (
                <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5', estiloVeredicto.color)}>
                  <estiloVeredicto.Icono className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{veredicto.mensaje}</p>
                    <p className="text-[11px] opacity-80 mt-0.5">
                      Esperado {data.presupuesto.potenciaEsperadaDbm} dBm
                      {veredicto.desviacionDb != null && ` · desviación ${veredicto.desviacionDb > 0 ? '+' : ''}${veredicto.desviacionDb} dB`}
                    </p>
                  </div>
                </div>
              )}

              {/* Una traza rota dice DÓNDE se rompe: ese motivo es el trabajo de campo
                  pendiente, no un fallo del sistema. Por eso se muestra en ámbar y no en
                  rojo, y acompañado de los pasos que sí se pudieron recorrer. */}
              {!data.completa && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      Traza incompleta
                    </p>
                    <p className="text-[11px] text-amber-600/90 dark:text-amber-400/90 mt-0.5">
                      {data.motivo}
                    </p>
                  </div>
                </div>
              )}

              {/* Camino recorrido */}
              <section>
                <h4 className="text-xs font-semibold text-foreground mb-2">
                  Camino {data.completa ? 'completo' : 'recorrido'}
                </h4>
                <ol className="space-y-1.5">
                  {data.pasos.map((p, i) => {
                    const Icono = ICONO[p.tipo];
                    return (
                      <li key={i} className="flex items-center gap-2.5 text-[11px]">
                        <span className="w-6 h-6 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <Icono className="w-3 h-3 text-muted-foreground" />
                        </span>
                        <span className="text-foreground min-w-0 truncate">{p.descripcion}</span>
                        {p.perdidaDb != null && (
                          <span className="ml-auto text-muted-foreground shrink-0">
                            −{p.perdidaDb.toFixed(2)} dB
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>

              {/* Presupuesto */}
              {data.completa && (
                <section className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Pérdida total</span>
                    <span className="font-semibold text-foreground">
                      {data.presupuesto.perdidaTotalDb.toFixed(2)} dB
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Margen restante</span>
                    <span className={cn(
                      'font-semibold',
                      data.presupuesto.dentroDePresupuesto ? 'text-emerald-500' : 'text-destructive',
                    )}>
                      {data.presupuesto.margenRestanteDb.toFixed(2)} dB
                    </span>
                  </div>
                  {/* Un enlace fuera de presupuesto funciona hoy y falla con la primera
                      reparación o con el envejecimiento de la fibra. Decirlo ahora evita
                      un cliente intermitente dentro de dos años. */}
                  {!data.presupuesto.dentroDePresupuesto && (
                    <p className="text-[11px] text-destructive pt-1 border-t border-border">
                      El enlace excede el presupuesto óptico: puede funcionar hoy y degradarse
                      con el envejecimiento de la fibra o un empalme de reparación.
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
