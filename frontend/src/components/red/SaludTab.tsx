'use client';

import { useState }               from 'react';
import { useQuery }                from '@tanstack/react-query';
import { Activity, Thermometer, Zap, Wifi, RefreshCw, Radio } from 'lucide-react';
import { oltNativoApi }            from '@/lib/api/olt-nativo';
import { cn }                      from '@/lib/utils';

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

// oper_state del puerto PON
function ponOperColor(state: string | null): string {
  if (state === 'up')      return 'bg-emerald-500';
  if (state === 'no-onus') return 'bg-blue-400';
  if (state === 'down')    return 'bg-red-500';
  return 'bg-muted';
}
function ponOperLabel(state: string | null): string {
  if (state === 'up')      return 'UP';
  if (state === 'no-onus') return 'SIN ONUs';
  if (state === 'down')    return 'DOWN';
  return '—';
}
function ponOperTextColor(state: string | null): string {
  if (state === 'up')      return 'text-emerald-400';
  if (state === 'no-onus') return 'text-blue-400';
  if (state === 'down')    return 'text-red-400';
  return 'text-muted-foreground';
}
function ponLoadColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-yellow-400';
  return 'bg-emerald-500';
}

function fmt(v: number | null, decimals = 1, unit = '') {
  if (v == null) return '—';
  return `${v.toFixed(decimals)}${unit}`;
}

function RelTime({ iso }: { iso: string }) {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diff < 1)  return <span className="text-[10px] text-muted-foreground">ahora</span>;
  if (diff < 60) return <span className="text-[10px] text-muted-foreground">hace {diff}m</span>;
  return <span className="text-[10px] text-muted-foreground">hace {Math.round(diff / 60)}h</span>;
}

export function SaludTab({ oltId }: Props) {
  const [selectedSlot, setSelectedSlot] = useState<number | undefined>(undefined);

  const boardsQ = useQuery({
    queryKey:       ['olt-health-boards', oltId],
    queryFn:        () => oltNativoApi.healthBoards(oltId),
    staleTime:      4 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const pomQ = useQuery({
    queryKey:       ['olt-health-pom', oltId],
    queryFn:        () => oltNativoApi.healthPom(oltId),
    staleTime:      14 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const boards = boardsQ.data ?? [];
  const poms   = pomQ.data   ?? [];

  // Detectar slots con tarjetas GPON: prefijo GP/XP (dedicadas) o patrón CG (combo Huawei)
  const gponSlots = boards
    .filter((b) => /GP|CG|GPON/i.test(b.boardType ?? ''))
    .map((b) => b.slot)
    .sort((a, b) => a - b);

  const effectiveSlot = selectedSlot ?? gponSlots[0];

  const ponPortsQ = useQuery({
    queryKey:       ['olt-health-pon-ports', oltId, effectiveSlot],
    queryFn:        () => oltNativoApi.healthPonPorts(oltId, effectiveSlot),
    enabled:        effectiveSlot !== undefined,
    staleTime:      9 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const ponPorts = ponPortsQ.data ?? [];

  return (
    <div className="space-y-6">

      {/* ── Sección 1: Boards ─────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Boards / Slots</h4>
            <span className="text-xs text-muted-foreground">({boards.length} slots)</span>
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

      {/* ── Sección 2: Puertos PON (GPON) ─────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-blue-400" />
            <h4 className="text-sm font-semibold text-foreground">Puertos PON</h4>
            {ponPorts.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ({ponPorts.filter((p) => p.operState === 'up').length} activos
                / {ponPorts.length} puertos)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {ponPortsQ.isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            {/* Selector de slot GPON */}
            {gponSlots.length > 1 && (
              <div className="flex gap-1">
                {gponSlots.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSelectedSlot(s)}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded border font-mono transition-colors',
                      effectiveSlot === s
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50',
                    )}
                  >
                    Slot {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {gponSlots.length === 0 && !boardsQ.isLoading ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No se detectaron slots GPON en los boards.</p>
          </div>
        ) : ponPortsQ.isLoading || (effectiveSlot === undefined) ? (
          <div className="space-y-1.5">
            {[...Array(6)].map((_, i) => <div key={i} className="h-8 rounded bg-muted/40 animate-pulse" />)}
          </div>
        ) : ponPorts.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>Sin datos de puertos PON. El cron corre cada 15 minutos.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground w-14">Puerto</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Tipo</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Estado</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">ONUs</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden md:table-cell w-28">Carga</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Capturado</th>
                </tr>
              </thead>
              <tbody>
                {ponPorts.map((p) => {
                  const cap  = p.onuCapacity ?? 128;
                  const pct  = cap > 0 ? Math.round(((p.onusOnline ?? 0) / cap) * 100) : 0;
                  const offline = p.onusOffline ?? 0;
                  return (
                    <tr key={`${p.slot}-${p.port}`}
                      className="border-b border-border last:border-0 hover:bg-muted/20">
                      {/* Puerto */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', ponOperColor(p.operState))} />
                          <span className="font-mono text-xs text-foreground">P{p.port}</span>
                        </div>
                      </td>
                      {/* Tipo */}
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {p.portType ?? '—'}
                        </span>
                      </td>
                      {/* Estado */}
                      <td className="px-3 py-2">
                        <span className={cn('text-[10px] font-semibold', ponOperTextColor(p.operState))}>
                          {ponOperLabel(p.operState)}
                        </span>
                      </td>
                      {/* ONUs */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-foreground font-medium">
                            {p.onusOnline ?? 0}/{p.onusTotal ?? 0}
                          </span>
                          {offline > 0 && (
                            <span className="text-red-400 text-[10px]">({offline} off)</span>
                          )}
                        </div>
                      </td>
                      {/* Carga */}
                      <td className="px-3 py-2 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden w-20">
                            <div
                              className={cn('h-full rounded-full transition-all', ponLoadColor(pct))}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                      {/* Capturado */}
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <RelTime iso={p.capturedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Leyenda */}
        {ponPorts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            <span><span className="text-emerald-400 font-medium">●</span> UP (con ONUs)</span>
            <span><span className="text-blue-400 font-medium">●</span> Activo sin ONUs</span>
            <span><span className="text-red-400 font-medium">●</span> DOWN</span>
            <span className="ml-auto">Carga = online / capacidad máxima</span>
          </div>
        )}
      </div>

      {/* ── Sección 3: POM ────────────────────────────────────── */}
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
                  const txSt    = pomTxState(p.txDbm);
                  const rxSt    = pomRxState(p.rxDbm);
                  const tmpSt   = tempState(p.tempCelsius);
                  const worstSt = [txSt, rxSt, tmpSt].includes('critical') ? 'critical'
                    : [txSt, rxSt, tmpSt].includes('warn') ? 'warn' : 'ok';
                  return (
                    <tr key={`${p.slot}-${p.port}`}
                      className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATE_DOT[worstSt])} />
                          <span className="font-mono text-xs text-foreground">{p.slot}/{p.port}</span>
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
