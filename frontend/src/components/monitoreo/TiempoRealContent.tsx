'use client';

import { useState }          from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Wifi, WifiOff, AlertTriangle, ArrowDown,
  ArrowUp, Plus, RefreshCw, Users, Zap, Pencil, Trash2,
} from 'lucide-react';

import { dispositivosApi }            from '@/lib/api/monitoreo';
import { formatBps, formatDateTime, cn, parseApiError } from '@/lib/utils';
import { useToast }                   from '@/components/ui/toaster';
import { ClientesSlideOver }          from './ClientesSlideOver';
import { DispositivoFormModal }        from './DispositivoFormModal';

// ─── tipos ────────────────────────────────────────────────────
interface DispositivoConMetrica {
  id:              string;
  nombreEmisor:    string;
  ipAddress:       string;
  tipoEquipo:      string;
  fabricante:      string;
  status:          string;
  lastSeenAt:      string | null;
  pingLatenciaMs:  number | null;
  pingLossPct:     number | null;
  cpuUsagePct:     number | null;
  memoryUsagePct:  number | null;
  trafficDownBps:  string | null;
  trafficUpBps:    string | null;
  ultimaMetricaAt: string | null;
  alertasActivas:  number;
}

interface TiempoRealData {
  totales:     { online: number; offline: number; reverificando: number; degradado: number; alertasActivas: number };
  traficoBps:  { totalDown: number; totalUp: number };
  dispositivos: DispositivoConMetrica[];
}

// ─── helpers ──────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const MAP: Record<string, { label: string; cls: string }> = {
    ONLINE:        { label: 'Online',        cls: 'bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30' },
    OFFLINE:       { label: 'Offline',       cls: 'bg-red-100 text-red-700 border border-red-300 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30' },
    REVERIFICANDO: { label: 'Reverificando', cls: 'bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30' },
    DEGRADADO:     { label: 'Degradado',     cls: 'bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30' },
  };
  const s = MAP[status] ?? { label: status, cls: 'bg-muted text-muted-foreground border border-border' };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', s.cls)}>
      {s.label}
    </span>
  );
}

function PctBar({ value, warnAt = 70, critAt = 90 }: { value: number | null; warnAt?: number; critAt?: number }) {
  if (value === null) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const color = value >= critAt ? 'bg-red-500' : value >= warnAt ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-1.5 min-w-[72px]">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-9 text-right">{value.toFixed(0)}%</span>
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────
export function TiempoRealContent() {
  const { toast }                     = useToast();
  const queryClient                   = useQueryClient();
  const [modalOpen, setModalOpen]     = useState(false);
  const [editId, setEditId]           = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DispositivoConMetrica | null>(null);
  const [slideOver, setSlideOver]     = useState<{ id: string; nombre: string } | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<TiempoRealData>({
    queryKey: ['monitoreo', 'tiempo-real'],
    queryFn:  () => dispositivosApi.getTiempoReal(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { mutate: eliminar, isPending: eliminando } = useMutation({
    mutationFn: (id: string) => dispositivosApi.deleteDispositivo(id),
    onSuccess: () => {
      toast('Dispositivo eliminado', { type: 'success' });
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ['monitoreo', 'tiempo-real'] });
    },
    onError: (e) => {
      toast(parseApiError(e), { type: 'error' });
      setPendingDelete(null);
    },
  });

  const totales = data?.totales ?? { online: 0, offline: 0, reverificando: 0, degradado: 0, alertasActivas: 0 };
  const trafico = data?.traficoBps ?? { totalDown: 0, totalUp: 0 };
  const dispositivos = data?.dispositivos ?? [];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tiempo Real</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Actualiza cada 30 segundos</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-muted-foreground text-sm transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Actualizar
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* En vivo */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs text-muted-foreground">Total</span>
          </div>
          <p className="text-2xl font-bold text-white">{dispositivos.length}</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">dispositivos</p>
        </div>

        {/* Online */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wifi className="h-4 w-4 text-emerald-400" />
            <span className="text-xs text-muted-foreground">Online</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">{totales.online}</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">activos</p>
        </div>

        {/* Offline */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <WifiOff className="h-4 w-4 text-red-400" />
            <span className="text-xs text-muted-foreground">Offline</span>
          </div>
          <p className="text-2xl font-bold text-red-400">{totales.offline + totales.reverificando}</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">sin respuesta</p>
        </div>

        {/* Alertas */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-muted-foreground">Alertas</span>
          </div>
          <p className="text-2xl font-bold text-amber-400">{totales.alertasActivas}</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">activas</p>
        </div>

        {/* Tráfico */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-blue-400" />
            <span className="text-xs text-muted-foreground">Tráfico</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-foreground">
            <ArrowDown className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
            <span>{formatBps(trafico.totalDown)}</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
            <ArrowUp className="h-3 w-3 text-blue-400" />
            <span>{formatBps(trafico.totalUp)}</span>
          </div>
        </div>
      </div>

      {/* ── Tabla de dispositivos ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
          <Activity className="h-5 w-5 animate-pulse mr-2" />
          Cargando dispositivos...
        </div>
      ) : dispositivos.length === 0 ? (
        <div className="bg-muted/20 border border-dashed border-border rounded-xl p-12 text-center">
          <Activity className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-foreground font-medium">Sin dispositivos registrados</p>
          <p className="text-muted-foreground text-sm mt-1 mb-5">Agrega un router o antena para comenzar el monitoreo</p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Agregar primer dispositivo
          </button>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Dispositivo', 'Estado', 'Ping', 'CPU', 'RAM', 'Bajada', 'Subida', 'Última métrica', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {dispositivos.map(d => (
                  <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground truncate max-w-[160px]">{d.nombreEmisor}</div>
                      <div className="text-xs text-muted-foreground/60">{d.ipAddress}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                      {d.alertasActivas > 0 && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/20 text-red-400">
                          {d.alertasActivas}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {d.pingLatenciaMs !== null ? (
                        <span className={d.pingLatenciaMs > 150 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}>
                          {d.pingLatenciaMs.toFixed(0)} ms
                        </span>
                      ) : '—'}
                      {d.pingLossPct !== null && d.pingLossPct > 0 && (
                        <div className="text-xs text-red-600 dark:text-red-400">{d.pingLossPct.toFixed(0)}% pérd</div>
                      )}
                    </td>
                    <td className="px-4 py-3"><PctBar value={d.cpuUsagePct} /></td>
                    <td className="px-4 py-3"><PctBar value={d.memoryUsagePct} /></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {d.trafficDownBps ? formatBps(Number(d.trafficDownBps)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {d.trafficUpBps ? formatBps(Number(d.trafficUpBps)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground/60 text-xs whitespace-nowrap">
                      {d.ultimaMetricaAt ? formatDateTime(d.ultimaMetricaAt) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {d.tipoEquipo === 'ANTENA_AP' && (
                          <button
                            onClick={() => setSlideOver({ id: d.id, nombre: d.nombreEmisor })}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted hover:bg-muted/70 text-muted-foreground text-xs transition-colors whitespace-nowrap"
                          >
                            <Users className="h-3 w-3" />
                            Clientes
                          </button>
                        )}
                        <button
                          onClick={() => setEditId(d.id)}
                          title="Editar dispositivo"
                          className="p-1.5 rounded-md text-muted-foreground/60 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setPendingDelete(d)}
                          title="Eliminar dispositivo"
                          className="p-1.5 rounded-md text-muted-foreground/60 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modales ── */}
      {modalOpen && (
        <DispositivoFormModal
          onClose={() => setModalOpen(false)}
          onSuccess={() => { setModalOpen(false); refetch(); }}
        />
      )}

      {editId && (
        <DispositivoFormModal
          dispositivoId={editId}
          onClose={() => setEditId(null)}
          onSuccess={() => { setEditId(null); refetch(); }}
        />
      )}

      {pendingDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <Trash2 className="w-5 h-5 text-red-500 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground leading-none">Eliminar dispositivo</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Esta acción no se puede deshacer</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              ¿Confirmas eliminar <span className="font-medium text-foreground">{pendingDelete.nombreEmisor}</span>?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={eliminando}
                className="px-4 py-2 text-sm rounded-lg border border-input text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={() => eliminar(pendingDelete.id)}
                disabled={eliminando}
                className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-40"
              >
                {eliminando ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {slideOver && (
        <ClientesSlideOver
          dispositivoId={slideOver.id}
          nombreEmisor={slideOver.nombre}
          isOpen={!!slideOver}
          onClose={() => setSlideOver(null)}
        />
      )}
    </div>
  );
}
