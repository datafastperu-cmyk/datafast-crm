'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, CheckCircle2, Trash2, Repeat2, X } from 'lucide-react';

import {
  finanzasOpexApi,
  CATEGORIAS_LABELS,
  type CreateEgresoIngresoDto,
  type TipoMovimiento,
  type CategoriaMovimiento,
  type EstadoMovimiento,
} from '@/lib/api/finanzas-opex';
import { zonasApi } from '@/lib/api/zonas';
import { useToast } from '@/components/ui/toaster';
import { cn, formatPEN, formatDate, parseApiError } from '@/lib/utils';

// ─── Tipos locales ────────────────────────────────────────────

const TABS_TIPO: { key: TipoMovimiento | ''; label: string }[] = [
  { key: '',           label: 'Todos'     },
  { key: 'EGRESO',     label: 'Egresos'   },
  { key: 'INGRESO_OTRO', label: 'Ingresos' },
];

const ESTADO_BADGE: Record<EstadoMovimiento, string> = {
  PAGADO:         'bg-emerald-500/15 text-emerald-400',
  PENDIENTE_PAGO: 'bg-amber-500/15  text-amber-400',
};

const TIPO_BADGE: Record<TipoMovimiento, string> = {
  EGRESO:       'bg-rose-500/15 text-rose-400',
  INGRESO_OTRO: 'bg-sky-500/15  text-sky-400',
};

const FORM_EMPTY: CreateEgresoIngresoDto = {
  tipo:          'EGRESO',
  categoria:     'OTROS',
  monto:         0,
  fechaRegistro: new Date().toISOString().split('T')[0],
  descripcion:   '',
  esRecurrente:  false,
};

// ─── Componente ───────────────────────────────────────────────

export function GastosContent() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [tab,        setTab]        = useState<TipoMovimiento | ''>('');
  const [showModal,  setShowModal]  = useState(false);
  const [form,       setForm]       = useState<CreateEgresoIngresoDto>(FORM_EMPTY);

  // ── Queries ────────────────────────────────────────────────
  const filtros = { tipo: tab || undefined, page: 1, limit: 50 };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['opex-list', filtros],
    queryFn:  () => finanzasOpexApi.list(filtros),
    placeholderData: (p) => p,
  });

  const { data: resumen } = useQuery({
    queryKey: ['opex-resumen'],
    queryFn:  finanzasOpexApi.getResumen,
    staleTime: 60_000,
  });

  const { data: zonas = [] } = useQuery({
    queryKey: ['zonas-list'],
    queryFn:  zonasApi.list,
    staleTime: 5 * 60_000,
  });

  // ── Mutations ──────────────────────────────────────────────
  const crearMut = useMutation({
    mutationFn: finanzasOpexApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opex-list'] });
      queryClient.invalidateQueries({ queryKey: ['opex-resumen'] });
      toast('Movimiento registrado', { type: 'success' });
      setShowModal(false);
      setForm(FORM_EMPTY);
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const pagarMut = useMutation({
    mutationFn: finanzasOpexApi.marcarPagado,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opex-list'] });
      queryClient.invalidateQueries({ queryKey: ['opex-resumen'] });
      toast('Marcado como pagado', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const borrarMut = useMutation({
    mutationFn: finanzasOpexApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opex-list'] });
      queryClient.invalidateQueries({ queryKey: ['opex-resumen'] });
      toast('Eliminado', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const rows = data?.data ?? [];

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Gastos / Ingresos</h2>
          <p className="text-sm text-muted-foreground">Control de egresos operativos y otros ingresos</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Registrar
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Ingresos del mes</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">
            {resumen ? formatPEN(resumen.totalIngresosMes) : '—'}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Egresos del mes</p>
          <p className="text-2xl font-bold text-rose-400 mt-1">
            {resumen ? formatPEN(resumen.totalEgresosMes) : '—'}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Pendientes de pago</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">
            {resumen?.pendientes ?? '—'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 rounded-lg p-1 w-fit">
        {TABS_TIPO.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === t.key
                ? 'bg-card shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No se encontraron registros en esta sección</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Categoría</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Descripción</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Monto</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Estado</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Rec.</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(r.fechaRegistro)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', TIPO_BADGE[r.tipo])}>
                      {r.tipo === 'EGRESO' ? 'Egreso' : 'Ingreso'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground/80">
                    {CATEGORIAS_LABELS[r.categoria]}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                    {r.descripcion || '—'}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right font-mono font-semibold',
                    r.tipo === 'EGRESO' ? 'text-rose-400' : 'text-emerald-400',
                  )}>
                    {formatPEN(r.monto)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_BADGE[r.estado])}>
                      {r.estado === 'PAGADO' ? 'Pagado' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.esRecurrente && (
                      <Repeat2 className="w-4 h-4 text-sky-400 mx-auto" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {r.estado === 'PENDIENTE_PAGO' && (
                        <button
                          onClick={() => pagarMut.mutate(r.id)}
                          disabled={pagarMut.isPending}
                          title="Marcar pagado"
                          className="p-1.5 rounded hover:bg-emerald-500/10 text-emerald-400 transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (window.confirm('¿Eliminar este registro?')) borrarMut.mutate(r.id);
                        }}
                        disabled={borrarMut.isPending}
                        title="Eliminar"
                        className="p-1.5 rounded hover:bg-rose-500/10 text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-foreground">Registrar movimiento</h3>
              <button
                onClick={() => { setShowModal(false); setForm(FORM_EMPTY); }}
                className="p-1.5 rounded hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Tipo */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Tipo</label>
                <div className="flex gap-2">
                  {(['EGRESO', 'INGRESO_OTRO'] as TipoMovimiento[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm((f) => ({ ...f, tipo: t }))}
                      className={cn(
                        'flex-1 py-2 rounded-lg border text-sm font-medium transition-colors',
                        form.tipo === t
                          ? t === 'EGRESO'
                            ? 'border-rose-500 bg-rose-500/10 text-rose-400'
                            : 'border-sky-500 bg-sky-500/10 text-sky-400'
                          : 'border-border text-muted-foreground hover:border-foreground/30',
                      )}
                    >
                      {t === 'EGRESO' ? 'Egreso' : 'Ingreso'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Categoría */}
              {form.tipo === 'EGRESO' && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Categoría</label>
                  <select
                    value={form.categoria}
                    onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value as CategoriaMovimiento }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {(Object.entries(CATEGORIAS_LABELS) as [CategoriaMovimiento, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Monto + Fecha */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Monto (S/.)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.monto || ''}
                    onChange={(e) => setForm((f) => ({ ...f, monto: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Fecha</label>
                  <input
                    type="date"
                    value={form.fechaRegistro}
                    onChange={(e) => setForm((f) => ({ ...f, fechaRegistro: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Descripción */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Descripción</label>
                <input
                  type="text"
                  value={form.descripcion}
                  onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Opcional"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Sector */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Sector (opcional)</label>
                <select
                  value={form.sectorId ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, sectorId: e.target.value || undefined }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">— Sin sector —</option>
                  {zonas.map((z) => (
                    <option key={z.id} value={z.id}>{z.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Recurrente */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div
                  onClick={() => setForm((f) => ({ ...f, esRecurrente: !f.esRecurrente, diaVencimiento: !f.esRecurrente ? 1 : undefined }))}
                  className={cn(
                    'relative w-10 h-5 rounded-full transition-colors',
                    form.esRecurrente ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <div className={cn(
                    'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    form.esRecurrente ? 'translate-x-5' : 'translate-x-0',
                  )} />
                </div>
                <span className="text-sm text-foreground">Gasto Recurrente</span>
              </label>

              {form.esRecurrente && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Día de vencimiento (1–28)</label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={form.diaVencimiento ?? 1}
                    onChange={(e) => setForm((f) => ({ ...f, diaVencimiento: parseInt(e.target.value) || 1 }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => { setShowModal(false); setForm(FORM_EMPTY); }}
                className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => crearMut.mutate(form)}
                disabled={crearMut.isPending || form.monto <= 0}
                className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {crearMut.isPending ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
