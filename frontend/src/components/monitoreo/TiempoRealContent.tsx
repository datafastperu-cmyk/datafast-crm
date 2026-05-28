'use client';

import { useState }          from 'react';
import { useQuery }          from '@tanstack/react-query';
import {
  Activity, Wifi, WifiOff, AlertTriangle, ArrowDown,
  ArrowUp, Plus, RefreshCw, Users, Zap,
} from 'lucide-react';

import { dispositivosApi }            from '@/lib/api/monitoreo';
import { formatBps, formatDateTime, cn } from '@/lib/utils';
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
    ONLINE:        { label: 'Online',        cls: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
    OFFLINE:       { label: 'Offline',       cls: 'bg-red-500/20 text-red-400 border border-red-500/30' },
    REVERIFICANDO: { label: 'Reverificando', cls: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
    DEGRADADO:     { label: 'Degradado',     cls: 'bg-orange-500/20 text-orange-400 border border-orange-500/30' },
  };
  const s = MAP[status] ?? { label: status, cls: 'bg-zinc-600/20 text-zinc-400 border border-zinc-600/30' };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', s.cls)}>
      {s.label}
    </span>
  );
}

function PctBar({ value, warnAt = 70, critAt = 90 }: { value: number | null; warnAt?: number; critAt?: number }) {
  if (value === null) return <span className="text-zinc-600 text-xs">—</span>;
  const color = value >= critAt ? 'bg-red-500' : value >= warnAt ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-1.5 min-w-[72px]">
      <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-xs text-zinc-300 w-9 text-right">{value.toFixed(0)}%</span>
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────
export function TiempoRealContent() {
  const [modalOpen, setModalOpen]   = useState(false);
  const [slideOver, setSlideOver]   = useState<{ id: string; nombre: string } | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<TiempoRealData>({
    queryKey: ['monitoreo', 'tiempo-real'],
    queryFn:  () => dispositivosApi.getTiempoReal(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const totales = data?.totales ?? { online: 0, offline: 0, reverificando: 0, degradado: 0, alertasActivas: 0 };
  const trafico = data?.traficoBps ?? { totalDown: 0, totalUp: 0 };
  const dispositivos = data?.dispositivos ?? [];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Tiempo Real</h1>
          <p className="text-sm text-zinc-400 mt-0.5">Actualiza cada 30 segundos</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
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
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs text-zinc-400">Total</span>
          </div>
          <p className="text-2xl font-bold text-white">{dispositivos.length}</p>
          <p className="text-xs text-zinc-500 mt-0.5">dispositivos</p>
        </div>

        {/* Online */}
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wifi className="h-4 w-4 text-emerald-400" />
            <span className="text-xs text-zinc-400">Online</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">{totales.online}</p>
          <p className="text-xs text-zinc-500 mt-0.5">activos</p>
        </div>

        {/* Offline */}
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <WifiOff className="h-4 w-4 text-red-400" />
            <span className="text-xs text-zinc-400">Offline</span>
          </div>
          <p className="text-2xl font-bold text-red-400">{totales.offline + totales.reverificando}</p>
          <p className="text-xs text-zinc-500 mt-0.5">sin respuesta</p>
        </div>

        {/* Alertas */}
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-zinc-400">Alertas</span>
          </div>
          <p className="text-2xl font-bold text-amber-400">{totales.alertasActivas}</p>
          <p className="text-xs text-zinc-500 mt-0.5">activas</p>
        </div>

        {/* Tráfico */}
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-blue-400" />
            <span className="text-xs text-zinc-400">Tráfico</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-zinc-200">
            <ArrowDown className="h-3 w-3 text-emerald-400" />
            <span>{formatBps(trafico.totalDown)}</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-zinc-400 mt-0.5">
            <ArrowUp className="h-3 w-3 text-blue-400" />
            <span>{formatBps(trafico.totalUp)}</span>
          </div>
        </div>
      </div>

      {/* ── Tabla de dispositivos ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500 text-sm">
          <Activity className="h-5 w-5 animate-pulse mr-2" />
          Cargando dispositivos...
        </div>
      ) : dispositivos.length === 0 ? (
        <div className="bg-zinc-800/40 border border-dashed border-zinc-700 rounded-xl p-12 text-center">
          <Activity className="h-10 w-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Sin dispositivos registrados</p>
          <p className="text-zinc-500 text-sm mt-1 mb-5">Agrega un router o antena para comenzar el monitoreo</p>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Agregar primer dispositivo
          </button>
        </div>
      ) : (
        <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700/50">
                  {['Dispositivo', 'Estado', 'Ping', 'CPU', 'RAM', 'Bajada', 'Subida', 'Última métrica', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-700/30">
                {dispositivos.map(d => (
                  <tr key={d.id} className="hover:bg-zinc-700/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white truncate max-w-[160px]">{d.nombreEmisor}</div>
                      <div className="text-xs text-zinc-500">{d.ipAddress}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                      {d.alertasActivas > 0 && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/20 text-red-400">
                          {d.alertasActivas}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {d.pingLatenciaMs !== null ? (
                        <span className={d.pingLatenciaMs > 150 ? 'text-amber-400' : 'text-zinc-200'}>
                          {d.pingLatenciaMs.toFixed(0)} ms
                        </span>
                      ) : '—'}
                      {d.pingLossPct !== null && d.pingLossPct > 0 && (
                        <div className="text-xs text-red-400">{d.pingLossPct.toFixed(0)}% pérd</div>
                      )}
                    </td>
                    <td className="px-4 py-3"><PctBar value={d.cpuUsagePct} /></td>
                    <td className="px-4 py-3"><PctBar value={d.memoryUsagePct} /></td>
                    <td className="px-4 py-3 text-zinc-300 text-xs whitespace-nowrap">
                      {d.trafficDownBps ? formatBps(Number(d.trafficDownBps)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-300 text-xs whitespace-nowrap">
                      {d.trafficUpBps ? formatBps(Number(d.trafficUpBps)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">
                      {d.ultimaMetricaAt ? formatDateTime(d.ultimaMetricaAt) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {d.tipoEquipo === 'ANTENA_AP' && (
                        <button
                          onClick={() => setSlideOver({ id: d.id, nombre: d.nombreEmisor })}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs transition-colors whitespace-nowrap"
                        >
                          <Users className="h-3 w-3" />
                          Clientes
                        </button>
                      )}
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
