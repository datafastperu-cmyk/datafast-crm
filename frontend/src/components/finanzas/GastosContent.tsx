'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, CheckCircle2, Trash2, Repeat2, X, CreditCard, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

import {
  finanzasOpexApi,
  CATEGORIAS_LABELS,
  type CreateEgresoIngresoDto,
  type TipoMovimiento,
  type CategoriaMovimiento,
  type EstadoMovimiento,
} from '@/lib/api/finanzas-opex';
import { zonasApi } from '@/lib/api/zonas';
import { proyectosInversionApi } from '@/lib/api/proyectos-inversion';
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
  tipo:               'EGRESO',
  categoria:          'OTROS',
  monto:              0,
  fechaRegistro:      new Date().toISOString().split('T')[0],
  descripcion:        '',
  esRecurrente:       false,
  proyectoInversionId: undefined,
};

// ─── Componente ───────────────────────────────────────────────

export function GastosContent() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [tab,          setTab]          = useState<TipoMovimiento | ''>('');
  const [showModal,    setShowModal]    = useState(false);
  const [form,         setForm]         = useState<CreateEgresoIngresoDto>(FORM_EMPTY);
  const [pendienteId,  setPendienteId]  = useState<string | null>(null);
  const [sortField,    setSortField]    = useState<string>('fechaRegistro');
  const [sortDir,      setSortDir]      = useState<'ASC' | 'DESC'>('DESC');

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => d === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortField(field);
      setSortDir('ASC');
    }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground flex-shrink-0" />;
    return sortDir === 'ASC'
      ? <ChevronUp   className="w-3 h-3 text-primary flex-shrink-0" />
      : <ChevronDown className="w-3 h-3 text-primary flex-shrink-0" />;
  }

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

  const { data: pendientesAll = [] } = useQuery({
    queryKey: ['opex-pendientes'],
    queryFn:  finanzasOpexApi.getPendientes,
    staleTime: 30_000,
  });
  const pendientesObligaciones = pendientesAll.filter((p) => !!p.plantillaId);

  const { data: zonas = [] } = useQuery({
    queryKey: ['zonas-list'],
    queryFn:  zonasApi.list,
    staleTime: 5 * 60_000,
  });

  const { data: proyectosActivos } = useQuery({
    queryKey: ['proyectos-activos'],
    queryFn:  () => proyectosInversionApi.list({ estado: 'activo', limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const proyectoOpts = proyectosActivos?.data ?? [];

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
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['opex-pendientes'] });
      const prev = queryClient.getQueryData<typeof pendientesAll>(['opex-pendientes']);
      queryClient.setQueryData<typeof pendientesAll>(['opex-pendientes'], (old = []) =>
        old.filter((p) => p.id !== id),
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['opex-pendientes'], ctx.prev);
      toast(parseApiError(_e), { type: 'error' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opex-list'] });
      queryClient.invalidateQueries({ queryKey: ['opex-resumen'] });
      queryClient.invalidateQueries({ queryKey: ['opex-pendientes'] });
      toast('Obligación marcada como pagada', { type: 'success' });
      setShowModal(false);
      setPendienteId(null);
      setForm(FORM_EMPTY);
    },
  });

  const borrarMut = useMutation({
    mutationFn: finanzasOpexApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opex-list'] });
      queryClient.invalidateQueries({ queryKey: ['opex-resumen'] });
      queryClient.invalidateQueries({ queryKey: ['opex-pendientes'] });
      toast('Eliminado', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const rawRows = data?.data ?? [];

  const rows = useMemo(() => {
    const sorted = [...rawRows].sort((a, b) => {
      let av: any = a[sortField as keyof typeof a];
      let bv: any = b[sortField as keyof typeof b];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av === null || av === undefined) av = '';
      if (bv === null || bv === undefined) bv = '';
      if (av < bv) return sortDir === 'ASC' ? -1 : 1;
      if (av > bv) return sortDir === 'ASC' ?  1 : -1;
      return 0;
    });
    return sorted;
  }, [rawRows, sortField, sortDir]);

  function diasLabel(dias: number): { text: string; cls: string } {
    if (dias > 1)  return { text: `Vence en ${dias} días`,                cls: 'text-amber-400' };
    if (dias === 1) return { text: 'Vence mañana',                        cls: 'text-orange-400' };
    if (dias === 0) return { text: 'Vence hoy',                           cls: 'text-red-400' };
    return { text: `Vencido hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`, cls: 'text-red-500' };
  }

  function openPagarModal(p: (typeof pendientesAll)[0]) {
    setPendienteId(p.id);
    setForm({
      tipo:          'EGRESO',
      categoria:     p.categoria,
      monto:         Number(p.monto),
      fechaRegistro: new Date().toISOString().split('T')[0],
      descripcion:   p.descripcion ?? '',
      esRecurrente:  false,
    });
    setShowModal(true);
  }

  function handleGuardar() {
    if (pendienteId) {
      pagarMut.mutate(pendienteId);
    } else {
      crearMut.mutate({
        ...form,
        esRecurrente:        form.tipo === 'EGRESO' ? form.esRecurrente        : false,
        diaVencimiento:      form.tipo === 'EGRESO' ? form.diaVencimiento      : undefined,
        proyectoInversionId: form.tipo === 'EGRESO' ? form.proyectoInversionId : undefined,
      });
    }
  }

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

      {/* Obligaciones Fijas Pendientes */}
      {pendientesObligaciones.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <h3 className="text-sm font-semibold text-amber-300">
              Obligaciones Fijas Pendientes — Mes Actual
            </h3>
            <span className="ml-auto text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium tabular-nums">
              {pendientesObligaciones.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {pendientesObligaciones.map((p) => {
              const hoy  = new Date();
              const dias = (p.diaVencimiento ?? hoy.getDate()) - hoy.getDate();
              const { text: diasTxt, cls: diasCls } = diasLabel(dias);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2.5 gap-3 hover:border-amber-500/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {p.descripcion || CATEGORIAS_LABELS[p.categoria]}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{CATEGORIAS_LABELS[p.categoria]}</p>
                    <p className={cn('text-xs mt-1 font-medium', diasCls)}>{diasTxt}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-mono font-semibold text-rose-400">{formatPEN(p.monto)}</p>
                    <button
                      onClick={() => openPagarModal(p)}
                      className="mt-1.5 flex items-center gap-1 text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-md transition-colors font-medium"
                    >
                      <CreditCard className="w-3 h-3" />
                      Registrar Pago
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                {[
                  { field: 'fechaRegistro', label: 'Fecha',      cls: 'px-4 py-3 text-left font-medium text-muted-foreground text-sm' },
                  { field: 'tipo',          label: 'Tipo',        cls: 'px-4 py-3 text-left font-medium text-muted-foreground text-sm' },
                  { field: 'categoria',     label: 'Categoría',   cls: 'px-4 py-3 text-left font-medium text-muted-foreground text-sm' },
                ].map(({ field, label, cls }) => (
                  <th key={field} onClick={() => handleSort(field)} className={cn(cls, 'cursor-pointer select-none group')}>
                    <span className="inline-flex items-center gap-1">{label}<SortIcon field={field} /></span>
                  </th>
                ))}
                <th className="px-4 py-3 text-left font-medium text-muted-foreground text-sm">Descripción</th>
                <th onClick={() => handleSort('monto')} className="px-4 py-3 text-right font-medium text-muted-foreground text-sm cursor-pointer select-none group">
                  <span className="inline-flex items-center gap-1 justify-end w-full">Monto<SortIcon field="monto" /></span>
                </th>
                <th onClick={() => handleSort('estado')} className="px-4 py-3 text-center font-medium text-muted-foreground text-sm cursor-pointer select-none group">
                  <span className="inline-flex items-center gap-1 justify-center w-full">Estado<SortIcon field="estado" /></span>
                </th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground text-sm">Rec.</th>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {pendienteId ? 'Registrar Pago — Obligación Fija' : 'Registrar movimiento'}
                </h3>
                {pendienteId && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Confirma el pago para cerrar esta obligación del mes
                  </p>
                )}
              </div>
              <button
                onClick={() => { setShowModal(false); setPendienteId(null); setForm(FORM_EMPTY); }}
                className="p-1.5 rounded hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-4">

              {/* Modo pagar: resumen de la obligación */}
              {pendienteId ? (
                <>
                  <div className="bg-amber-500/8 border border-amber-500/25 rounded-lg px-3 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {form.descripcion || CATEGORIAS_LABELS[form.categoria ?? 'OTROS']}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {CATEGORIAS_LABELS[form.categoria ?? 'OTROS']}
                      </p>
                    </div>
                    <p className="text-base font-mono font-bold text-rose-400">{formatPEN(form.monto)}</p>
                  </div>

                  {/* Fecha de pago */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Fecha de pago</label>
                    <input
                      type="date"
                      value={form.fechaRegistro}
                      onChange={(e) => setForm((f) => ({ ...f, fechaRegistro: e.target.value }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Notas del pago */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Notas <span className="text-muted-foreground/60">(opcional)</span></label>
                    <input
                      type="text"
                      value={form.descripcion ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                      placeholder="Ej. Pagado vía BCP - Operación #123"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Voucher */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">
                      Comprobante / Voucher <span className="text-muted-foreground/60">(opcional)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer w-full bg-background border border-dashed border-border rounded-lg px-3 py-2.5 hover:border-primary/50 transition-colors">
                      <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground truncate" id="voucher-label">
                        Adjuntar imagen del comprobante
                      </span>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          const el = document.getElementById('voucher-label');
                          if (el) el.textContent = f ? f.name : 'Adjuntar imagen del comprobante';
                        }}
                      />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  {/* Tipo */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Tipo</label>
                    <div className="flex gap-2">
                      {(['EGRESO', 'INGRESO_OTRO'] as TipoMovimiento[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => setForm((f) => ({
                            ...f,
                            tipo: t,
                            ...(t === 'INGRESO_OTRO' && {
                              esRecurrente:        false,
                              diaVencimiento:      undefined,
                              proyectoInversionId: undefined,
                            }),
                          }))}
                          className={cn(
                            'flex-1 py-2 rounded-lg border text-sm font-medium transition-colors',
                            form.tipo === t
                              ? t === 'EGRESO'
                                ? 'border-rose-500 bg-rose-500/10 text-rose-400'
                                : 'border-sky-500 bg-sky-500/10 text-sky-400'
                              : 'border-border text-muted-foreground hover:border-foreground/30',
                          )}
                        >
                          {t === 'EGRESO' ? 'Egreso' : 'Otro Ingreso (Fuera del giro del negocio)'}
                        </button>
                      ))}
                    </div>
                    {form.tipo === 'INGRESO_OTRO' && (
                      <p className="text-[11px] text-muted-foreground leading-snug mt-1.5">
                        Nota: La recaudación por servicios de internet de abonados se procesa automáticamente.
                        Use esta opción solo para ingresos excepcionales (ej. venta de equipos, penalidades, reparaciones externas).
                      </p>
                    )}
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

                  {/* Proyecto de Expansión */}
                  {form.tipo === 'EGRESO' && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">
                        Proyecto de Expansión <span className="text-muted-foreground/60">(opcional)</span>
                      </label>
                      <select
                        value={form.proyectoInversionId ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, proyectoInversionId: e.target.value || undefined }))}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">— Sin imputar a proyecto —</option>
                        {proyectoOpts.map((p) => (
                          <option key={p.id} value={p.id}>{p.nombreProyecto}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Recurrente */}
                  {form.tipo === 'EGRESO' && (
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
                  )}

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
                </>
              )}
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => { setShowModal(false); setPendienteId(null); setForm(FORM_EMPTY); }}
                className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleGuardar}
                disabled={(pendienteId ? pagarMut.isPending : crearMut.isPending) || form.monto <= 0}
                className={cn(
                  'flex-1 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50',
                  pendienteId
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-primary hover:bg-primary/90 text-primary-foreground',
                )}
              >
                {pendienteId
                  ? (pagarMut.isPending  ? 'Registrando...' : 'Confirmar Pago')
                  : (crearMut.isPending  ? 'Guardando...'   : 'Guardar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
