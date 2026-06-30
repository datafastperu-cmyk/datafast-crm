'use client';

import { useQuery }              from '@tanstack/react-query';
import { Activity, Thermometer, Zap, Wifi, RefreshCw } from 'lucide-react';
import { oltNativoApi }          from '@/lib/api/olt-nativo';
import { cn }                    from '@/lib/utils';

interface Props { oltId: string; }

// ── Umbrales POM ──────────────────────────────────────────────
function pomTxState(dbm: number | null): 'ok' | 'warn' | 'critical' | 'na' {
  if (dbm == null) return 'na';
  if (dbm < -6)    return 'critical';
  if (dbm < -3)    return 'warn';
  return 'ok';
}
function pomRxState(dbm: number | null): 'ok' | 'warn' | 'critical' | 'na' {
  if (dbm == null) return 'na';
  if (dbm < -30)   return 'critical';
  if (dbm < -27)   return 'warn';
  return 'ok';
}
function tempState(c: number | null): 'ok' | 'warn' | 'critical' | 'na' {
  if (c == null) return 'na';
  if (c > 80)    return 'critical';
  if (c > 70)    return 'warn';
  return 'ok';
}

const STATE_DOT: Record<string, string> = {
  ok:       'bg-emerald-500',
  warn:     'bg-yellow-400',
  critical: 'bg-red-500',
  na:       'bg-muted',
};

const STATE_TEXT: Record<string, string> = {
  ok:       'text-emerald-400',
  warn:     'text-yellow-400',
  critical: 'text-red-400',
  na:       'text-muted-foreground',
};

const BOARD_STATE_COLOR: Record<string, string> = {
  normal:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  fault:   'bg-red-500/15 text-red-400 border-red-500/30',
  absent:  'bg-muted/40 text-muted-foreground border-border',
  standby: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
};

function fmt(v: number | null, decimals = 1, unit = '') {
  if (v == null) return '—';
  return `${v.toFixed(decimals)}${unit}`;
}

function RelTime({ iso }: { iso: string }) {
  const d = new Date(iso);
  const diff = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diff < 1)  return <span className="text-[10px] text-muted-foreground">ahora</span>;
  if (diff < 60) return <span className="text-[10px] text-muted-foreground">hace {diff}m</span>;
  return <span className="text-[10px] text-muted-foreground">hace {Math.round(diff / 60)}h</span>;
}

export function SaludTab({ oltId }: Props) {
  const boardsQ = useQuery({
    queryKey:  ['olt-health-boards', oltId],
    queryFn:   () => oltNativoApi.healthBoards(oltId),
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const pomQ = useQuery({
    queryKey:  ['olt-health-pom', oltId],
    queryFn:   () => oltNativoApi.healthPom(oltId),
    staleTime: 14 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const boards = boardsQ.data ?? [];
  const poms   = pomQ.data   ?? [];

  return (
    <div className="space-y-6">

      {/* Boards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Boards / Slots</h4>
            <span className="text-xs text-muted-foreground">({boards.length} slots con datos)</span>
          </div>
          {boardsQ.isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>

        {boardsQ.isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />)}
          </div>
        ) : boards.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>Sin datos de boards. El cron corre cada 5 minutos.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {boards.map((b) => (
              <div key={b.slot}
                className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    Slot {b.slot}
                  </span>
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded border uppercase',
                    BOARD_STATE_COLOR[b.boardState ?? 'absent'] ?? BOARD_STATE_COLOR['absent'],
                  )}>
                    {b.boardState ?? 'desconocido'}
                  </span>
                </div>
                <p className="text-[11px] text-foreground font-mono">{b.boardType ?? '—'}</p>
                <div className="flex gap-3 text-[11px]">
                  <span className="text-emerald-400">{b.onusOnline ?? 0} online</span>
                  <span className="text-muted-foreground">{b.onusOffline ?? 0} off</span>
                  <span className="text-muted-foreground/60">/{b.onuCapacity ?? '?'}</span>
                </div>
                <RelTime iso={b.capturedAt} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* POM */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-orange-400" />
            <h4 className="text-sm font-semibold text-foreground">POM — Potencia óptica por puerto</h4>
            <span className="text-xs text-muted-foreground">({poms.length} puertos)</span>
          </div>
          {pomQ.isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>

        {pomQ.isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}
          </div>
        ) : poms.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>Sin datos POM. El cron corre cada 15 minutos.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Puerto</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Temp</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Tx (dBm)</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Rx (dBm)</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Láser (mA)</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Capturado</th>
                </tr>
              </thead>
              <tbody>
                {poms.map((p) => {
                  const txSt   = pomTxState(p.txDbm);
                  const rxSt   = pomRxState(p.rxDbm);
                  const tmpSt  = tempState(p.tempCelsius);
                  const worstSt = [txSt, rxSt, tmpSt].includes('critical') ? 'critical'
                    : [txSt, rxSt, tmpSt].includes('warn') ? 'warn' : 'ok';
                  return (
                    <tr key={`${p.slot}-${p.port}`}
                      className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATE_DOT[worstSt])} />
                          <span className="font-mono text-xs text-foreground">
                            {p.slot}/{p.port}
                          </span>
                        </div>
                      </td>
                      <td className={cn('px-3 py-2 text-xs', STATE_TEXT[tmpSt])}>
                        {fmt(p.tempCelsius, 1, '°C')}
                      </td>
                      <td className={cn('px-3 py-2 text-xs', STATE_TEXT[txSt])}>
                        {fmt(p.txDbm, 2)}
                      </td>
                      <td className={cn('px-3 py-2 text-xs', STATE_TEXT[rxSt])}>
                        {fmt(p.rxDbm, 2)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">
                        {fmt(p.laserMa, 2)}
                      </td>
                      <td className="px-3 py-2">
                        <RelTime iso={p.capturedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Leyenda umbrales */}
        {poms.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            <span><span className="text-emerald-400 font-medium">●</span> OK</span>
            <span><span className="text-yellow-400 font-medium">●</span> Warn (Tx&lt;-3 | Rx&lt;-27 | T&gt;70°C)</span>
            <span><span className="text-red-400 font-medium">●</span> Crítico (Tx&lt;-6 | Rx&lt;-30 | T&gt;80°C)</span>
          </div>
        )}
      </div>

    </div>
  );
}
