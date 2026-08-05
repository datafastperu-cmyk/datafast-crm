'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pagosApi } from '@/lib/api/facturacion';
import type { AdelantoRow } from '@/lib/api/facturacion';
import { useToast } from '@/components/ui/toaster';
import { cn, formatPEN, parseApiError } from '@/lib/utils';
import { Loader2, RefreshCw, Undo2, Wallet, AlertCircle } from 'lucide-react';

/**
 * Adelantos de pago (saldo a favor).
 *
 * La "situación" que se muestra NO es un estado guardado: se deriva de cuánto del adelanto
 * se ha imputado ya a comprobantes. Un adelanto intacto está DISPONIBLE; consumido a
 * medias, PARCIAL; agotado, EFECTUADO. Así la etiqueta no puede contradecir al dinero.
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

export function TabAdelantos() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filtro, setFiltro] = useState('');
  const [devolviendo, setDevolviendo] = useState<AdelantoRow | null>(null);
  const [motivo, setMotivo] = useState('');

  const { data: adelantos = [], isLoading, refetch } = useQuery({
    queryKey: ['adelantos', filtro],
    queryFn:  () => pagosApi.listarAdelantos({ situacion: filtro || undefined }),
    refetchInterval: 60_000,
  });

  const devolverMut = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      pagosApi.devolverAdelanto(id, motivo),
    onSuccess: (r) => {
      toast(`Adelanto devuelto: ${formatPEN(r.devuelto)}`, { type: 'success' });
      setDevolviendo(null);
      setMotivo('');
      void qc.invalidateQueries({ queryKey: ['adelantos'] });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const totalDisponible = adelantos.reduce((s, a) => s + a.disponible, 0);

  return (
    <div className="p-6 space-y-4">
      {/* Resumen */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 p-4 flex flex-col gap-1">
          <span className="text-2xl font-bold text-blue-700 dark:text-blue-400">
            {formatPEN(totalDisponible)}
          </span>
          <span className="text-xs font-medium opacity-70">Saldo a favor sin aplicar</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            className="rounded border border-input bg-background px-2.5 py-1.5 text-sm"
          >
            <option value="">Todas las situaciones</option>
            <option value="disponible">Disponibles</option>
            <option value="parcial">Aplicados en parte</option>
            <option value="efectuado">Facturados</option>
            <option value="devuelto">Devueltos</option>
          </select>
          <button
            onClick={() => void refetch()}
            className="p-2 rounded border border-input hover:bg-accent"
            title="Actualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Listado */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Cargando adelantos…
          </div>
        ) : !adelantos.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <Wallet className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">Sin adelantos registrados</p>
            <p className="text-xs text-muted-foreground max-w-md">
              Un adelanto se registra desde Registrar pago, eligiendo “Registrar como
              adelanto”. Solo se admite si el cliente no tiene deuda pendiente.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left  px-4 py-2.5 font-medium">Cliente</th>
                  <th className="text-left  px-4 py-2.5 font-medium">Fecha</th>
                  <th className="text-left  px-4 py-2.5 font-medium">Método</th>
                  <th className="text-left  px-4 py-2.5 font-medium">N° operación</th>
                  <th className="text-right px-4 py-2.5 font-medium">Monto</th>
                  <th className="text-right px-4 py-2.5 font-medium">Disponible</th>
                  <th className="text-left  px-4 py-2.5 font-medium">Situación</th>
                  <th className="text-left  px-4 py-2.5 font-medium">Aplicado a</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {adelantos.map(a => (
                  <tr key={a.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5 font-medium text-foreground">{a.clienteNombre}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.fechaPago}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.metodoPago}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.numeroOperacion ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">{formatPEN(a.monto)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {formatPEN(a.disponible)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn('px-2 py-0.5 rounded text-xs font-medium', SITUACION_BADGE[a.situacion])}>
                        {SITUACION_LABEL[a.situacion]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {a.facturasAplicadas.length ? a.facturasAplicadas.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {a.disponible > 0 && a.situacion !== 'devuelto' && (
                        <button
                          onClick={() => { setDevolviendo(a); setMotivo(''); }}
                          className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                        >
                          <Undo2 className="w-3.5 h-3.5" /> Devolver
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de devolución */}
      {devolviendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Devolver adelanto</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Se devolverán <strong>{formatPEN(devolviendo.disponible)}</strong> a{' '}
                  {devolviendo.clienteNombre}. Solo se devuelve lo que aún no se aplicó a
                  ningún comprobante.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Motivo de la devolución *
              </label>
              <textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                rows={3}
                className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm"
                placeholder="Por qué se devuelve este dinero"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDevolviendo(null)}
                className="px-3 py-1.5 text-sm rounded border border-input hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                disabled={!motivo.trim() || devolverMut.isPending}
                onClick={() => devolverMut.mutate({ id: devolviendo.id, motivo })}
                className="px-3 py-1.5 text-sm rounded bg-destructive text-destructive-foreground disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {devolverMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Confirmar devolución
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
