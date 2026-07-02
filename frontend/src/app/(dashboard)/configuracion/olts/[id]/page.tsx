'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Cpu, RefreshCw, Loader2,
  Settings, Activity, Network, Users, Server, Zap,
  Plug, Share2, Gauge, AlertTriangle,
} from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { useOltSocket } from '@/hooks/useOltSocket';
import { cn } from '@/lib/utils';

// ── Tab imports ──────────────────────────────────────────────────
import { TabDetalles }   from '@/components/olt/TabDetalles';
import { TabEventos }    from '@/components/olt/TabEventos';
import { TabVlans }      from '@/components/olt/TabVlans';
import { TabProfiles }   from '@/components/olt/TabProfiles';
import { TabOnus }       from '@/components/olt/TabOnus';
import { TabFirmware }   from '@/components/olt/TabFirmware';
import { ProveedoresTab } from '@/components/red/ProveedoresTab';
import { TrafficTablesSection } from '@/components/red/TopologiaTab';
import { SaludTab }       from '@/components/red/SaludTab';
import { DeleteOltModal }  from '@/components/red/DeleteOltModal';

// ─── Tabs ────────────────────────────────────────────────────────

type TabId = 'detalles' | 'eventos' | 'vlans' | 'profiles' | 'onus' | 'firmware'
           | 'proveedores' | 'traffic' | 'salud';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'detalles',    label: 'Detalles',    icon: <Settings       className="w-3.5 h-3.5" /> },
  { id: 'vlans',       label: 'VLANs',       icon: <Network        className="w-3.5 h-3.5" /> },
  { id: 'profiles',    label: 'Perfiles',    icon: <Server         className="w-3.5 h-3.5" /> },
  { id: 'onus',        label: 'ONUs',        icon: <Users          className="w-3.5 h-3.5" /> },
  { id: 'firmware',    label: 'Firmware',    icon: <Zap            className="w-3.5 h-3.5" /> },
  { id: 'proveedores', label: 'Proveedores', icon: <Plug           className="w-3.5 h-3.5" /> },
  { id: 'traffic',     label: 'Traffic Tables', icon: <Share2      className="w-3.5 h-3.5" /> },
  { id: 'salud',       label: 'Salud',       icon: <Gauge          className="w-3.5 h-3.5" /> },
  { id: 'eventos',     label: 'Eventos',     icon: <Activity       className="w-3.5 h-3.5" /> },
];

const MARCA_COLOR: Record<string, string> = {
  huawei: 'bg-red-500/10 text-red-400 border-red-500/20',
  zte:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  vsol:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
  cdata:  'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

const ESTADO_COLOR: Record<string, string> = {
  online:        'bg-emerald-500/10 text-emerald-400',
  offline:       'bg-red-500/10 text-red-400',
  mantenimiento: 'bg-yellow-500/10 text-yellow-400',
  desconocido:   'bg-muted text-muted-foreground',
};

// ─────────────────────────────────────────────────────────────────

export default function OltDetallePage() {
  const { id }      = useParams<{ id: string }>();
  const router      = useRouter();
  const qc          = useQueryClient();
  const { toast }   = useToast();
  const [tab,         setTab]         = useState<TabId>('detalles');
  const [deleteOpen,  setDeleteOpen]  = useState(false);

  // ── OLT base ────────────────────────────────────────────────────
  const { data: olt, isLoading } = useQuery({
    queryKey: ['olt-detalle', id],
    queryFn:  () => oltNativoApi.findOne(id),
    enabled:  !!id,
  });

  // ── WebSocket sync progress ──────────────────────────────────────
  const { sync, resetSync } = useOltSocket(id, {
    onCompleted: () => {
      qc.invalidateQueries({ queryKey: ['olt-boards', id] });
      qc.invalidateQueries({ queryKey: ['olt-line-profiles', id] });
      qc.invalidateQueries({ queryKey: ['olt-service-profiles', id] });
      qc.invalidateQueries({ queryKey: ['olt-vlans', id] });
      qc.invalidateQueries({ queryKey: ['olt-traffic-tables', id] });
      toast('Sincronización completada', { type: 'success' });
    },
    onError: (e) => toast(`Error de sincronización: ${e.error}`, { type: 'error' }),
  });

  // ── Sync mutation ────────────────────────────────────────────────
  const syncMut = useMutation({
    mutationFn: () => oltNativoApi.iniciarSync(id),
    onError: (err: any) => toast(`Error al iniciar sync: ${err?.message}`, { type: 'error' }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!olt) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <p className="text-muted-foreground">OLT no encontrada</p>
        <button onClick={() => router.back()} className="text-sm text-primary hover:underline">
          Volver
        </button>
      </div>
    );
  }

  const isSyncing = sync.fase === 'running' || syncMut.isPending;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">

      {/* ── Breadcrumb + Header ──────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.back()}
            className="mt-0.5 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => router.push('/configuracion/olts')}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                OLTs
              </button>
              <span className="text-xs text-muted-foreground/40">/</span>
              <span className="text-xs text-foreground font-medium">{olt.nombre}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">{olt.nombre}</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn(
                    'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border uppercase',
                    MARCA_COLOR[olt.marca] ?? 'bg-muted text-muted-foreground border-border',
                  )}>
                    {olt.marca}
                  </span>
                  {olt.modelo && (
                    <span className="text-xs text-muted-foreground">{olt.modelo}</span>
                  )}
                  <span className={cn(
                    'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium capitalize',
                    ESTADO_COLOR[olt.estado] ?? 'bg-muted text-muted-foreground',
                  )}>
                    {olt.estado}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">{olt.ipGestion}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Botones Sincronizar + Eliminar */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 text-red-400
                       hover:bg-red-500/10 transition-colors text-sm font-medium"
          >
            <AlertTriangle className="w-4 h-4" />
            Eliminar OLT
          </button>
          <button
            onClick={() => { resetSync(); syncMut.mutate(); }}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground
                       hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-60"
          >
            {isSyncing
              ? <><Loader2 className="w-4 h-4 animate-spin" />Sincronizando…</>
              : <><RefreshCw className="w-4 h-4" />Sincronizar</>
            }
          </button>
          </div>
          {/* Progress bar de sync */}
          {sync.fase === 'running' && (
            <div className="w-48">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                <span>{sync.etapa}</span>
                <span>{sync.progreso}%</span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${sync.progreso}%` }}
                />
              </div>
            </div>
          )}
          {sync.fase === 'completed' && (
            <p className="text-[11px] text-emerald-400">Sincronización completada</p>
          )}
          {sync.fase === 'failed' && (
            <p className="text-[11px] text-red-400">Error: {sync.error}</p>
          )}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-border pb-0 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md whitespace-nowrap transition-colors border-b-2 -mb-px',
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      <div>
        {tab === 'detalles'    && <TabDetalles   olt={olt} oltId={id} />}
        {tab === 'vlans'       && <TabVlans      oltId={id} />}
        {tab === 'profiles'    && <TabProfiles   oltId={id} />}
        {tab === 'onus'        && <TabOnus       oltId={id} />}
        {tab === 'firmware'    && <TabFirmware   oltId={id} />}
        {tab === 'proveedores' && <ProveedoresTab oltId={id} />}
        {tab === 'traffic'     && <TrafficTablesSection oltId={id} />}
        {tab === 'salud'       && <SaludTab      oltId={id} />}
        {tab === 'eventos'     && <TabEventos    oltId={id} />}
      </div>

      <DeleteOltModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        oltId={id}
        oltNombre={olt.nombre}
        onDeleted={() => router.push('/configuracion/olts')}
      />
    </div>
  );
}
