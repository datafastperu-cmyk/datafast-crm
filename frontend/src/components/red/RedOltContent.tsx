'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient }  from '@tanstack/react-query';
import { io, Socket }                from 'socket.io-client';
import {
  Radio, RefreshCw, Server, Signal,
  Wifi, WifiOff, Plus, Cpu, Cloud, ChevronRight, X,
  ChevronUp, ChevronDown, ChevronsUpDown, Trash2, Zap, Loader2,
} from 'lucide-react';

import { oltNativoApi, type OltConProveedorPrincipal } from '@/lib/api/olt-nativo';
import { mikrotikApi } from '@/lib/api/mikrotik';
import { useToast } from '@/components/ui/toaster';
import { OltWizardNativoModal } from '@/components/red/OltWizardNativoModal';
import { CrearOltModal } from '@/components/red/CrearOltModal';
import { DeleteOltModal } from '@/components/red/DeleteOltModal';
import { type OnuFilters, type CalidadSenal }  from '@/lib/api/red-onus';
import type { LiveSenalMap }                  from '@/components/red/onus/OnuTable';
import { getAccessToken } from '@/lib/api';
import { cn }             from '@/lib/utils';
import { ScrollableTabs } from '@/components/ui/ScrollableTabs';
import { OnuFilterBar }   from '@/components/red/onus/OnuFilterBar';
import { OnuBulkBar }     from '@/components/red/onus/OnuBulkBar';
import { OnuTable }       from '@/components/red/onus/OnuTable';
import { OnuInventarioUnificado } from '@/components/red/onus/OnuInventarioUnificado';

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

// ─── Modal selector de proveedor ──────────────────────────────
type ProveedorTipo = 'nativo' | 'smartolt' | 'adminolt';

function SelectorProveedorModal({
  open, onClose, onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (_tipo: ProveedorTipo) => void;
}) {
  if (!open) return null;
  const opciones: Array<{
    tipo: ProveedorTipo; label: string; desc: string; Icon: typeof Cpu; disabled: boolean;
  }> = [
    { tipo: 'nativo',   label: 'Aprovisionamiento Nativo', desc: 'Control directo por SSH/SNMP (Huawei, ZTE, V-SOL, C-Data).', Icon: Cpu,   disabled: false },
    { tipo: 'smartolt', label: 'SmartOLT',                 desc: 'Integración con la API de SmartOLT.',                       Icon: Cloud, disabled: false },
    { tipo: 'adminolt', label: 'AdminOLT',                 desc: 'Integración con la API de AdminOLT.',                       Icon: Cloud, disabled: false },
  ];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Agregar OLT — elegir proveedor</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {opciones.map(({ tipo, label, desc, Icon, disabled }) => (
            <button
              key={tipo}
              onClick={() => !disabled && onSelect(tipo)}
              disabled={disabled}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors',
                disabled
                  ? 'border-border bg-muted/20 opacity-60 cursor-not-allowed'
                  : 'border-border hover:border-primary/50 hover:bg-primary/5',
              )}
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="w-4.5 h-4.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  {disabled && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      Próximamente
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              {!disabled && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return `${window.location.protocol}//${window.location.host}`;
}

type TabKey = 'olts' | 'onus';

// ─── Component ────────────────────────────────────────────────

export function RedOltContent() {
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();

  const [tab,          setTab]          = useState<TabKey>('onus');
  const [onuVista,     setOnuVista]     = useState<'inventario' | 'aprovisionadas'>('inventario');
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [wizardNativoOpen, setWizardNativoOpen] = useState(false);
  const [crearProveedorTipo, setCrearProveedorTipo] = useState<'smartolt' | 'adminolt' | null>(null);
  const [testingId, setTestingId]   = useState<string | null>(null);
  const [syncingId, setSyncingId]   = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; nombre: string } | null>(null);

  // Probar conexión SSH a la OLT y reflejar el estado real.
  const probarConexion = async (olt: OltConProveedorPrincipal) => {
    setTestingId(olt.id);
    try {
      const r = await oltNativoApi.testConexion(olt.id);
      toast(
        r.exitoso
          ? `Conexión OK con "${olt.nombre}"${r.latenciaMs ? ` (${r.latenciaMs}ms)` : ''}`
          : `Sin conexión con "${olt.nombre}": ${r.mensaje}`,
        { type: r.exitoso ? 'success' : 'error' },
      );
      refetchOlts();
    } catch {
      toast('Error al probar la conexión', { type: 'error' });
    } finally {
      setTestingId(null);
    }
  };

  // Fuerza la re-lectura de la OLT hacia el ERP (perfiles, VLANs, traffic-tables,
  // boards). Es fire-and-forget: iniciarSync devuelve un jobId al instante y el
  // trabajo corre en segundo plano (progreso visible en el detalle de la OLT).
  // La reconciliación de ONUs (aprovisionadas / sin aprovisionar) se hace en el
  // detalle → tab ONUs, que además clasifica su estado en vivo.
  const sincronizar = async (olt: OltConProveedorPrincipal) => {
    setSyncingId(olt.id);
    try {
      await oltNativoApi.iniciarSync(olt.id);
      toast(
        `Sincronización de "${olt.nombre}" iniciada — perfiles, VLANs y tablas de tráfico ` +
        `se actualizan desde la OLT en segundo plano.`,
        { type: 'success' },
      );
      refetchOlts();
    } catch {
      toast('Error al iniciar la sincronización', { type: 'error' });
    } finally {
      setSyncingId(null);
    }
  };

  const { data: routers = [] } = useQuery({
    queryKey: ['routers-lista'],
    queryFn:  () => mikrotikApi.listar(),
    enabled:  crearProveedorTipo !== null,
  });
  const [oltSortField, setOltSortField] = useState('nombre');
  const [oltSortDir,   setOltSortDir]   = useState<'ASC' | 'DESC'>('ASC');
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
          ['onus', 'ONUs',  Signal],
          ['olts', 'OLTs',  Server],
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
        <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Gestión de OLTs de todos los proveedores. Haz clic en una OLT para abrir su detalle.
          </p>
          <button
            onClick={() => setSelectorOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Agregar OLT
          </button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loadingOlts ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Cargando OLTs...
            </div>
          ) : todasOlts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Radio className="w-10 h-10 opacity-30" />
              <p className="text-sm">No hay OLTs registradas</p>
              <button onClick={() => setSelectorOpen(true)} className="mt-1 text-sm text-primary hover:underline">
                Agregar la primera OLT
              </button>
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
                    <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider select-none">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedOlts.map((olt: OltConProveedorPrincipal) => {
                    const sec    = seccionDe(olt);
                    const badge  = SECCION_BADGE[sec];
                    const pp     = olt.proveedorPrincipal;
                    const nativo = sec.startsWith('nativo');
                    const testing = testingId === olt.id;
                    const syncing = syncingId === olt.id;
                    return (
                      <tr
                        key={olt.id}
                        onClick={() => router.push(`/red/olt/${olt.id}`)}
                        className="transition-colors hover:bg-accent/40 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-foreground">{olt.nombre}</div>
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                          </div>
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
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {nativo && (
                              <>
                                <button
                                  onClick={() => probarConexion(olt)}
                                  disabled={testing}
                                  title="Probar conexión"
                                  className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-sky-400 hover:border-sky-700/50 hover:bg-sky-500/10 transition-colors disabled:opacity-50"
                                >
                                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={() => sincronizar(olt)}
                                  disabled={syncing}
                                  title="Sincronizar desde la OLT (perfiles, VLANs, tablas de tráfico)"
                                  className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-emerald-400 hover:border-emerald-700/50 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                                >
                                  <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => setDeleteTarget({ id: olt.id, nombre: olt.nombre })}
                              title="Eliminar OLT"
                              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-red-400 hover:border-red-700/50 hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

      {/* ── Tab: ONUs ────────────────────────────────────────── */}
      {tab === 'onus' && (
        <div className="space-y-3">
          {/* Sub-toggle: inventario completo (todas las OLTs) vs aprovisionadas (ERP) */}
          <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
            {([
              ['inventario',  'Todas (inventario)'],
              ['aprovisionadas', 'Aprovisionadas'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setOnuVista(key)}
                className={cn(
                  'px-3 py-1.5 rounded-md font-medium transition-colors',
                  onuVista === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {onuVista === 'inventario' ? (
            <div className="bg-card border border-border rounded-xl p-3">
              <OnuInventarioUnificado />
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <OnuFilterBar
                filters={filters}
                onChange={(f) => { setFilters(f); setSelected(new Set()); }}
                totalOnus={onuTotal}
              />
              <OnuBulkBar selected={selected} onClearAll={onClearAll} />
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
        </div>
      )}

      {/* ── Modales: selector proveedor + wizard nativo ──────── */}
      <SelectorProveedorModal
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        onSelect={(tipo) => {
          setSelectorOpen(false);
          if (tipo === 'nativo') setWizardNativoOpen(true);
          else setCrearProveedorTipo(tipo);
        }}
      />
      {/* El wizard invalida ['olt-todas'] al crear → la lista se refresca sola. */}
      <OltWizardNativoModal
        open={wizardNativoOpen}
        onClose={() => { setWizardNativoOpen(false); refetchOlts(); }}
      />
      {crearProveedorTipo && (
        <CrearOltModal
          tipo={crearProveedorTipo}
          routers={routers}
          onClose={() => setCrearProveedorTipo(null)}
          onSaved={() => { setCrearProveedorTipo(null); refetchOlts(); }}
        />
      )}
      <DeleteOltModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        oltId={deleteTarget?.id ?? ''}
        oltNombre={deleteTarget?.nombre ?? ''}
        onDeleted={() => { setDeleteTarget(null); refetchOlts(); }}
      />
    </div>
  );
}

