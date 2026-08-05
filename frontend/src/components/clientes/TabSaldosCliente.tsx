'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Wallet } from 'lucide-react';

import { pagosApi } from '@/lib/api/facturacion';
import { cn, formatPEN } from '@/lib/utils';

/**
 * Saldos del abonado: adelantos entregados y qué queda de ellos.
 *
 * El saldo a favor se DERIVA de los pagos y sus imputaciones, así que lo que se ve aquí no
 * puede contradecir a la caja ni a los comprobantes: no hay contador que mantener.
 */
const SITUACION_BADGE: Record<string, string> = {
  disponible: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  parcial:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  efectuado:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  devuelto:   'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};
const SITUACION_LABEL: Record<string, string> = {
  disponible: 'DISPONIBLE',
  parcial:    'APLICADO EN PARTE',
  efectuado:  'FACTURADO',
  devuelto:   'DEVUELTO',
};

export function TabSaldosCliente({ clienteId }: { clienteId: string }) {
  const { data: saldo, isLoading: loadingSaldo } = useQuery({
    queryKey: ['saldo-favor', clienteId],
    queryFn:  () => pagosApi.saldoAFavor(clienteId),
  });

  const { data: adelantos = [], isLoading: loadingLista } = useQuery({
    queryKey: ['adelantos-cliente', clienteId],
    queryFn:  () => pagosApi.listarAdelantos({ clienteId }),
  });

  if (loadingSaldo || loadingLista) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Cargando saldos…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tarjeta
          label="Saldo a favor disponible"
          valor={formatPEN(saldo?.disponible ?? 0)}
          className="border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
        />
        <Tarjeta
          label="Total adelantado"
          valor={formatPEN(saldo?.totalAdelantado ?? 0)}
          className="border-border bg-card text-foreground"
        />
        <Tarjeta
          label="Deuda pendiente"
          valor={formatPEN(saldo?.deudaPendiente ?? 0)}
          className={cn(
            'border-border bg-card',
            (saldo?.deudaPendiente ?? 0) > 0 ? 'text-destructive' : 'text-foreground',
          )}
        />
      </div>

      {(saldo?.deudaPendiente ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          Con deuda pendiente no se admiten adelantos nuevos: entregar dinero teniendo
          comprobantes impagos es pagar, no adelantar.
        </p>
      )}

      {/* Detalle */}
      {!adelantos.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2 border border-dashed border-border rounded-lg">
          <Wallet className="w-9 h-9 text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">Sin adelantos</p>
          <p className="text-xs text-muted-foreground">
            Este cliente no ha entregado pagos por adelantado.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left  px-4 py-2.5 font-medium">Fecha</th>
                <th className="text-left  px-4 py-2.5 font-medium">Método</th>
                <th className="text-left  px-4 py-2.5 font-medium">N° operación</th>
                <th className="text-right px-4 py-2.5 font-medium">Monto</th>
                <th className="text-right px-4 py-2.5 font-medium">Disponible</th>
                <th className="text-left  px-4 py-2.5 font-medium">Situación</th>
                <th className="text-left  px-4 py-2.5 font-medium">Aplicado a</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {adelantos.map(a => (
                <tr key={a.id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5 text-muted-foreground">{a.fechaPago}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.metodoPago}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.numeroOperacion ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">{formatPEN(a.monto)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{formatPEN(a.disponible)}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', SITUACION_BADGE[a.situacion])}>
                      {SITUACION_LABEL[a.situacion]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {a.facturasAplicadas.length ? a.facturasAplicadas.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tarjeta({ label, valor, className }: { label: string; valor: string; className?: string }) {
  return (
    <div className={cn('rounded-lg border p-4 flex flex-col gap-1', className)}>
      <span className="text-2xl font-bold">{valor}</span>
      <span className="text-xs font-medium opacity-70">{label}</span>
    </div>
  );
}
