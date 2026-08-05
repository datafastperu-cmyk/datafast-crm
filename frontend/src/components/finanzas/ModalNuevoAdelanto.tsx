'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wallet, AlertCircle } from 'lucide-react';

import { pagosApi, METODOS_PAGO, REQUIERE_NUM_OPERACION } from '@/lib/api/facturacion';
import type { Cliente } from '@/types';
import { useToast } from '@/components/ui/toaster';
import { cn, formatPEN, parseApiError } from '@/lib/utils';
import { BuscadorCliente } from './BuscadorCliente';

/**
 * Alta de un adelanto.
 *
 * Un adelanto es dinero de UN abonado concreto, así que lo primero es elegirlo. Con el
 * cliente seleccionado se consulta su situación: si tiene deuda, no se admite adelanto
 * —entregar dinero con comprobantes impagos es pagar, no adelantar— y el formulario lo
 * dice antes de que el cajero teclee nada.
 */
export function ModalNuevoAdelanto({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [cliente, setCliente]   = useState<Cliente | null>(null);
  const [monto, setMonto]       = useState('');
  const [metodo, setMetodo]     = useState('efectivo');
  const [numOp, setNumOp]       = useState('');
  const [fecha, setFecha]       = useState(new Date().toISOString().slice(0, 10));
  const [notas, setNotas]       = useState('');

  // La regla de "no hay adelanto con deuda" la resuelve el backend y viaja resuelta:
  // recalcularla aquí sería tener dos criterios que pueden separarse.
  const { data: saldo, isLoading: cargandoSaldo } = useQuery({
    queryKey: ['saldo-favor', cliente?.id],
    queryFn:  () => pagosApi.saldoAFavor(cliente!.id),
    enabled:  !!cliente,
  });

  const registrar = useMutation({
    mutationFn: () => pagosApi.registrar({
      clienteId:  cliente!.id,
      esAdelanto: true,
      monto:      parseFloat(monto) || 0,
      metodoPago: metodo,
      numeroOperacion: numOp.trim() || undefined,
      fechaPago:  fecha,
      notas:      notas.trim() || undefined,
      // El adelanto se cobra en mano: entra verificado si el cajero tiene permiso, igual
      // que un pago presencial.
      autoVerificar: true,
    }),
    onSuccess: () => {
      toast('Adelanto registrado', {
        type: 'success',
        description: `${formatPEN(parseFloat(monto) || 0)} · ${cliente?.nombreCompleto}`,
      });
      void qc.invalidateQueries({ queryKey: ['adelantos'] });
      void qc.invalidateQueries({ queryKey: ['saldo-favor'] });
      onClose();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const requiereNumOp = REQUIERE_NUM_OPERACION.has(metodo as never);
  const conDeuda      = (saldo?.deudaPendiente ?? 0) > 0;
  const puedeGuardar  =
    !!cliente && !conDeuda && !cargandoSaldo
    && parseFloat(monto) > 0
    && (!requiereNumOp || !!numOp.trim());

  const input = 'w-full rounded border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
          <Wallet className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Nuevo adelanto</h3>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Cliente *</label>
            <BuscadorCliente
              autoFocus
              seleccionado={cliente}
              onSelect={setCliente}
              onLimpiar={() => setCliente(null)}
            />
          </div>

          {cliente && cargandoSaldo && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando su situación…
            </p>
          )}

          {cliente && !cargandoSaldo && (
            <div className={cn(
              'rounded-lg border p-3 text-xs',
              conDeuda
                ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                : 'border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
            )}>
              {conDeuda ? (
                <>
                  <strong>No se puede adelantar.</strong> Debe {formatPEN(saldo!.deudaPendiente)}.
                  Registra primero el pago de sus comprobantes: entregar dinero con
                  comprobantes impagos no es un adelanto.
                </>
              ) : (
                <>
                  Sin deuda pendiente. Saldo a favor actual:{' '}
                  <strong>{formatPEN(saldo?.disponible ?? 0)}</strong>. El importe se
                  aplicará solo al emitir su siguiente comprobante.
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Monto (S/) *</label>
              <input
                type="number" step="0.01" min="0.01"
                value={monto} onChange={e => setMonto(e.target.value)}
                placeholder="0.00" className={input} disabled={!cliente || conDeuda}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Fecha *</label>
              <input
                type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                className={input} disabled={!cliente || conDeuda}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Método *</label>
              <select
                value={metodo} onChange={e => setMetodo(e.target.value)}
                className={input} disabled={!cliente || conDeuda}
              >
                {METODOS_PAGO.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                N° operación {requiereNumOp && '*'}
              </label>
              <input
                value={numOp} onChange={e => setNumOp(e.target.value)}
                placeholder={requiereNumOp ? 'Obligatorio' : 'Opcional'}
                className={input} disabled={!cliente || conDeuda}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Notas</label>
            <textarea
              rows={2} value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Referencia del adelanto"
              className={input} disabled={!cliente || conDeuda}
            />
          </div>

          {requiereNumOp && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              El número de operación no puede repetirse: ya se usó en otro cobro, el sistema
              lo rechaza.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-input hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            disabled={!puedeGuardar || registrar.isPending}
            onClick={() => registrar.mutate()}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {registrar.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Registrar adelanto
          </button>
        </div>
      </div>
    </div>
  );
}
