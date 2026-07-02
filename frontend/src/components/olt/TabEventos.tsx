'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Activity, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { cn } from '@/lib/utils';

// ── Labels ────────────────────────────────────────────────────────

const TIPO_LABEL: Record<string, string> = {
  provision:      'Provisión ONU',
  deprovision:    'Desaprovisionamiento',
  test_conexion:  'Test de Conexión',
  discover:       'Descubrimiento',
  metricas:       'Métricas ONU',
  estado_onu:     'Estado ONU',
};

const ESTADO_STYLE: Record<string, string> = {
  exitoso:  'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  fallido:  'bg-red-500/10 text-red-400 border border-red-500/20',
  pendiente:'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
};

const PROVEEDOR_STYLE: Record<string, string> = {
  nativo_ssh: 'text-sky-400',
  smartolt:   'text-violet-400',
};

const PAGE_SIZE = 25;

// ── Fila expandible ───────────────────────────────────────────────

function FilaEvento({ ev }: { ev: ReturnType<typeof normalize> }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!ev.errorMensaje;

  return (
    <>
      <tr
        className={cn(
          'border-b border-border last:border-0 transition-colors',
          hasDetail ? 'cursor-pointer hover:bg-muted/10' : 'hover:bg-muted/5',
        )}
        onClick={() => hasDetail && setOpen(o => !o)}
      >
        {/* Fecha */}
        <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
          {new Date(ev.createdAt).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' })}
        </td>

        {/* Tipo */}
        <td className="px-4 py-2.5 text-xs font-medium text-foreground">
          {TIPO_LABEL[ev.tipo] ?? ev.tipo}
        </td>

        {/* Estado */}
        <td className="px-4 py-2.5">
          <span className={cn(
            'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase',
            ESTADO_STYLE[ev.estado] ?? 'bg-muted text-muted-foreground',
          )}>
            {ev.estado}
          </span>
        </td>

        {/* ONU SN */}
        <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground hidden md:table-cell">
          {ev.onuSn ?? <span className="text-muted-foreground/30">—</span>}
        </td>

        {/* Proveedor */}
        <td className="px-4 py-2.5 text-xs hidden lg:table-cell">
          {ev.proveedorExitoso ? (
            <span className={cn('font-mono', PROVEEDOR_STYLE[ev.proveedorExitoso] ?? 'text-muted-foreground')}>
              {ev.proveedorExitoso}
            </span>
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </td>

        {/* Duración */}
        <td className="px-4 py-2.5 text-xs text-muted-foreground hidden xl:table-cell whitespace-nowrap">
          {ev.duracionMs != null ? `${ev.duracionMs} ms` : <span className="text-muted-foreground/30">—</span>}
        </td>

        {/* Expand toggle */}
        <td className="px-3 py-2.5 text-muted-foreground/40 w-6">
          {hasDetail && (open
            ? <ChevronUp className="w-3.5 h-3.5" />
            : <ChevronDown className="w-3.5 h-3.5" />
          )}
        </td>
      </tr>

      {/* Detalle de error expandido */}
      {open && ev.errorMensaje && (
        <tr className="border-b border-border bg-red-500/5">
          <td colSpan={7} className="px-4 py-2.5">
            <p className="text-[11px] font-mono text-red-400 whitespace-pre-wrap break-all">
              {ev.errorMensaje}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function normalize(ev: any) {
  return ev as {
    id: string;
    onuSn: string | null;
    tipo: string;
    estado: string;
    proveedorExitoso: string | null;
    proveedoresIntentados: string[];
    errorMensaje: string | null;
    duracionMs: number | null;
    createdAt: string;
  };
}

// ── Componente principal ──────────────────────────────────────────

export function TabEventos({ oltId }: { oltId: string }) {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['olt-eventos', oltId, page],
    queryFn:  () => oltNativoApi.getEventos(oltId, page, PAGE_SIZE),
    enabled:  !!oltId,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const total      = data?.total ?? 0;
  const items      = data?.data  ?? [];
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Activity className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Sin operaciones registradas para esta OLT</p>
        <p className="text-xs text-muted-foreground/60">Los eventos de provisión, desaprovisionamiento y test aparecerán aquí</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{total} operaciones registradas</p>
        <p className="text-[11px] text-muted-foreground/50">Las filas con error son expandibles</p>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Fecha</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Operación</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Estado</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">ONU SN</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Proveedor</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden xl:table-cell">Duración</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {items.map((ev) => (
              <FilaEvento key={ev.id} ev={normalize(ev)} />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1 rounded hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span>Página {page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-1 rounded hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
