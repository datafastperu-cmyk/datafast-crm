'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Cpu, RefreshCw, Loader2,
  Settings, Activity, Network, Users, Server, Zap,
  Plug, Gauge, AlertTriangle, GitCompareArrows, Radio, ShieldCheck,
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
import { TabDrift }      from '@/components/olt/TabDrift';
import { TabCompliance } from '@/components/olt/TabCompliance';
import { TabBaseline }   from '@/components/olt/TabBaseline';
import { TabFirmware }   from '@/components/olt/TabFirmware';
import { TabTr069 }      from '@/components/olt/TabTr069';
import { ProveedoresTab } from '@/components/red/ProveedoresTab';
import { SaludTab }       from '@/components/red/SaludTab';
import { DeleteOltModal }  from '@/components/red/DeleteOltModal';

// ─── Tabs ────────────────────────────────────────────────────────

type TabId = 'detalles' | 'eventos' | 'vlans' | 'profiles' | 'onus' | 'drift' | 'firmware'
           | 'proveedores' | 'salud' | 'tr069' | 'cumplimiento';

// Orden por relevancia operativa: primero el día a día (ONUs, salud,
// correcciones), luego configuración de red, al final infraestructura/auditoría.
// "Cumplimiento" fusiona los antiguos tabs Compliance y Baseline: el baseline
// declara el estado deseado, compliance lo mide y el plan lo corrige.
const TABS: { id: TabId; label: string; icon: React.ReactNode; soloNativo?: boolean }[] = [
  { id: 'detalles',     label: 'Detalles',     icon: <Settings         className="w-3.5 h-3.5" /> },
  { id: 'onus',         label: 'ONUs',         icon: <Users            className="w-3.5 h-3.5" />, soloNativo: true },
  { id: 'salud',        label: 'Salud',        icon: <Gauge            className="w-3.5 h-3.5" /> },
  { id: 'drift',        label: 'Drift',        icon: <GitCompareArrows className="w-3.5 h-3.5" />, soloNativo: true },
  { id: 'cumplimiento', label: 'Cumplimiento', icon: <ShieldCheck      className="w-3.5 h-3.5" />, soloNativo: true },
  { id: 'vlans',        label: 'VLANs',        icon: <Network          className="w-3.5 h-3.5" />, soloNativo: true },
  { id: 'profiles',     label: 'Perfiles',     icon: <Server           className="w-3.5 h-3.5" />, soloNativo: true },
  { id: 'tr069',        label: 'TR-069',       icon: <Radio            className="w-3.5 h-3.5" />, soloNativo: true },
  { id: 'firmware',     label: 'Firmware',     icon: <Zap              className="w-3.5 h-3.5" />, soloNativo: true },
  { id: 'proveedores',  label: 'Proveedores',  icon: <Plug             className="w-3.5 h-3.5" /> },
  { id: 'eventos',      label: 'Eventos',      icon: <Activity         className="w-3.5 h-3.5" /> },
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

  // OLTs de proveedor externo (SmartOLT/AdminOLT) no exponen las operaciones SSH
  // nativas (VLANs, perfiles, ONUs en vivo, firmware): se ocultan esas tabs.
  const esNativo = (olt.metodoConexion ?? '').startsWith('nativo');
  const tabsVisibles = TABS.filter(t => esNativo || !t.soloNativo);
  const tabActual = tabsVisibles.some(t => t.id === tab) ? tab : 'detalles';

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
                onClick={() => router.push('/red/olt')}
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
        {tabsVisibles.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md whitespace-nowrap transition-colors border-b-2 -mb-px',
              tabActual === t.id
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
        {tabActual === 'detalles'    && <TabDetalles   olt={olt} oltId={id} />}
        {tabActual === 'vlans'       && <TabVlans      oltId={id} />}
        {tabActual === 'profiles'    && <TabProfiles   oltId={id} />}
        {tabActual === 'onus'        && <TabOnus       oltId={id} />}
        {tabActual === 'drift'       && <TabDrift      oltId={id} />}
        {tabActual === 'cumplimiento' && (
          <div className="space-y-8">
            <TabCompliance oltId={id} />
            <div className="border-t border-border pt-6">
              <TabBaseline oltId={id} />
            </div>
          </div>
        )}
        {tabActual === 'firmware'    && <TabFirmware   oltId={id} />}
        {tabActual === 'tr069'       && <TabTr069      oltId={id} />}
        {tabActual === 'proveedores' && <ProveedoresTab oltId={id} />}
        {tabActual === 'salud'       && <SaludTab      oltId={id} />}
        {tabActual === 'eventos'     && <TabEventos    oltId={id} />}
      </div>

      <DeleteOltModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        oltId={id}
        oltNombre={olt.nombre}
        onDeleted={() => router.push('/red/olt')}
      />
    </div>
  );
}
