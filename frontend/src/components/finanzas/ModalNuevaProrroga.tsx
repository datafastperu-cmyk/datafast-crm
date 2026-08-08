'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CalendarDays, AlertCircle } from 'lucide-react';

import { contratosApi } from '@/lib/api/contratos';
import { promesasApi }  from '@/lib/api/promesas';
import { pagosApi }     from '@/lib/api/facturacion';
import type { Cliente } from '@/types';
import { useToast } from '@/components/ui/toaster';
import { cn, formatPEN, parseApiError } from '@/lib/utils';
import { BuscadorCliente } from './BuscadorCliente';

/**
 * Alta de una prórroga (promesa de pago).
 *
 * Se concede sobre un CONTRATO, no sobre el cliente: un abonado con dos servicios puede
 * necesitar prórroga en uno y no en el otro. Por eso, tras elegir cliente hay que elegir
 * cuál de sus servicios.
 *
 * A diferencia del adelanto, aquí NO hay dinero: es un compromiso de pago que retrasa el
 * corte. Tiene sentido justamente cuando el abonado DEBE — sin deuda no hay nada que
 * prorrogar.
 */
// Debe coincidir con `estadosPermitidos` de `promesas-pago.service`. `'moroso'` salió el
// 2026-08-08: la mora es una etiqueta derivada, no un estado del contrato.
const ESTADOS_PRORROGABLES = ['activo', 'cortado', 'suspendido'];

export function ModalNuevaProrroga({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [cliente, setCliente]       = useState<Cliente | null>(null);
  const [contratoId, setContratoId] = useState('');
  const [hasta, setHasta]           = useState('');
  const [motivo, setMotivo]         = useState('');

  const { data: contratosResp, isLoading: cargandoContratos } = useQuery({
    queryKey: ['contratos-cliente-prorroga', cliente?.id],
    queryFn:  () => contratosApi.list({ clienteId: cliente!.id, limit: 20 }),
    enabled:  !!cliente,
  });

  const { data: saldo } = useQuery({
    queryKey: ['saldo-favor', cliente?.id],
    queryFn:  () => pagosApi.saldoAFavor(cliente!.id),
    enabled:  !!cliente,
  });

  const contratos = (contratosResp?.data ?? []).filter(c =>
    ESTADOS_PRORROGABLES.includes(c.estado),
  );

  // Con un solo servicio no se le pide al operador que elija lo único que hay.
  useEffect(() => {
    if (contratos.length === 1) setContratoId(contratos[0].id);
    else setContratoId('');
  }, [contratosResp]); // eslint-disable-line

  const crear = useMutation({
    mutationFn: () => promesasApi.crear({
      contratoId,
      fechaVencimiento: hasta,
      motivo: motivo.trim() || 'Promesa de pago',
    }),
    onSuccess: () => {
      toast('Prórroga concedida', {
        type: 'success',
        description: `${cliente?.nombreCompleto} · hasta ${hasta}`,
      });
      void qc.invalidateQueries({ queryKey: ['promesas-lista'] });
      void qc.invalidateQueries({ queryKey: ['promesas-stats'] });
      onClose();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const sinDeuda = !!saldo && saldo.deudaPendiente <= 0;
  const puedeGuardar = !!cliente && !!contratoId && !!hasta && hasta > hoy;

  const input = 'w-full rounded border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Nueva prórroga</h3>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Cliente *</label>
            <BuscadorCliente
              autoFocus
              seleccionado={cliente}
              onSelect={setCliente}
              onLimpiar={() => { setCliente(null); setContratoId(''); }}
            />
          </div>

          {cliente && saldo && (
            <div className={cn(
              'rounded-lg border p-3 text-xs',
              sinDeuda
                ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                : 'border-border bg-muted/40 text-muted-foreground',
            )}>
              {sinDeuda ? (
                <>
                  Este cliente <strong>no tiene deuda pendiente</strong>. Una prórroga
                  retrasa el corte por mora: sin deuda no hay nada que prorrogar.
                </>
              ) : (
                <>Deuda pendiente: <strong>{formatPEN(saldo.deudaPendiente)}</strong></>
              )}
            </div>
          )}

          {cliente && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Servicio *</label>
              {cargandoContratos ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando servicios…
                </p>
              ) : !contratos.length ? (
                <p className="text-xs text-destructive py-2">
                  Este cliente no tiene servicios en un estado al que se pueda conceder
                  prórroga.
                </p>
              ) : (
                <select
                  value={contratoId}
                  onChange={e => setContratoId(e.target.value)}
                  className={input}
                >
                  <option value="">— Elige el servicio —</option>
                  {contratos.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.numeroContrato} · {c.estado.toUpperCase()}
                      {c.ipAsignada ? ` · ${c.ipAsignada}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Prorrogar hasta *
            </label>
            <input
              type="date" min={hoy} value={hasta}
              onChange={e => setHasta(e.target.value)}
              className={input} disabled={!contratoId}
            />
            {hasta && hasta <= hoy && (
              <p className="text-xs text-destructive mt-1">
                La fecha debe ser posterior a hoy.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Motivo</label>
            <textarea
              rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Compromiso acordado con el abonado"
              className={input} disabled={!contratoId}
            />
          </div>

          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            Mientras la prórroga esté vigente, el corte automático por mora no se aplica a
            ese servicio.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-input hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!puedeGuardar || crear.isPending}
            onClick={() => crear.mutate()}
            className="px-3 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {crear.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Conceder prórroga
          </button>
        </div>
      </div>
    </div>
  );
}
