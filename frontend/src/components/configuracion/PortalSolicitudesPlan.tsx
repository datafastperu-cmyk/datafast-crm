'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowRight, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { portalConfigApi, type SolicitudPlan } from '@/lib/api/portal-config';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

const soles = (v: string | number) =>
  `S/ ${Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ESTADO: Record<string, string> = {
  pendiente: 'text-amber-700 bg-amber-500/10 border-amber-500/30',
  aprobada:  'text-sky-700 bg-sky-500/10 border-sky-500/30',
  aplicada:  'text-emerald-700 bg-emerald-500/10 border-emerald-500/30',
  rechazada: 'text-red-700 bg-red-500/10 border-red-500/30',
  cancelada: 'text-muted-foreground bg-muted border-border',
};

export function PortalSolicitudesPlan() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [filtro, setFiltro] = useState<string>('pendiente');

  const { data, isLoading } = useQuery({
    queryKey: ['portal-solicitudes-plan', filtro],
    queryFn:  () => portalConfigApi.listarSolicitudesPlan(filtro || undefined),
  });

  const { mutate: resolver, isPending } = useMutation({
    mutationFn: (v: { id: string; decision: 'aprobada' | 'rechazada' | 'aplicada'; motivo?: string }) =>
      portalConfigApi.resolverSolicitudPlan(v.id, { decision: v.decision, motivo: v.motivo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-solicitudes-plan'] });
      toast('Solicitud actualizada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="space-y-4">
      {/* Aprobar registra el veredicto; NO cambia el plan. El cambio se ejecuta por el
          flujo de negocio (Contratos), que es quien toca la queue del MikroTik, el precio
          y el prorrateo. Decirlo aquí evita que alguien asuma que ya está aplicado. */}
      <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-sky-700 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-sky-900 dark:text-sky-300">
          Aprobar <strong>no aplica</strong> el cambio de plan: registra tu decisión. El
          cambio se ejecuta desde el contrato, por el flujo normal. Cuando lo hayas hecho,
          marca la solicitud como <strong>aplicada</strong>.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          { id: 'pendiente', label: 'Pendientes' },
          { id: 'aprobada',  label: 'Aprobadas' },
          { id: '',          label: 'Todas' },
        ].map((f) => (
          <button
            key={f.id || 'todas'}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors',
              filtro === f.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
      ) : !data?.length ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No hay solicitudes en esta vista.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((s) => (
            <Fila key={s.id} solicitud={s} onResolver={resolver} deshabilitado={isPending} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Fila({
  solicitud: s, onResolver, deshabilitado,
}: {
  solicitud: SolicitudPlan;
  onResolver: (v: { id: string; decision: 'aprobada' | 'rechazada' | 'aplicada'; motivo?: string }) => void;
  deshabilitado: boolean;
}) {
  const [motivo, setMotivo] = useState('');
  const deuda = Number(s.deudaTotal);

  return (
    <li className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{s.clienteNombre}</p>
          <p className="text-xs text-muted-foreground">
            Contrato {s.numeroContrato}
            {s.clienteWhatsapp && ` · ${s.clienteWhatsapp}`}
            {` · ${s.tipoPago ?? 'postpago'}`}
          </p>
        </div>
        <span className={cn('px-2 py-1 rounded-lg border text-xs font-medium flex-shrink-0', ESTADO[s.estado])}>
          {s.estado}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-foreground">{s.planOrigen}</span>
        <span className="text-xs text-muted-foreground">{soles(s.precio_origen)}</span>
        <ArrowRight className="w-4 h-4 text-muted-foreground" />
        <span className="text-foreground font-medium">{s.planDestino}</span>
        <span className="text-xs text-muted-foreground">{soles(s.precio_destino)}</span>
      </div>

      {/* La deuda se muestra siempre: es el dato que condiciona la decisión y el que el
          operador tendría que ir a buscar a otra pantalla. */}
      {deuda > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Deuda vigente: {soles(deuda)}
        </p>
      )}

      {s.nota_cliente && (
        <p className="text-sm text-muted-foreground bg-muted/60 rounded-lg p-2.5">
          “{s.nota_cliente}”
        </p>
      )}

      {s.motivo_resolucion && (
        <p className="text-xs text-muted-foreground">Resolución: {s.motivo_resolucion}</p>
      )}

      {(s.estado === 'pendiente' || s.estado === 'aprobada') && (
        <div className="space-y-2 pt-2 border-t border-border">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo o nota (opcional)"
            className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex flex-wrap gap-2">
            {s.estado === 'pendiente' && (
              <>
                <button
                  type="button"
                  disabled={deshabilitado}
                  onClick={() => onResolver({ id: s.id, decision: 'aprobada', motivo: motivo || undefined })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {deshabilitado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Aprobar
                </button>
                <button
                  type="button"
                  disabled={deshabilitado}
                  onClick={() => onResolver({ id: s.id, decision: 'rechazada', motivo: motivo || undefined })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Rechazar
                </button>
              </>
            )}
            {s.estado === 'aprobada' && (
              <button
                type="button"
                disabled={deshabilitado}
                onClick={() => onResolver({ id: s.id, decision: 'aplicada', motivo: motivo || undefined })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Ya lo apliqué en el contrato
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
