'use client';

import { useState }                        from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, AlertCircle, CheckCircle2,
  RefreshCw, Shield, Clock,
} from 'lucide-react';

import { dispositivosApi }            from '@/lib/api/monitoreo';
import type { AlertaItem }           from '@/lib/api/monitoreo';
import { formatDateTime, cn }          from '@/lib/utils';
import { useToast }                    from '@/components/ui/toaster';

const TABS = ['ACTIVA', 'RESUELTA'] as const;
type Tab = typeof TABS[number];

const NIVEL_OPTIONS = ['Todos', 'CRITICA', 'WARNING'] as const;

// ─── badge de nivel ────────────────────────────────────────────
function NivelBadge({ nivel }: { nivel: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      nivel === 'CRITICA'
        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
    )}>
      {nivel === 'CRITICA' ? <AlertCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {nivel}
    </span>
  );
}

export function AlertasSistemaContent() {
  const [tab, setTab]     = useState<Tab>('ACTIVA');
  const [nivel, setNivel] = useState('Todos');
  const { toast }         = useToast();
  const qc                = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery<{
    items: AlertaItem[]; total: number;
  }>({
    queryKey: ['monitoreo', 'alertas', tab, nivel],
    queryFn:  () => dispositivosApi.getAlertas({
      status: tab,
      nivel:  nivel !== 'Todos' ? nivel : undefined,
      limit:  100,
    }),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const { mutate: resolver, isPending: resolviendo } = useMutation({
    mutationFn: (id: string) => dispositivosApi.resolverAlerta(id),
    onSuccess: () => {
      toast('Alerta resuelta', { type: 'success' });
      qc.invalidateQueries({ queryKey: ['monitoreo', 'alertas'] });
    },
    onError: (err: any) => toast(err?.message ?? 'Error al resolver alerta', { type: 'error' }),
  });

  const alertas = data?.items ?? [];
  const critCount = alertas.filter(a => a.nivel === 'CRITICA').length;
  const warnCount = alertas.filter(a => a.nivel === 'WARNING').length;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Alertas del Sistema</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            {data?.total ?? 0} alerta{(data?.total ?? 0) !== 1 ? 's' : ''} · {tab === 'ACTIVA' ? 'activas' : 'resueltas'}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {/* ── Contadores ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <span className="text-xs text-red-300">Críticas</span>
          </div>
          <p className="text-2xl font-bold text-red-400">{critCount}</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-amber-300">Advertencias</span>
          </div>
          <p className="text-2xl font-bold text-amber-400">{warnCount}</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Shield className="h-4 w-4 text-emerald-400" />
            <span className="text-xs text-emerald-300">Estado</span>
          </div>
          <p className={cn('text-sm font-semibold mt-1', critCount > 0 ? 'text-red-400' : 'text-emerald-400')}>
            {critCount > 0 ? 'Atención requerida' : 'Sin críticas'}
          </p>
        </div>
      </div>

      {/* ── Tabs + filtro ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex border border-zinc-700 rounded-lg overflow-hidden">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors',
                tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              )}
            >
              {t === 'ACTIVA' ? 'Activas' : 'Resueltas'}
            </button>
          ))}
        </div>
        <select
          value={nivel}
          onChange={e => setNivel(e.target.value)}
          className="px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500"
        >
          {NIVEL_OPTIONS.map(n => (
            <option key={n} value={n}>{n === 'Todos' ? 'Todos los niveles' : n}</option>
          ))}
        </select>
      </div>

      {/* ── Lista de alertas ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 text-sm">
          <RefreshCw className="h-5 w-5 animate-pulse mr-2" />
          Cargando alertas...
        </div>
      ) : alertas.length === 0 ? (
        <div className="bg-zinc-800/40 border border-dashed border-zinc-700 rounded-xl p-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Sin alertas {tab === 'ACTIVA' ? 'activas' : 'resueltas'}</p>
          <p className="text-zinc-500 text-sm mt-1">
            {tab === 'ACTIVA' ? 'Todos los dispositivos operan dentro de los umbrales' : 'No hay alertas resueltas con este filtro'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {alertas.map(a => (
            <div
              key={a.id}
              className={cn(
                'bg-zinc-800/60 border rounded-xl px-4 py-3 flex items-start gap-3',
                a.nivel === 'CRITICA' ? 'border-red-500/25' : 'border-amber-500/25',
              )}
            >
              {/* Icono */}
              <div className={cn(
                'mt-0.5 shrink-0 h-7 w-7 rounded-lg flex items-center justify-center',
                a.nivel === 'CRITICA' ? 'bg-red-500/20' : 'bg-amber-500/20',
              )}>
                {a.nivel === 'CRITICA'
                  ? <AlertCircle className="h-4 w-4 text-red-400" />
                  : <AlertTriangle className="h-4 w-4 text-amber-400" />}
              </div>

              {/* Contenido */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-1.5 mb-0.5">
                  <NivelBadge nivel={a.nivel} />
                  {a.categoria && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-700 text-zinc-300">
                      {a.categoria}
                    </span>
                  )}
                  {a.dispositivo && (
                    <span className="text-xs text-zinc-400">
                      {a.dispositivo.nombreEmisor} · {a.dispositivo.ipAddress}
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-200">{a.mensaje}</p>
                {(a.valorDetectado ?? a.valorUmbral) && (
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Detectado: <span className="text-zinc-300">{a.valorDetectado}</span>
                    {a.valorUmbral && <> · Umbral: <span className="text-zinc-300">{a.valorUmbral}</span></>}
                  </p>
                )}
                <div className="flex items-center gap-1 mt-1 text-xs text-zinc-500">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(a.createdAt)}
                  {a.resueltoAt && (
                    <> · Resuelta: {formatDateTime(a.resueltoAt)}</>
                  )}
                </div>
              </div>

              {/* Acción */}
              {a.status === 'ACTIVA' && (
                <button
                  onClick={() => resolver(a.id)}
                  disabled={resolviendo}
                  className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-600/30 transition-colors disabled:opacity-50"
                >
                  Resolver
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
