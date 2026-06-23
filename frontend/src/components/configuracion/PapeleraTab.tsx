'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trash2, RotateCcw, AlertTriangle, RefreshCw,
  Search, Filter, Loader2, X,
} from 'lucide-react';
import { auditoriaApi, type PapeleraItem } from '@/lib/api/auditoria';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

const MODULOS = ['Todos', 'clientes', 'contratos', 'facturas', 'pagos', 'planes'];

const MODULO_LABEL: Record<string, string> = {
  clientes:  'Clientes',
  contratos: 'Contratos',
  facturas:  'Facturación',
  pagos:     'Pagos',
  planes:    'Planes',
  tickets:   'Tickets',
};

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function tiempoDesde(iso: string) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const horas = Math.floor(mins / 60);
  const dias  = Math.floor(horas / 24);
  if (dias  > 0) return `hace ${dias}d`;
  if (horas > 0) return `hace ${horas}h`;
  return `hace ${mins}m`;
}

export function PapeleraTab() {
  const { toast }      = useToast();
  const queryClient    = useQueryClient();
  const [modulo,       setModulo]       = useState('Todos');
  const [search,       setSearch]       = useState('');
  const [confirmId,    setConfirmId]    = useState<string | null>(null);
  const [confirmTabla, setConfirmTabla] = useState<string>('');
  const [selected,     setSelected]     = useState<Set<string>>(new Set());

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ['papelera', modulo],
    queryFn:  () => auditoriaApi.getPapelera(modulo !== 'Todos' ? modulo : undefined),
    staleTime: 15_000,
  });

  const filtrados = items.filter(it =>
    !search || it.display_name.toLowerCase().includes(search.toLowerCase()),
  );

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['papelera'] });
    queryClient.invalidateQueries({ queryKey: ['clientes'] });
    queryClient.invalidateQueries({ queryKey: ['contratos'] });
    queryClient.invalidateQueries({ queryKey: ['planes'] });
    queryClient.invalidateQueries({ queryKey: ['facturas'] });
  };

  const { mutate: restaurar, isPending: restaurando } = useMutation({
    mutationFn: ({ tabla, id }: { tabla: string; id: string }) =>
      auditoriaApi.restaurar(tabla, id),
    onSuccess: () => {
      toast('Registro restaurado exitosamente', { type: 'success' });
      invalidar();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminar, isPending: eliminando } = useMutation({
    mutationFn: ({ tabla, id }: { tabla: string; id: string }) =>
      auditoriaApi.eliminarPermanente(tabla, id),
    onSuccess: () => {
      toast('Eliminado permanentemente', { type: 'success' });
      setConfirmId(null);
      invalidar();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-destructive" />
            Papelera inteligente
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtrados.length} registro{filtrados.length !== 1 ? 's' : ''} eliminado{filtrados.length !== 1 ? 's' : ''} · restaurables en cualquier momento
          </p>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border
                     text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <RefreshCw className="w-3 h-3" />
          Actualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg
                       text-foreground placeholder:text-muted-foreground
                       focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select value={modulo} onChange={e => setModulo(e.target.value)}
          className="px-3 py-1.5 text-sm bg-muted border border-border rounded-lg text-foreground
                     focus:outline-none focus:ring-1 focus:ring-primary">
          {MODULOS.map(m => <option key={m}>{m}</option>)}
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <Trash2 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Papelera vacía</p>
          <p className="text-xs text-muted-foreground mt-1">
            {modulo !== 'Todos' ? `No hay registros de "${MODULO_LABEL[modulo] ?? modulo}" eliminados` : 'No hay registros eliminados'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map(item => (
            <div
              key={`${item.tabla}-${item.id}`}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors',
                selected.has(item.id)
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border hover:bg-muted/30',
              )}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggleSelect(item.id)}
                className="w-3.5 h-3.5 accent-primary flex-shrink-0"
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-px rounded-full bg-muted text-muted-foreground capitalize">
                    {MODULO_LABEL[item.tabla] ?? item.tabla}
                  </span>
                  <span className="text-sm font-medium text-foreground truncate">
                    {item.display_name}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                  ID: {item.id.slice(0, 8)}... · Eliminado {tiempoDesde(item.deleted_at)} ({fmtFecha(item.deleted_at)})
                </p>
              </div>

              {/* Acciones */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => restaurar({ tabla: item.tabla, id: item.id })}
                  disabled={restaurando}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg font-medium
                             text-emerald-700 bg-emerald-100 hover:bg-emerald-200
                             dark:text-emerald-400 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/60
                             disabled:opacity-50 transition-colors"
                >
                  {restaurando
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RotateCcw className="w-3 h-3" />}
                  Restaurar
                </button>
                <button
                  onClick={() => { setConfirmId(item.id); setConfirmTabla(item.tabla); }}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive
                             hover:bg-destructive/10 transition-colors"
                  title="Eliminar permanentemente"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal confirmación eliminación permanente */}
      {confirmId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Confirmar acción" className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Eliminar permanentemente</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Esta acción <strong>no se puede deshacer</strong>. El registro se borrará definitivamente de la base de datos.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setConfirmId(null)}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => eliminar({ tabla: confirmTabla, id: confirmId })}
                disabled={eliminando}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                           bg-destructive text-white font-medium disabled:opacity-60 transition-colors">
                {eliminando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
