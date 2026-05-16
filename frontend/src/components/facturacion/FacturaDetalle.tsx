'use client';

import { useRouter }  from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState }   from 'react';
import {
  ArrowLeft, Download, CreditCard, ExternalLink,
  AlertTriangle, CheckCircle2, Loader2, Ban,
} from 'lucide-react';

import { facturacionApi, pagosApi } from '@/lib/api/facturacion';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, formatPEN, formatDate, formatDateTime, cn } from '@/lib/utils';
import type { Pago }  from '@/types';

const ESTADO_BADGE: Record<string, string> = {
  pagada: 'badge-activo', emitida: 'badge-pendiente',
  pagada_parcial: 'badge-prorroga', vencida: 'badge-moroso',
  anulada: 'badge-baja', en_cobranza: 'badge-moroso',
};

const METODO_EMOJI: Record<string, string> = {
  efectivo: '💵', yape: '🟣', plin: '🔵',
  transferencia_bancaria: '🏦', deposito_bancario: '🏦',
  mercadopago: '💳', tarjeta_credito: '💳', tarjeta_debito: '💳', cheque: '📄',
};

export function FacturaDetalle({ id }: { id: string }) {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [motivoAnular, setMotivo] = useState('');
  const [showAnular, setShowAnular] = useState(false);
  const [mpLoading, setMpLoading]   = useState(false);

  const { data: factura, isLoading } = useQuery({
    queryKey: ['factura', id],
    queryFn:  () => facturacionApi.getById(id),
  });

  const { data: pagos = [] } = useQuery<Pago[]>({
    queryKey: ['factura-pagos', id],
    queryFn:  () => facturacionApi.getPagos(id),
  });

  const { mutate: descargarPdf, isPending: descargando } = useMutation({
    mutationFn: () => facturacionApi.getPdf(id),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `${factura?.numeroCompleto ?? id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    },
    onError: () => toast('Error al generar PDF', { type: 'error' }),
  });

  const { mutate: anular, isPending: anulando } = useMutation({
    mutationFn: () => facturacionApi.anular(id, motivoAnular),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['factura', id] });
      queryClient.invalidateQueries({ queryKey: ['facturas'] });
      setShowAnular(false);
      toast('Factura anulada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const generarLinkMp = async () => {
    setMpLoading(true);
    try {
      const pref = await facturacionApi.crearPreferenciaMp(id);
      window.open(pref.init_point, '_blank');
    } catch (e) {
      toast(parseApiError(e), { type: 'error' });
    } finally { setMpLoading(false); }
  };

  if (isLoading) return <div className="skeleton h-64 rounded-xl animate-pulse" />;
  if (!factura)  return <p className="text-muted-foreground text-center py-20">Factura no encontrada.</p>;

  const saldo = factura.saldo ?? (factura.total - (factura.montoPagado ?? 0));

  return (
    <div className="max-w-2xl space-y-5">

      {/* Nav */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => router.push('/facturacion')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Facturas
        </button>
        <div className="flex items-center gap-2">
          {factura.estado !== 'anulada' && factura.estado !== 'pagada' && (
            <>
              <button
                onClick={generarLinkMp}
                disabled={mpLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                           border border-input hover:bg-muted transition-colors"
              >
                {mpLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                Link MercadoPago
              </button>
              <button
                onClick={() => router.push(`/pagos/nuevo?facturaId=${id}&clienteId=${factura.clienteId}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                           bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                <CreditCard className="w-3.5 h-3.5" /> Registrar pago
              </button>
            </>
          )}
          <button
            onClick={() => descargarPdf()}
            disabled={descargando}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       border border-input hover:bg-muted transition-colors"
          >
            {descargando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            PDF
          </button>
          {factura.estado !== 'anulada' && factura.estado !== 'pagada' && (
            <button onClick={() => setShowAnular(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                         border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors">
              <Ban className="w-3.5 h-3.5" /> Anular
            </button>
          )}
        </div>
      </div>

      {/* Comprobante visual */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">

        {/* Header del comprobante */}
        <div className="bg-primary/5 border-b border-border p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {factura.tipoComprobante?.toUpperCase() ?? 'BOLETA DE VENTA'}
              </p>
              <h1 className="text-2xl font-bold font-mono text-foreground mt-1">
                {factura.numeroCompleto}
              </h1>
            </div>
            <span className={cn(
              'text-sm font-bold px-3 py-1.5 rounded-full',
              ESTADO_BADGE[factura.estado] ?? 'badge-pendiente',
            )}>
              {factura.estado.replace('_', ' ').toUpperCase()}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
            <span>Emisión: <b className="text-foreground">{formatDate(factura.fechaEmision)}</b></span>
            <span>Vence: <b className={cn(
              factura.estado === 'vencida' ? 'text-destructive' : 'text-foreground',
            )}>{formatDate(factura.fechaVencimiento)}</b></span>
            {factura.periodoInicio && (
              <span>Período: <b className="text-foreground">
                {formatDate(factura.periodoInicio)} – {formatDate(factura.periodoFin)}
              </b></span>
            )}
          </div>
        </div>

        {/* Cuerpo */}
        <div className="p-6 space-y-5">

          {/* Cliente */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Cliente
            </p>
            <p className="text-sm font-semibold text-foreground">
              {factura.clienteNombre ?? '—'}
            </p>
          </div>

          {/* Descripción / ítems */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Descripción
            </p>
            <div className="bg-muted/30 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Detalle</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Cantidad</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">P. Unit.</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(factura.items ?? [{ descripcion: factura.descripcion, cantidad: 1, precioUnitario: factura.subtotal, subtotal: factura.subtotal }]).map((item, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-foreground">{item.descripcion}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{item.cantidad}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatPEN(item.precioUnitario)}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">{formatPEN(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totales */}
          <div className="flex justify-end">
            <div className="w-56 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatPEN(factura.subtotal)}</span>
              </div>
              {(factura.igv ?? 0) > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>IGV (18%)</span>
                  <span>{formatPEN(factura.igv)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-foreground text-base
                              pt-1.5 border-t border-border">
                <span>Total</span>
                <span>{formatPEN(factura.total)}</span>
              </div>
              {(factura.montoPagado ?? 0) > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Pagado</span>
                  <span>- {formatPEN(factura.montoPagado)}</span>
                </div>
              )}
              {saldo > 0 && (
                <div className="flex justify-between font-bold text-destructive pt-1 border-t border-border">
                  <span>Saldo pendiente</span>
                  <span>{formatPEN(saldo)}</span>
                </div>
              )}
              {saldo <= 0 && factura.estado !== 'anulada' && (
                <div className="flex items-center gap-1.5 text-green-600 text-xs pt-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Factura completamente pagada
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Historial de pagos */}
      {pagos.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Pagos registrados</h3>
          </div>
          <div className="divide-y divide-border">
            {pagos.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{METODO_EMOJI[p.metodoPago] ?? '•'}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {p.metodoPago.replace(/_/g, ' ')}
                      {p.banco && <span className="text-muted-foreground"> · {p.banco}</span>}
                    </p>
                    {p.numeroOperacion && (
                      <p className="text-xs text-muted-foreground font-mono">{p.numeroOperacion}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{formatDate(p.fechaPago)}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-foreground">{formatPEN(p.monto)}</p>
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-px rounded-full',
                    p.estado === 'verificado' ? 'badge-activo' : 'badge-pendiente',
                  )}>
                    {p.estado === 'verificado' ? 'Verificado' : 'Pendiente'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal anular */}
      {showAnular && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
              <h3 className="text-base font-semibold text-foreground">Anular factura</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Esta acción genera una nota de crédito y marca la factura como anulada.
              <strong className="text-foreground"> No se puede deshacer.</strong>
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Motivo de anulación *</label>
              <textarea
                rows={3}
                value={motivoAnular}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Error en datos, duplicada, etc."
                className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background
                           focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowAnular(false)}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => anular()}
                disabled={anulando || !motivoAnular.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                           bg-destructive text-destructive-foreground font-medium
                           hover:bg-destructive/90 disabled:opacity-60 transition-colors"
              >
                {anulando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Confirmar anulación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
