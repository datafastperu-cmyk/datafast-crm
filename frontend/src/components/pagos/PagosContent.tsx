'use client';

import { useState, useCallback } from 'react';
import { useRouter }             from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, RefreshCw, CheckCircle2,
  Clock, AlertCircle, CreditCard, TrendingUp, Trash2,
} from 'lucide-react';

import { pagosApi, type FiltrosPago } from '@/lib/api/facturacion';
import { useAuthStore }               from '@/store/auth.store';
import { zonasApi }                   from '@/lib/api/zonas';
import { mikrotikApi }                from '@/lib/api/mikrotik';
import { useToast }    from '@/components/ui/toaster';
import { useDebounce } from '@/hooks/useDebounce';
import { cn, formatPEN, formatDate, parseApiError } from '@/lib/utils';
import type { Pago }   from '@/types';

const METODO_EMOJI: Record<string, string> = {
  efectivo: '💵', yape: '🟣', plin: '🔵',
  transferencia_bancaria: '🏦', deposito_bancario: '🏦',
  mercadopago: '💳', tarjeta_credito: '💳', tarjeta_debito: '💳',
};

const TABS = [
  { key: '',                    label: 'Todos' },
  { key: 'verificado',          label: 'Verificados' },
  { key: 'pendiente_verificacion', label: 'Pendientes' },
  { key: 'rechazado',           label: 'Rechazados' },
];

export function PagosContent() {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const puedeEliminarPago = useAuthStore((s) => s.tienePermiso)('pagos:delete');

  const [filtros, setFiltros]   = useState<FiltrosPago>({ page: 1, limit: 25 });
  const [searchInput, setSearch] = useState('');
  const searchDebounced          = useDebounce(searchInput, 400);
  const [rechazandoId, setRechazando] = useState<string | null>(null);
  const [motivoRechazo, setMotivo]    = useState('');

  const { data: zonas    = [] } = useQuery({ queryKey: ['zonas-list'],    queryFn: zonasApi.list,          staleTime: 5 * 60_000 });
  const { data: routers  = [] } = useQuery({ queryKey: ['routers-list'],  queryFn: mikrotikApi.listar,     staleTime: 5 * 60_000 });

  const upd = useCallback(<K extends keyof FiltrosPago>(k: K, v: FiltrosPago[K]) =>
    setFiltros((f) => ({ ...f, [k]: v, page: 1 })), []);

  const params = { ...filtros, search: searchDebounced || undefined };

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['pagos', params],
    queryFn:  () => pagosApi.list(params),
    placeholderData: (prevData) => prevData,
    refetchInterval: 30_000,
  });

  const { data: resumen } = useQuery({
    queryKey: ['pagos-resumen'],
    queryFn:  pagosApi.getResumen,
    refetchInterval: 60_000,
  });

  const { mutate: aprobar } = useMutation({
    mutationFn: (id: string) => pagosApi.verificar(id, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pagos'] });
      queryClient.invalidateQueries({ queryKey: ['pagos-resumen'] });
      toast('Pago aprobado ✓', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: rechazar, isPending: rechazando } = useMutation({
    mutationFn: (id: string) => pagosApi.verificar(id, false, motivoRechazo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pagos'] });
      setRechazando(null); setMotivo('');
      toast('Pago rechazado', { type: 'warning' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => pagosApi.eliminar(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pagos'] });
      queryClient.invalidateQueries({ queryKey: ['pagos-resumen'] });
      toast('Pago eliminado', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const pagos = data?.data ?? [];
  const meta  = data?.meta;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Pagos</h2>
          <p className="text-sm text-muted-foreground">
            {resumen?.pendientesVerificar
              ? <span className="text-orange-600 font-medium">{resumen.pendientesVerificar} pagos pendientes de verificar</span>
              : 'Historial y Auditoría de Movimientos Financieros'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/pagos/pendientes')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors',
              (resumen?.pendientesVerificar ?? 0) > 0
                ? 'border-orange-300 text-orange-700 bg-orange-50 dark:bg-orange-950/30'
                : 'border-input hover:bg-muted',
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            Pendientes
            {(resumen?.pendientesVerificar ?? 0) > 0 && (
              <span className="font-bold ml-1">{resumen!.pendientesVerificar}</span>
            )}
          </button>
        </div>
      </div>

      {/* Dashboard de cobranza */}
      {resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Cobrado hoy',     value: formatPEN(resumen.cobradoHoy),    sub: `${resumen.pagosHoy} pagos`,       color: 'text-green-600', icon: CreditCard },
            { label: 'Esta semana',     value: formatPEN(resumen.cobradoSemana), sub: `${resumen.pagosSemana} pagos`,    color: 'text-blue-600',  icon: TrendingUp },
            { label: 'Este mes',        value: formatPEN(resumen.cobradoMes),    sub: `${resumen.pagosMes} pagos`,       color: 'text-foreground',icon: CreditCard },
            { label: 'Mes anterior',    value: formatPEN(resumen.cobradoMesAnterior), sub: 'referencia',                 color: 'text-muted-foreground', icon: CreditCard },
          ].map(({ label, value, sub, color, icon: Icon }) => (
            <div key={label} className="bg-card border border-border rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">{label}</p>
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className={cn('text-lg font-bold', color)}>{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Gráfico de métodos de pago */}
      {resumen?.porMetodo && Object.keys(resumen.porMetodo).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Métodos de pago — este mes
          </p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(resumen.porMetodo).map(([metodo, { total, monto }]) => (
              <div key={metodo} className="flex items-center gap-2 px-3 py-2 rounded-lg
                                           bg-muted/50 border border-border">
                <span className="text-base">{METODO_EMOJI[metodo] ?? '•'}</span>
                <div>
                  <p className="text-xs font-medium text-foreground capitalize">
                    {metodo.replace(/_/g, ' ')}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {total} pago{total !== 1 ? 's' : ''} · {formatPEN(monto)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla de pagos */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">

        {/* Toolbar */}
        <div className="p-4 border-b border-border space-y-3">
          {/* Fila 1: búsqueda + método + refresh */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por N° operación, banco…"
                value={searchInput}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-input
                           bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <select
              value={filtros.metodoPago ?? ''}
              onChange={(e) => upd('metodoPago', e.target.value || undefined)}
              className="px-3 py-2 text-sm rounded-lg border border-input bg-background
                         focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Todos los métodos</option>
              <option value="efectivo">💵 Efectivo</option>
              <option value="yape">🟣 Yape</option>
              <option value="plin">🔵 Plin</option>
              <option value="transferencia_bancaria">🏦 Transferencia</option>
              <option value="deposito_bancario">🏦 Depósito</option>
              <option value="mercadopago">💳 MercadoPago</option>
              <option value="tarjeta_credito">💳 Tarjeta crédito</option>
              <option value="tarjeta_debito">💳 Tarjeta débito</option>
            </select>
            <button onClick={() => refetch()} disabled={isFetching}
              className="p-2 rounded-lg border border-input text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            </button>
          </div>

          {/* Fila 2: rango fechas + sector + router */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Desde</label>
              <input
                type="date"
                value={filtros.fechaDesde ?? ''}
                onChange={(e) => upd('fechaDesde', e.target.value || undefined)}
                className="px-2.5 py-1.5 text-sm rounded-lg border border-input bg-background
                           focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Hasta</label>
              <input
                type="date"
                value={filtros.fechaHasta ?? ''}
                min={filtros.fechaDesde}
                onChange={(e) => upd('fechaHasta', e.target.value || undefined)}
                className="px-2.5 py-1.5 text-sm rounded-lg border border-input bg-background
                           focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <select
              value={filtros.sectorId ?? ''}
              onChange={(e) => upd('sectorId', e.target.value || undefined)}
              className="px-3 py-2 text-sm rounded-lg border border-input bg-background
                         focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Todos los sectores</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>{z.nombre}</option>
              ))}
            </select>
            <select
              value={filtros.routerId ?? ''}
              onChange={(e) => upd('routerId', e.target.value || undefined)}
              className="px-3 py-2 text-sm rounded-lg border border-input bg-background
                         focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Todos los routers</option>
              {routers.map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
            {(filtros.fechaDesde || filtros.fechaHasta || filtros.sectorId || filtros.routerId) && (
              <button
                onClick={() => setFiltros((f) => ({
                  ...f, fechaDesde: undefined, fechaHasta: undefined,
                  sectorId: undefined, routerId: undefined, page: 1,
                }))}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {/* Tabs de estado */}
        <div className="flex border-b border-border px-4 gap-1">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => upd('estado', key || undefined)}
              className={cn(
                'px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                (filtros.estado ?? '') === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}>
              {label}
            </button>
          ))}
        </div>

        {/* Tabla de pagos */}
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-10 rounded-xl animate-pulse" />)}
          </div>
        ) : !pagos.length ? (
          <div className="flex flex-col items-center justify-center py-14">
            <CreditCard className="w-10 h-10 text-muted-foreground opacity-30 mb-3" />
            <p className="text-sm font-medium text-foreground">Sin pagos</p>
            <p className="text-xs text-muted-foreground mt-1">No hay pagos con los filtros actuales.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Fecha</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Cliente</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Método</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Banco</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">N° Operación</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Comprobante</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Monto</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Estado</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagos.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">

                    {/* Fecha */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(p.fechaPago)}
                    </td>

                    {/* Cliente */}
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground whitespace-nowrap">
                        {p.cliente_nombre ?? p.clienteNombre ?? 'Sin nombre'}
                      </p>
                    </td>

                    {/* Método */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span>{METODO_EMOJI[p.metodoPago] ?? '•'}</span>
                        <span className="text-xs text-foreground capitalize">
                          {p.metodoPago.replace(/_/g, ' ')}
                        </span>
                      </span>
                    </td>

                    {/* Banco */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-foreground">
                      {p.banco ?? <span className="text-muted-foreground">—</span>}
                    </td>

                    {/* N° Operación */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {p.numeroOperacion
                        ? <span className="font-mono text-xs text-foreground">{p.numeroOperacion}</span>
                        : <span className="text-xs text-muted-foreground">—</span>
                      }
                    </td>

                    {/* Comprobante */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {p.numero_comprobante
                        ? <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{p.numero_comprobante}</span>
                        : <span className="text-xs text-muted-foreground">—</span>
                      }
                    </td>

                    {/* Monto */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <p className="text-sm font-bold text-foreground">{formatPEN(p.monto)}</p>
                      {p.conciliado && <p className="text-[10px] text-green-600">Conciliado ✓</p>}
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                        p.estado === 'verificado'    ? 'badge-activo'   :
                        p.estado === 'rechazado'     ? 'badge-suspendido' :
                        'badge-pendiente',
                      )}>
                        {p.estado.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        {p.estado === 'pendiente_verificacion' && (
                          <>
                            <button
                              onClick={() => aprobar(p.id)}
                              className="p-1.5 rounded-lg text-green-600 hover:bg-green-100 dark:hover:bg-green-950/30 transition-colors"
                              title="Aprobar"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setRechazando(p.id)}
                              className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                              title="Rechazar"
                            >
                              <AlertCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {!p.conciliado && puedeEliminarPago && (
                          <button
                            onClick={() => {
                              if (window.confirm('¿Eliminar este pago? Esta acción no se puede deshacer.')) {
                                eliminar(p.id);
                              }
                            }}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {((meta.page - 1) * meta.limit) + 1}–{Math.min(meta.page * meta.limit, meta.total)} de {meta.total}
            </p>
            <div className="flex gap-1">
              <Pag disabled={!meta.hasPrev} onClick={() => upd('page', meta.page - 1)}>← Ant.</Pag>
              <Pag disabled={!meta.hasNext} onClick={() => upd('page', meta.page + 1)}>Sig. →</Pag>
            </div>
          </div>
        )}
      </div>

      {/* Modal rechazo */}
      {rechazandoId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Confirmar acción" className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-semibold text-foreground">Rechazar pago</h3>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Motivo del rechazo *</label>
              <textarea rows={3} value={motivoRechazo} onChange={(e) => setMotivo(e.target.value)}
                placeholder="N° operación no coincide, imagen ilegible, etc."
                className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background
                           focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setRechazando(null); setMotivo(''); }}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => rechazar(rechazandoId)}
                disabled={rechazando || !motivoRechazo.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                           bg-destructive text-destructive-foreground font-medium
                           disabled:opacity-60 transition-colors"
              >
                {rechazando && <span className="animate-spin">⚙</span>}
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface PagProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

function Pag({ children, onClick, disabled, active }: PagProps) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors',
        active ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-muted disabled:opacity-40')}>
      {children}
    </button>
  );
}
