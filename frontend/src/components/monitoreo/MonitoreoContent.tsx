'use client';

import { useState, useEffect }   from 'react';
import { useRouter }             from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Wifi, WifiOff, AlertTriangle, CheckCircle2,
  Plus, Settings, RefreshCw, Zap, Users,
} from 'lucide-react';

import { monitoreoApi, dispositivosApi } from '@/lib/api/monitoreo';
import { useMonitoreo }  from '@/hooks/useMonitoreo';
import { useToast }      from '@/components/ui/toaster';
import { NodoCard }      from './NodoCard';
import { AlertasBanner } from './AlertasBanner';
import { TraficoChart }  from './TraficoChart';
import { DispositivoFormModal } from './DispositivoFormModal';
import { parseApiError, formatBps, cn } from '@/lib/utils';
import type { Nodo, WsEventDashboard } from '@/types';

export function MonitoreoContent() {
  const router    = useRouter();
  const { toast } = useToast();
  const [showAdd, setShowAdd]   = useState(false);
  const [wsDash, setWsDash]     = useState<WsEventDashboard | null>(null);
  const [filtroTipo, setFiltro] = useState<string>('');
  const [reparandoId, setReparandoId] = useState<string | null>(null);

  // ── REST: dispositivos desde /monitoreo/tiempo-real ───────
  const TIPO_MAP: Record<string, string> = {
    ANTENA_AP: 'antena', ROUTER_BORDE: 'router', ROUTER_ACCESO: 'router',
    CAMARA_IP: 'camara', DISPOSITIVO_CRITICO: 'servidor',
  };
  const STATUS_MAP: Record<string, string> = {
    ONLINE: 'online', OFFLINE: 'offline', DEGRADADO: 'degradado', REVERIFICANDO: 'degradado',
  };

  const { data: tiempoReal, isLoading, refetch } = useQuery({
    queryKey:        ['dispositivos-tiempo-real'],
    queryFn:         () => dispositivosApi.getTiempoReal(),
    refetchInterval: 60_000,
  });

  // Mapa id → tipoEquipo raw para identificar ANTENA_AP sin modificar el tipo Nodo
  const tipoEquipoMap = new Map<string, string>(
    (tiempoReal?.dispositivos ?? []).map((d: any) => [d.id, d.tipoEquipo]),
  );

  const nodos: Nodo[] = (tiempoReal?.dispositivos ?? [] as any[]).map((d: any) => ({
    id:            d.id,
    nombre:        d.nombreEmisor,
    tipo:          TIPO_MAP[d.tipoEquipo] ?? d.tipoEquipo.toLowerCase(),
    ipMonitoreo:   d.ipAddress,
    estado:        (STATUS_MAP[d.status] ?? 'desconocido') as any,
    latenciaMs:    d.pingLatenciaMs,
    perdidaPct:    d.pingLossPct,
    cpuUsoPct:     d.cpuUsagePct     ?? undefined,
    memoriaUsoPct: d.memoryUsagePct  ?? undefined,
    traficoRxBps:  d.trafficDownBps  ? parseInt(d.trafficDownBps, 10) : undefined,
    traficoTxBps:  d.trafficUpBps    ? parseInt(d.trafficUpBps,  10) : undefined,
    ultimoPing:    d.lastSeenAt      ? String(d.lastSeenAt) : undefined,
  }));

  // ── REST: alertas activas ──────────────────────────────────
  const { data: alertas = [] } = useQuery({
    queryKey:        ['alertas-activas'],
    queryFn:         monitoreoApi.getAlertasActivas,
    refetchInterval: 30_000,
  });

  // ── WebSocket: actualizaciones en tiempo real ──────────────
  const {
    conectado, mediciones, ultimaAlerta,
  } = useMonitoreo({
    onDashboard: (d) => setWsDash(d),
    onNodoStatus: (e) => {
      if (e.estado === 'offline') {
        toast(`🔴 ${e.nodoNombre} — OFFLINE`, { type: 'error' });
      } else {
        toast(`🟢 ${e.nodoNombre} — recuperado`, { type: 'success' });
      }
    },
    onAlerta: (e) => {
      if (e.tipo === 'nueva' && e.alerta.nivel === 'critical') {
        toast(`🚨 ${e.alerta.nodoNombre}: ${e.alerta.mensaje}`, { type: 'error' });
      }
    },
  });

  // ── Reparar Antena AP ────────────────────────────────────────
  const handleReparar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setReparandoId(id);
    try {
      const res = await dispositivosApi.repararAntenaAP(id);
      if (res.ok === res.total) {
        toast(`${res.ok} MAC${res.ok !== 1 ? 's' : ''} registrada${res.ok !== 1 ? 's' : ''} correctamente`, { type: 'success' });
      } else {
        toast(`${res.ok}/${res.total} MACs registradas. ${res.errores.length} error${res.errores.length !== 1 ? 'es' : ''}`, { type: 'warning' });
      }
    } catch (err: any) {
      toast(err?.response?.data?.message ?? 'Error al reparar la antena', { type: 'error' });
    } finally {
      setReparandoId(null);
    }
  };

  // ── Actualización manual ────────────────────────────────────
  const [escaneando, setEscaneando] = useState(false);
  const forzarScan = async () => {
    setEscaneando(true);
    await refetch();
    setEscaneando(false);
  };

  // Combinar estado del WS con el de la BD para los nodos
  const nodosConEstadoLive = nodos.map((n) => {
    const live = mediciones.get(n.id);
    if (!live) return n;
    return {
      ...n,
      estado:        live.estado as any,
      latenciaMs:    live.latenciaMs ?? n.latenciaMs,
      perdidaPct:    live.perdidaPct,
      cpuUsoPct:     live.cpuPct    ?? n.cpuUsoPct,
      memoriaUsoPct: live.memoriaPct ?? n.memoriaUsoPct,
      traficoRxBps:  live.traficoRxBps ?? n.traficoRxBps,
      traficoTxBps:  live.traficoTxBps ?? n.traficoTxBps,
      temperaturaC:  live.temperatura  ?? n.temperaturaC,
      sesionesPppoe: live.sesionesPppoe ?? n.sesionesPppoe,
    };
  });

  // Estadísticas globales (WS override si disponible)
  const statsNodos = wsDash ?? {
    online:   nodosConEstadoLive.filter((n) => n.estado === 'online').length,
    offline:  nodosConEstadoLive.filter((n) => n.estado === 'offline').length,
    degradado: nodosConEstadoLive.filter((n) => n.estado === 'degradado').length,
    total:    nodos.length,
    latenciaAvg: 0,
    totalRxBps: 0,
    totalTxBps: 0,
    totalSesiones: 0,
    timestamp: '',
  };

  // Filtrar nodos por tipo
  const tipos = [...new Set(nodos.map((n) => n.tipo))].filter(Boolean);
  const nodosFiltrados = filtroTipo
    ? nodosConEstadoLive.filter((n) => n.tipo === filtroTipo)
    : nodosConEstadoLive;

  // Ordenar: offline primero, luego degradado, luego online
  const nodosOrdenados = [...nodosFiltrados].sort((a, b) => {
    const orden: Record<string, number> = { offline: 0, degradado: 1, desconocido: 2, online: 3 };
    return (orden[a.estado] ?? 4) - (orden[b.estado] ?? 4);
  });

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Monitoreo en tiempo real
          </h2>
          <p className="text-sm text-muted-foreground">
            {nodos.length} equipos monitoreados
            {wsDash?.timestamp && (
              <span className="ml-2 text-xs">
                · Actualizado {new Date(wsDash.timestamp).toLocaleTimeString('es-PE')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/monitoreo/alertas')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors',
              alertas.length > 0
                ? 'border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10'
                : 'border-input hover:bg-muted',
            )}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Alertas
            {alertas.length > 0 && (
              <span className="font-bold ml-0.5">{alertas.length}</span>
            )}
          </button>
          <button
            onClick={() => forzarScan()}
            disabled={escaneando}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       border border-input hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', escaneando && 'animate-spin')} />
            Escanear
          </button>
          <button
            onClick={() => router.push('/monitoreo/configuracion')}
            className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors"
          >
            <Settings className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar nodo
          </button>
        </div>
      </div>

      {/* ── Barra de estado WS + Stats globales ─────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {/* Indicador WS */}
        <div className={cn(
          'flex items-center gap-2.5 px-4 py-3 rounded-xl border',
          conectado
            ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
            : 'bg-muted border-border',
        )}>
          <span className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            conectado ? 'bg-green-500 animate-pulse-dot' : 'bg-muted-foreground',
          )} />
          <div>
            <p className="text-xs font-medium text-foreground">{conectado ? 'En vivo' : 'Reconectando'}</p>
            <p className="text-[10px] text-muted-foreground">WebSocket</p>
          </div>
        </div>

        <StatBig label="Online"    value={statsNodos.online}   color="text-green-600" />
        <StatBig label="Offline"   value={statsNodos.offline}  color="text-red-600" />
        <StatBig label="Degradado" value={statsNodos.degradado ?? 0} color="text-orange-600" />
        <div className="px-4 py-3 rounded-xl border border-border bg-card">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Tráfico total</p>
          <p className="text-base font-bold text-foreground mt-0.5">
            ↓{formatBps(wsDash?.totalRxBps ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            ↑{formatBps(wsDash?.totalTxBps ?? 0)}
            {(wsDash?.totalSesiones ?? 0) > 0 && ` · ${wsDash!.totalSesiones} PPPoE`}
          </p>
        </div>
      </div>

      {/* ── Banner de alertas críticas activas ──────────────── */}
      {alertas.length > 0 && <AlertasBanner alertas={alertas} />}

      {/* ── Filtro por tipo ──────────────────────────────────── */}
      {tipos.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFiltro('')}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 text-xs rounded-full border font-medium transition-colors',
              filtroTipo === '' ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-muted',
            )}
          >
            Todos ({nodos.length})
          </button>
          {tipos.map((tipo) => (
            <button
              key={tipo}
              onClick={() => setFiltro(tipo === filtroTipo ? '' : tipo)}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 text-xs rounded-full border font-medium transition-colors capitalize',
                filtroTipo === tipo ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-muted',
              )}
            >
              {tipo} ({nodos.filter((n) => n.tipo === tipo).length})
            </button>
          ))}
        </div>
      )}

      {/* ── Grid de nodos ────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-48 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : nodosOrdenados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Activity className="w-12 h-12 text-muted-foreground opacity-30 mb-3" />
          <p className="text-sm font-semibold text-foreground">Sin nodos registrados</p>
          <p className="text-xs text-muted-foreground mt-1">
            Agrega tu primer equipo para comenzar el monitoreo.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg
                       bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar nodo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {nodosOrdenados.map((nodo) => {
            const esAntenaAP = tipoEquipoMap.get(nodo.id) === 'ANTENA_AP';
            const estaOnline = nodo.estado === 'online';
            return (
              <NodoCard
                key={nodo.id}
                nodo={nodo}
                onClick={() => router.push(`/monitoreo/${nodo.id}`)}
                onReparar={esAntenaAP && estaOnline ? (e) => handleReparar(e, nodo.id) : undefined}
                reparando={reparandoId === nodo.id}
              />
            );
          })}
        </div>
      )}

      {/* ── Gráfico de tráfico agregado ──────────────────────── */}
      {nodos.length > 0 && (
        <TraficoChart nodos={nodosConEstadoLive} wsStats={wsDash} />
      )}

      {/* Modal agregar nodo */}
      {showAdd && (
        <DispositivoFormModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); refetch(); }}
        />
      )}
    </div>
  );
}

function StatBig({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="px-4 py-3 rounded-xl border border-border bg-card">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={cn('text-2xl font-bold mt-0.5', color)}>{value}</p>
    </div>
  );
}
