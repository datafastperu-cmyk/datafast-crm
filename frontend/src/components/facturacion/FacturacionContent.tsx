'use client';

import { useState, useCallback } from 'react';
import { useRouter }             from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Search, RefreshCw, FileText, Download,
  Calendar, CheckCircle2, AlertCircle, Clock, Ban,
} from 'lucide-react';

import { facturacionApi, type FiltrosFactura } from '@/lib/api/facturacion';
import { useToast }   from '@/components/ui/toaster';
import { useDebounce } from '@/hooks/useDebounce';
import { cn, formatPEN, formatDate, parseApiError } from '@/lib/utils';
import type { Factura } from '@/types';

const ESTADOS_TAB = [
  { key: '',              label: 'Todas',          icon: FileText },
  { key: 'emitida',       label: 'Emitidas',       icon: Clock },
  { key: 'pagada',        label: 'Pagadas',        icon: CheckCircle2 },
  { key: 'vencida',       label: 'Vencidas',       icon: AlertCircle },
  { key: 'anulada',       label: 'Anuladas',       icon: Ban },
];

const ESTADO_BADGE: Record<string, string> = {
  pagada:         'badge-activo',
  emitida:        'badge-pendiente',
  pagada_parcial: 'badge-prorroga',
  vencida:        'badge-moroso',
  anulada:        'badge-baja',
  en_cobranza:    'badge-moroso',
  borrador:       'badge-baja',
};

const ESTADO_LABEL: Record<string, string> = {
  pagada:         'Pagada ✓',
  emitida:        'Emitida',
  pagada_parcial: 'Parcial',
  vencida:        'Vencida',
  anulada:        'Anulada',
  en_cobranza:    'En cobro',
  borrador:       'Borrador',
};

export function FacturacionContent() {
  const router    = useRouter();
  const { toast } = useToast();

  const [filtros, setFiltros]   = useState<FiltrosFactura>({ page: 1, limit: 25 });
  const [searchInput, setSearch] = useState('');
  const searchDebounced          = useDebounce(searchInput, 400);
  const [showGenerar, setShowGenerar] = useState(false);
  const [genMes, setGenMes]   = useState(new Date().getMonth() + 1);
  const [genAnio, setGenAnio] = useState(new Date().getFullYear());
  const [genForzar, setGenForzar] = useState(false);

  const upd = useCallback(<K extends keyof FiltrosFactura>(k: K, v: FiltrosFactura[K]) =>
    setFiltros((f) => ({ ...f, [k]: v, page: 1 })), []);

  const params = { ...filtros, search: searchDebounced || undefined };

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['facturas', params],
    queryFn:  () => facturacionApi.list(params),
    placeholderData: (prevData) => prevData,
  });

  const { data: resumen } = useQuery({
    queryKey: ['facturacion-resumen'],
    queryFn:  facturacionApi.getResumen,
    staleTime: 60_000,
  });

  const { mutate: generarMasivo, isPending: generando } = useMutation({
    mutationFn: () => facturacionApi.generarMensual({ mes: genMes, anio: genAnio, forzar: genForzar }),
    onSuccess: (r) => {
      toast(`Facturas generadas: ${r.exitosas ?? 0} ✓ | ${r.errores ?? 0} errores`, {
        type: r.errores > 0 ? 'warning' : 'success',
      });
      setShowGenerar(false);
      refetch();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: descargarPdf } = useMutation({
    mutationFn: (id: string) => facturacionApi.getPdf(id),
    onSuccess: (blob, id) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `factura-${id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    },
    onError: () => toast('No se pudo descargar el PDF', { type: 'error' }),
  });

  const facturas = data?.data ?? [];
  const meta     = data?.meta;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Facturación</h2>
          <p className="text-sm text-muted-foreground">
            {meta?.total != null ? `${meta.total.toLocaleString('es-PE')} facturas` : 'Gestión de comprobantes'}
          </p>
        </div>
        <button
          onClick={() => setShowGenerar(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <Calendar className="w-3.5 h-3.5" /> Generar mensual
        </button>
      </div>

      {/* Stats */}
      {resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Emitidas',         value: resumen.totalEmitidas,            color: 'text-blue-600' },
            { label: 'Pagadas',          value: resumen.totalPagadas,             color: 'text-green-600' },
            { label: 'Vencidas',         value: resumen.totalVencidas,            color: 'text-red-600' },
            { label: 'Monto total',      value: formatPEN(resumen.montoTotal),    color: 'text-foreground' },
            { label: 'Por cobrar',       value: formatPEN(resumen.montoPendiente), color: 'text-orange-600' },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn('text-xl font-bold mt-0.5', s.color)}>
                {typeof s.value === 'number' ? s.value.toLocaleString('es-PE') : s.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-3 p-4 border-b border-border flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por N° factura, abonado…"
              value={searchInput}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-input
                         bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Filtro mes/año */}
          <select
            value={filtros.mes ?? ''}
            onChange={(e) => upd('mes', e.target.value ? Number(e.target.value) : undefined)}
            className="px-3 py-2 text-sm rounded-lg border border-input bg-background
                       focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Todos los meses</option>
            {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>

          <input
            type="number"
            min={2020}
            max={2030}
            placeholder="Año"
            value={filtros.anio ?? ''}
            onChange={(e) => upd('anio', e.target.value ? Number(e.target.value) : undefined)}
            className="w-24 px-3 py-2 text-sm rounded-lg border border-input bg-background
                       focus:outline-none focus:ring-2 focus:ring-primary"
          />

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg border border-input text-muted-foreground
                       hover:text-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-4 gap-1 overflow-x-auto">
          {ESTADOS_TAB.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => upd('estado', key || undefined)}
              className={cn(
                'px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                (filtros.estado ?? '') === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tabla de facturas */}
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="skeleton h-4 w-28 rounded" />
                <div className="skeleton h-4 flex-1 rounded" />
                <div className="skeleton h-4 w-20 rounded" />
                <div className="skeleton h-4 w-16 rounded" />
              </div>
            ))}
          </div>
        ) : !facturas.length ? (
          <div className="flex flex-col items-center justify-center py-16">
            <FileText className="w-10 h-10 text-muted-foreground opacity-30 mb-3" />
            <p className="text-sm font-medium text-foreground">Sin facturas</p>
            <p className="text-xs text-muted-foreground mt-1">No hay facturas con los filtros seleccionados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>N° Comprobante</th>
                  <th>Abonado</th>
                  <th>Período</th>
                  <th>Vencimiento</th>
                  <th>Estado</th>
                  <th>Total</th>
                  <th>Saldo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((f) => (
                  <tr
                    key={f.id}
                    onClick={() => router.push(`/facturacion/${f.id}`)}
                    className="cursor-pointer"
                  >
                    <td>
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {f.numeroCompleto}
                      </span>
                      {f.generadaAutomaticamente && (
                        <span className="ml-1.5 text-[9px] text-muted-foreground">AUTO</span>
                      )}
                    </td>
                    <td className="max-w-[160px] truncate text-sm">{f.clienteNombre ?? '—'}</td>
                    <td>
                      <span className="text-xs text-muted-foreground">
                        {f.periodoInicio ? `${formatDate(f.periodoInicio)} – ${formatDate(f.periodoFin)}` : '—'}
                      </span>
                    </td>
                    <td>
                      <span className={cn(
                        'text-xs',
                        f.estado === 'vencida' ? 'text-destructive font-medium' : 'text-muted-foreground',
                      )}>
                        {formatDate(f.fechaVencimiento)}
                      </span>
                    </td>
                    <td>
                      <span className={cn(
                        'text-[11px] font-semibold px-2 py-0.5 rounded-full',
                        ESTADO_BADGE[f.estado] ?? 'badge-pendiente',
                      )}>
                        {ESTADO_LABEL[f.estado] ?? f.estado}
                      </span>
                    </td>
                    <td>
                      <span className="text-sm font-semibold text-foreground">{formatPEN(f.total)}</span>
                    </td>
                    <td>
                      {(f.saldo ?? 0) > 0 ? (
                        <span className="text-sm font-bold text-destructive">{formatPEN(f.saldo)}</span>
                      ) : (
                        <span className="text-xs text-green-600 font-medium">—</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => descargarPdf(f.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground
                                   hover:bg-muted transition-colors"
                        title="Descargar PDF"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
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
              {((meta.page - 1) * meta.limit) + 1}–{Math.min(meta.page * meta.limit, meta.total)} de {meta.total.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              <Pag disabled={!meta.hasPrev} onClick={() => upd('page', meta.page - 1)}>← Anterior</Pag>
              {Array.from({ length: Math.min(meta.totalPages, 5) }, (_, i) => i + 1).map((p) => (
                <Pag key={p} active={p === meta.page} onClick={() => upd('page', p)}>{p}</Pag>
              ))}
              <Pag disabled={!meta.hasNext} onClick={() => upd('page', meta.page + 1)}>Siguiente →</Pag>
            </div>
          </div>
        )}
      </div>

      {/* Modal Generar Masivo */}
      {showGenerar && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-semibold text-foreground">Generar facturas mensuales</h3>
            <p className="text-sm text-muted-foreground">
              Genera facturas para todos los contratos activos de la empresa.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Mes</label>
                <select
                  value={genMes}
                  onChange={(e) => setGenMes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background
                             focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Año</label>
                <input
                  type="number" min={2020} max={2030}
                  value={genAnio}
                  onChange={(e) => setGenAnio(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background
                             focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={genForzar}
                onChange={(e) => setGenForzar(e.target.checked)} className="rounded" />
              <span className="text-foreground">Forzar (regenerar si ya existe)</span>
            </label>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowGenerar(false)}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => generarMasivo()}
                disabled={generando}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                           bg-primary text-primary-foreground font-medium hover:bg-primary/90
                           disabled:opacity-60 transition-colors"
              >
                {generando
                  ? <><span className="animate-spin">⚙</span> Generando...</>
                  : 'Generar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Pag({ children, onClick, disabled, active }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn(
        'px-3 py-1.5 text-xs rounded-lg border transition-colors',
        active ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-muted disabled:opacity-40',
      )}>
      {children}
    </button>
  );
}
