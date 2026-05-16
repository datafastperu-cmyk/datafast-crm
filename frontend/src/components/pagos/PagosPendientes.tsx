'use client';

import { useRouter }  from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState }   from 'react';
import {
  ArrowLeft, CheckCircle2, XCircle, Eye,
  Clock, Loader2,
} from 'lucide-react';

import { pagosApi }  from '@/lib/api/facturacion';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, formatPEN, formatDateTime, cn } from '@/lib/utils';
import type { Pago } from '@/types';

const METODO_EMOJI: Record<string, string> = {
  efectivo: '💵', yape: '🟣', plin: '🔵',
  transferencia_bancaria: '🏦', deposito_bancario: '🏦',
  mercadopago: '💳',
};

export function PagosPendientes() {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [selected, setSelected]     = useState<Pago | null>(null);
  const [motivoRechazo, setMotivo]  = useState('');
  const [aprobandoId, setAprobando] = useState<string | null>(null);

  const { data: pendientes = [], isLoading, refetch } = useQuery<Pago[]>({
    queryKey: ['pagos-pendientes'],
    queryFn:  pagosApi.getPendientes,
    refetchInterval: 30_000,
  });

  const invalida = () => {
    queryClient.invalidateQueries({ queryKey: ['pagos-pendientes'] });
    queryClient.invalidateQueries({ queryKey: ['pagos'] });
    queryClient.invalidateQueries({ queryKey: ['pagos-resumen'] });
  };

  const { mutate: aprobar, isPending: aprobando } = useMutation({
    mutationFn: (id: string) => pagosApi.verificar(id, true),
    onSuccess: () => {
      invalida(); setAprobando(null);
      toast('✓ Pago aprobado — factura actualizada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: rechazar, isPending: rechazando } = useMutation({
    mutationFn: (id: string) => pagosApi.verificar(id, false, motivoRechazo),
    onSuccess: () => {
      invalida(); setSelected(null); setMotivo('');
      toast('Pago rechazado', { type: 'warning' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="max-w-3xl space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/pagos')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Pagos
          </button>
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-orange-500" />
              Pagos pendientes de verificación
            </h2>
            <p className="text-sm text-muted-foreground">
              {pendientes.length} pago{pendientes.length !== 1 ? 's' : ''} por revisar
            </p>
          </div>
        </div>
        <button onClick={() => refetch()}
          className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg
                     border border-input hover:bg-muted transition-colors">
          Actualizar
        </button>
      </div>

      {/* Instrucciones */}
      <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800
                      rounded-xl p-4 text-sm text-orange-800 dark:text-orange-400">
        Verifica el comprobante antes de aprobar. Al aprobar, el pago se aplica a la factura
        y, si la deuda queda en cero, el servicio del cliente se reactiva automáticamente.
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : pendientes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mb-3" />
          <p className="text-base font-semibold text-foreground">¡Todo verificado!</p>
          <p className="text-sm text-muted-foreground mt-1">No hay pagos pendientes de revisión.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendientes.map((p) => (
            <div key={p.id}
                 className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-4">
                {/* Método */}
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center
                                text-lg flex-shrink-0">
                  {METODO_EMOJI[p.metodoPago] ?? '•'}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-sm font-semibold text-foreground">
                      {p.cliente_nombre ?? 'Cliente'}
                    </p>
                    <span className="text-xs text-muted-foreground">·</span>
                    <p className="text-sm font-bold text-foreground">{formatPEN(p.monto)}</p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                    <span className="capitalize">{p.metodoPago.replace(/_/g, ' ')}</span>
                    {p.banco && <span>{p.banco}</span>}
                    {p.numeroOperacion && (
                      <span className="font-mono bg-muted px-1.5 py-px rounded">{p.numeroOperacion}</span>
                    )}
                    <span>{formatDateTime(p.registradoEn)}</span>
                  </div>
                  {p.notas && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{p.notas}</p>
                  )}

                  {/* Comprobante si hay */}
                  {p.comprobanteUrl && (
                    <a
                      href={p.comprobanteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
                    >
                      <Eye className="w-3 h-3" /> Ver comprobante
                    </a>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setAprobando(p.id); aprobar(p.id); }}
                    disabled={aprobando && aprobandoId === p.id}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg
                               bg-green-600 text-white font-medium hover:bg-green-700
                               disabled:opacity-60 transition-colors"
                  >
                    {aprobando && aprobandoId === p.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Aprobar
                  </button>
                  <button
                    onClick={() => setSelected(p)}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg
                               border border-destructive/30 text-destructive
                               hover:bg-destructive/10 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Rechazar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal rechazo */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3">
              <XCircle className="w-5 h-5 text-destructive" />
              <h3 className="text-base font-semibold text-foreground">Rechazar pago</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Pago de <strong>{formatPEN(selected.monto)}</strong> por{' '}
              {selected.cliente_nombre ?? 'el cliente'}.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Motivo del rechazo *</label>
              <textarea
                rows={3}
                value={motivoRechazo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="N° de operación no coincide, comprobante ilegible, etc."
                className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background
                           focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setSelected(null); setMotivo(''); }}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => rechazar(selected.id)}
                disabled={rechazando || !motivoRechazo.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                           bg-destructive text-destructive-foreground font-medium
                           disabled:opacity-60 transition-colors"
              >
                {rechazando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
