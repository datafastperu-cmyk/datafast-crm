'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient }  from '@tanstack/react-query';
import { io, Socket }                from 'socket.io-client';
import {
  Radio, RefreshCw, Server, Signal,
  Wifi, WifiOff, Activity,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';

import { oltNativoApi, type OltConProveedorPrincipal, type OltDispositivo } from '@/lib/api/olt-nativo';
import { type OnuFilters, type CalidadSenal }  from '@/lib/api/red-onus';
import type { LiveSenalMap }                  from '@/components/red/onus/OnuTable';
import { getAccessToken } from '@/lib/api';
import { cn }             from '@/lib/utils';
import { ScrollableTabs } from '@/components/ui/ScrollableTabs';
import { OnuFilterBar }   from '@/components/red/onus/OnuFilterBar';
import { OnuBulkBar }     from '@/components/red/onus/OnuBulkBar';
import { OnuTable }       from '@/components/red/onus/OnuTable';

// ─── Constants ────────────────────────────────────────────────

const oltEstadoColors: Record<string, string> = {
  online:        'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  offline:       'bg-red-500/15 text-red-400 border-red-500/30',
  mantenimiento: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  desconocido:   'bg-muted/40 text-muted-foreground border-border',
};

const HEALTH_DOT: Record<string, string> = {
  ok:      'bg-emerald-500',
  degraded:'bg-yellow-400',
  down:    'bg-red-500',
  unknown: 'bg-gray-400',
};

const SECCION_BADGE: Record<string, { label: string; cls: string }> = {
  nativo_ssh:  { label: 'SSH',      cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
  nativo_snmp: { label: 'SNMP',     cls: 'bg-teal-500/10 text-teal-400 border-teal-500/20' },
  smartolt:    { label: 'SmartOLT', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  adminolt:    { label: 'AdminOLT', cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
};

function seccionDe(olt: OltConProveedorPrincipal): string {
  return olt.proveedorPrincipal?.tipo ?? olt.metodoConexion ?? 'desconocido';
}

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return `${window.location.protocol}//${window.location.host}`;
}

type TabKey = 'olts' | 'onus' | 'signal';

// ─── Component ────────────────────────────────────────────────

export function RedOltContent() {
  const qc = useQueryClient();

  const [tab,          setTab]          = useState<TabKey>('olts');
  const [oltSortField, setOltSortField] = useState('nombre');
  const [oltSortDir,   setOltSortDir]   = useState<'ASC' | 'DESC'>('ASC');
  const [signalOltId,  setSignalOltId]  = useState('');
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [liveSenales,  setLiveSenales]  = useState<LiveSenalMap>(new Map());
  const [onuTotal,     setOnuTotal]     = useState(0);

  const [filters, setFilters] = useState<OnuFilters>({ page: 1, limit: 50 });

  // ── WebSocket /olt namespace para eventos batch señal ────────
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return undefined;

    const socket = io(`${getWsUrl()}/olt`, {
      auth:                 { token },
      transports:           ['websocket', 'polling'],
      reconnection:         true,
      reconnectionDelay:    3000,
      reconnectionAttempts: 5,
    });

    socketRef.current = socket;

    socket.on('onu:señal', (payload: {
      sn: string; rxPower: number | null; txPower: number | null;
      temperatura: number | null; calidadSenal: CalidadSenal;
    }) => {
      setLiveSenales(prev => {
        const next = new Map(prev);
        next.set(payload.sn, {
          rxPower:     payload.rxPower,
          txPower:     payload.txPower,
          temperatura: payload.temperatura,
          calidadSenal: payload.calidadSenal,
        });
        return next;
      });
    });

    socket.on('bulk:señal:completado', () => {
      qc.invalidateQueries({ queryKey: ['red-onus'] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Señal update callback (from individual row refresh) ──────
  const handleSenalUpdate = useCallback((
    sn: string, rx: number | null, tx: number | null, temp: number | null,
  ) => {
    const calidad: CalidadSenal = rx == null ? 'sin_datos'
      : rx >= -23 ? 'buena'
      : rx >= -27 ? 'marginal' : 'critica';
    setLiveSenales(prev => {
      const next = new Map(prev);
      next.set(sn, { rxPower: rx, txPower: tx, temperatura: temp, calidadSenal: calidad });
      return next;
    });
  }, []);

  // ── Sort handlers OLTs ───────────────────────────────────────
  function handleOltSort(field: string) {
    if (oltSortField === field) setOltSortDir(d => d === 'ASC' ? 'DESC' : 'ASC');
    else { setOltSortField(field); setOltSortDir('ASC'); }
  }
  function SortIcon({ field, sf, sd }: { field: string; sf: string; sd: 'ASC' | 'DESC' }) {
    if (sf !== field) return <ChevronsUpDown className="w-3 h-3 opacity-30 group-hover:opacity-70 flex-shrink-0" />;
    return sd === 'ASC'
      ? <ChevronUp   className="w-3 h-3 text-primary flex-shrink-0" />
      : <ChevronDown className="w-3 h-3 text-primary flex-shrink-0" />;
  }

  // ── Queries ──────────────────────────────────────────────────
  const { data: todasOlts = [], isLoading: loadingOlts, refetch: refetchOlts } = useQuery({
    queryKey:  ['olt-todas'],
    queryFn:   oltNativoApi.listarTodas,
    staleTime: 30_000,
    enabled:   tab === 'olts',
  });

  const { data: oltNativas = [] } = useQuery({
    queryKey:  ['olt-nativas'],
    queryFn:   oltNativoApi.listar,
    staleTime: 60_000,
    enabled:   tab === 'signal',
  });

  const { data: signalData = [], isLoading: loadingSignal, refetch: refetchSignal } = useQuery({
    queryKey:  ['ftth-signal', signalOltId],
    queryFn:   () => oltNativoApi.ftthSignalDashboard(signalOltId),
    enabled:   tab === 'signal' && !!signalOltId,
    staleTime: 60_000,
    retry:     false,
  });

  // ── Sorted OLTs ──────────────────────────────────────────────
  const sortedOlts = useMemo(() => {
    return [...todasOlts].sort((a, b) => {
      const av = String(((a as unknown as Record<string, unknown>)[oltSortField]) ?? '').toLowerCase();
      const bv = String(((b as unknown as Record<string, unknown>)[oltSortField]) ?? '').toLowerCase();
      if (av < bv) return oltSortDir === 'ASC' ? -1 : 1;
      if (av > bv) return oltSortDir === 'ASC' ?  1 : -1;
      return 0;
    });
  }, [todasOlts, oltSortField, oltSortDir]);

  const onlineCount  = todasOlts.filter(o => o.estado === 'online').length;
  const offlineCount = todasOlts.filter(o => o.estado === 'offline').length;

  // ── Selection helpers ────────────────────────────────────────
  const onToggle    = useCallback((sn: string) => setSelected(s => { const n = new Set(s); n.has(sn) ? n.delete(sn) : n.add(sn); return n; }), []);
  const onSelectAll = useCallback((sns: string[]) => setSelected(new Set(sns)), []);
  const onClearAll  = useCallback(() => setSelected(new Set()), []);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">OLTs — Vista Unificada</h2>
          <p className="text-sm text-muted-foreground">
            {todasOlts.length} OLTs · {onlineCount} online · {offlineCount} offline
          </p>
        </div>
        <button
          onClick={() => tab === 'olts' ? refetchOlts() : undefined}
          aria-label="Actualizar"
          className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total OLTs', value: todasOlts.length,  color: 'text-foreground' },
          { label: 'Online',     value: onlineCount,         color: onlineCount  > 0 ? 'text-emerald-500' : 'text-muted-foreground' },
          { label: 'Offline',    value: offlineCount,        color: offlineCount > 0 ? 'text-red-500' : 'text-muted-foreground' },
          { label: 'Total ONUs', value: onuTotal || '—',    color: 'text-blue-500' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
            <p className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <ScrollableTabs className="flex gap-1 border-b border-border pb-0">
        {([
          ['olts',   'OLTs',       Server],
          ['onus',   'ONUs',       Signal],
          ['signal', 'Señal FTTH', Activity],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key as TabKey)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </ScrollableTabs>

      {/* ── Tab: OLTs ───────────────────────────────────────── */}
      {tab === 'olts' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loadingOlts ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Cargando OLTs...
            </div>
          ) : todasOlts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Radio className="w-10 h-10 opacity-30" />
              <p className="text-sm">No hay OLTs registradas</p>
              <p className="text-xs">
                Agrega OLTs en{' '}
                <a href="/configuracion/olts" className="text-primary hover:underline">Configuración → OLTs Nativas</a>.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {([
                      { field: 'nombre',     label: 'OLT'        },
                      { field: '_seccion',   label: 'Sección'    },
                      { field: 'ipGestion',  label: 'IP Gestión' },
                      { field: 'estado',     label: 'Estado'     },
                      { field: '_health',    label: 'Health'     },
                      { field: 'onusActivas',label: 'ONUs'       },
                    ] as const).map(({ field, label }) => (
                      <th
                        key={field}
                        onClick={() => handleOltSort(field)}
                        className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none group"
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          <SortIcon field={field} sf={oltSortField} sd={oltSortDir} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedOlts.map((olt: OltConProveedorPrincipal) => {
                    const sec   = seccionDe(olt);
                    const badge = SECCION_BADGE[sec];
                    const pp    = olt.proveedorPrincipal;
                    return (
                      <tr key={olt.id} className="hover:bg-accent/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{olt.nombre}</div>
                          <div className="text-xs text-muted-foreground">
                            {olt.marca.toUpperCase()}{olt.modelo ? ` · ${olt.modelo}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {badge ? (
                            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border', badge.cls)}>
                              {badge.label}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{olt.ipGestion ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border', oltEstadoColors[olt.estado] ?? oltEstadoColors.desconocido)}>
                            {olt.estado === 'online' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                            {olt.estado}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {pp ? (
                            <div className="flex items-center gap-1.5">
                              <span className={cn('w-2 h-2 rounded-full shrink-0', HEALTH_DOT[pp.healthEstado] ?? 'bg-gray-400')} />
                              <span className="text-xs text-muted-foreground">{pp.healthEstado}</span>
                              {pp.healthLatenciaMs !== null && (
                                <span className="text-[10px] text-muted-foreground/60">{pp.healthLatenciaMs}ms</span>
                              )}
                            </div>
                          ) : <span className="text-xs text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">{olt.onusActivas}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: ONUs (unificado ERP) ────────────────────────── */}
      {tab === 'onus' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <OnuFilterBar
            filters={filters}
            onChange={(f) => { setFilters(f); setSelected(new Set()); }}
            totalOnus={onuTotal}
          />
          <OnuBulkBar
            selected={selected}
            onClearAll={onClearAll}
            empresaId=""
          />
          <OnuTable
            filters={filters}
            selected={selected}
            onToggle={onToggle}
            onSelectAll={onSelectAll}
            onClearAll={onClearAll}
            onSenalUpdate={handleSenalUpdate}
            liveSenales={liveSenales}
            onTotalChange={setOnuTotal}
          />
        </div>
      )}

      {/* ── Tab: Señal FTTH ──────────────────────────────────── */}
      {tab === 'signal' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <select
              value={signalOltId}
              onChange={e => setSignalOltId(e.target.value)}
              className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— Selecciona una OLT —</option>
              {oltNativas.map((o: OltDispositivo) => (
                <option key={o.id} value={o.id}>{o.nombre} ({o.ipGestion})</option>
              ))}
            </select>
            {signalOltId && (
              <button onClick={() => refetchSignal()} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
                <RefreshCw className={cn('w-3.5 h-3.5', loadingSignal && 'animate-spin')} /> Actualizar
              </button>
            )}
          </div>
          {!signalOltId && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Activity className="w-10 h-10 opacity-30" />
              <p className="text-sm">Selecciona una OLT para ver el dashboard de señal FTTH</p>
            </div>
          )}
          {signalOltId && loadingSignal && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Consultando señal…
            </div>
          )}
          {signalOltId && !loadingSignal && signalData.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Activity className="w-8 h-8 opacity-30" />
              <p className="text-sm">Sin ONUs FTTH activas en esta OLT</p>
            </div>
          )}
          {signalData.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Serial</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Posición</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">VLAN</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Estado OLT</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Rx Power</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Tx Power</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Temp °C</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {signalData.map((item) => {
                      const r   = item.registro;
                      const sig = item.signal;
                      const rxNum = sig?.rx_power_dbm ?? null;
                      const rxCls = rxNum == null ? 'text-muted-foreground'
                        : rxNum < -27 ? 'text-red-400' : rxNum < -24 ? 'text-amber-400' : 'text-emerald-400';
                      return (
                        <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs font-semibold">{r.sn}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.slot}/{r.port}/{r.onuId}</td>
                          <td className="px-4 py-3 text-xs">{r.vlan}</td>
                          <td className="px-4 py-3">
                            {sig ? (
                              <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs', sig.run_state === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                                {sig.run_state}
                              </span>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {rxNum != null ? <span className={cn('font-mono text-xs', rxCls)}>{rxNum.toFixed(1)} dBm</span> : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {sig?.tx_power_dbm != null ? <span className="font-mono text-xs text-blue-400">{sig.tx_power_dbm.toFixed(1)} dBm</span> : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {sig?.temperature_c != null ? <span className="font-mono text-xs">{sig.temperature_c.toFixed(0)} °C</span> : <span className="text-muted-foreground text-xs">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

