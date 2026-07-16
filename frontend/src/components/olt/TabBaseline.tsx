'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookMarked, CheckCircle2, ChevronDown, Loader2, Lock, PlayCircle, Plus,
  RefreshCw, ShieldCheck, XCircle,
} from 'lucide-react';
import {
  oltNativoApi, type BaselinePlan, type BaselineAplicacionResultado, type OltBaselineItem,
} from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

// ─── Parsers del formulario (una línea por recurso) ───────────────

function parseVlans(text: string): { vlanId: number; nombre: string; uplink?: boolean; proposito?: string }[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const partes = l.split(/\s+/);
    let uplink = false, tr069 = false;
    // Tokens al final de la línea, en cualquier orden: uplink / tr069
    while (partes.length > 1) {
      const ultimo = partes[partes.length - 1].toLowerCase();
      if (ultimo === 'uplink')      { uplink = true; partes.pop(); }
      else if (ultimo === 'tr069')  { tr069 = true;  partes.pop(); }
      else break;
    }
    const [id, ...rest] = partes;
    return {
      vlanId: Number(id),
      nombre: rest.join(' ') || `VLAN_${id}`,
      // TR-069 implica uplink: sin camino al ACS la VLAN de gestión no sirve
      ...(uplink || tr069 ? { uplink: true } : {}),
      ...(tr069 ? { proposito: 'tr069' } : {}),
    };
  });
}

function parseTts(text: string): { nombre: string; cirKbps: number; pirKbps: number }[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [nombre, cir, pir] = l.split(/\s+/);
    return { nombre, cirKbps: Number(cir), pirKbps: Number(pir ?? cir) };
  });
}

// ─── Form de nueva versión ─────────────────────────────────────────

function NuevaVersionForm({ base, onCreado }: { base: OltBaselineItem | null; onCreado: () => void }) {
  const { toast } = useToast();
  const [nombre, setNombre]      = useState(base?.nombre ?? 'Datafast');
  const [descripcion, setDesc]   = useState('');
  const [vlansText, setVlans]    = useState(
    base ? base.spec.vlans.map(v =>
      `${v.vlanId} ${v.nombre}${v.proposito === 'tr069' ? ' tr069' : v.uplink ? ' uplink' : ''}`,
    ).join('\n') : '',
  );
  const [ttsText, setTts]        = useState(
    base ? base.spec.trafficTables.map(t => `${t.nombre} ${t.cirKbps} ${t.pirKbps}`).join('\n') : '',
  );
  const [uplinkPort, setUplinkPort] = useState(base?.spec.uplinkPort ?? '');

  const crear = useMutation({
    mutationFn: () => oltNativoApi.crearBaseline({
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || undefined,
      vlans: parseVlans(vlansText),
      trafficTables: parseTts(ttsText),
      uplinkPort: uplinkPort.trim() || undefined,
    }),
    onSuccess: (b) => {
      toast(`Baseline "${b.nombre}" v${b.version} creado`, { type: 'success' });
      onCreado();
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al crear baseline', { type: 'error' }),
  });

  const hayVlansUplink = parseVlans(vlansText).some(v => v.uplink);
  const valido = nombre.trim()
    && parseVlans(vlansText).every(v => v.vlanId >= 1 && v.vlanId <= 4094)
    && parseTts(ttsText).every(t => t.nombre && t.cirKbps >= 64 && t.pirKbps >= t.cirKbps)
    && (!uplinkPort.trim() || /^\d+\/\d+\/\d+$/.test(uplinkPort.trim()))
    && (!hayVlansUplink || !!uplinkPort.trim());

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2">
        <Plus className="w-4 h-4" />
        Nueva versión de baseline
        {base && <span className="text-xs font-normal text-muted-foreground">(prellenado desde {base.nombre} v{base.version})</span>}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Nombre (nombre existente → versión nueva)</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)}
            className="w-full mt-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Descripción</label>
          <input value={descripcion} onChange={e => setDesc(e.target.value)} placeholder="Qué cambia en esta versión"
            className="w-full mt-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            Puerto uplink (frame/slot/port) — requerido si alguna VLAN lleva <code>uplink</code>
          </label>
          <input value={uplinkPort} onChange={e => setUplinkPort(e.target.value)} placeholder="0/9/0"
            className="w-full mt-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50" />
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            El tagging es solo aditivo; el ERP nunca destaguea un uplink automáticamente.
          </p>
        </div>
        <div />
        <div>
          <label className="text-xs text-muted-foreground">
            VLANs — una por línea: <code>id nombre [uplink] [tr069]</code>
            <span className="block text-muted-foreground/70"><code>tr069</code> = VLAN exclusiva de gestión TR-069 (implica uplink y se registra en la config TR-069 de la OLT)</span>
          </label>
          <textarea value={vlansText} onChange={e => setVlans(e.target.value)} rows={6}
            placeholder={'100 INTERNET uplink\n1600 GESTION_TR069 tr069'}
            className="w-full mt-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Traffic tables — una por línea: <code>nombre cir_kbps pir_kbps</code></label>
          <textarea value={ttsText} onChange={e => setTts(e.target.value)} rows={6}
            placeholder={'ERP-100M 102400 102400\nERP-50M 51200 51200'}
            className="w-full mt-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50" />
        </div>
      </div>
      <button
        onClick={() => crear.mutate()}
        disabled={!valido || crear.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {crear.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookMarked className="w-3.5 h-3.5" />}
        Crear versión
      </button>
    </div>
  );
}

// ─── Panel del plan (dry-run + aplicar) ────────────────────────────

function PlanPanel({ oltId }: { oltId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [resultado, setResultado] = useState<BaselineAplicacionResultado | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const { data: plan, isLoading, refetch, isFetching, error } = useQuery<BaselinePlan>({
    queryKey: ['olt-baseline-plan', oltId],
    queryFn:  () => oltNativoApi.getBaselinePlan(oltId),
    enabled:  !!oltId,
    retry:    false,
  });

  const aplicar = useMutation({
    mutationFn: (planHash: string) => oltNativoApi.aplicarBaselinePlan(oltId, planHash),
    onSuccess: (res) => {
      setResultado(res);
      setConfirmando(false);
      toast(
        res.completado
          ? `Plan aplicado: ${res.ejecutadas} operación(es) ejecutada(s) en la OLT`
          : 'El plan se detuvo en una operación fallida — revisa el detalle',
        { type: res.completado ? 'success' : 'error' },
      );
      qc.invalidateQueries({ queryKey: ['olt-baseline-plan', oltId] });
      qc.invalidateQueries({ queryKey: ['olt-compliance', oltId] });
      qc.invalidateQueries({ queryKey: ['olt-vlans', oltId] });
    },
    onError: (e: any) => {
      setConfirmando(false);
      const status = e?.response?.status;
      toast(
        status === 409
          ? 'El estado cambió desde que se generó el plan — se regeneró, revísalo de nuevo'
          : (e?.response?.data?.message ?? 'Error al aplicar el plan'),
        { type: 'error' },
      );
      qc.invalidateQueries({ queryKey: ['olt-baseline-plan', oltId] });
    },
  });

  if (isLoading) return <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  if (error) {
    const msg = (error as any)?.response?.data?.message ?? 'No se pudo generar el plan.';
    return <p className="text-xs text-muted-foreground py-4">{msg}</p>;
  }
  if (!plan) return null;

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <PlayCircle className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">
          Plan de convergencia — {plan.baselineNombre} v{plan.baselineVersion}
        </span>
        <button onClick={() => { setResultado(null); refetch(); }} disabled={isFetching}
          className="ml-auto p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
          title="Regenerar plan (dry-run)">
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
        </button>
      </div>

      {plan.yaConverge ? (
        <p className="flex items-center gap-2 text-sm text-emerald-400">
          <ShieldCheck className="w-4 h-4" /> La OLT ya converge al baseline — nada que aplicar.
        </p>
      ) : (
        <>
          {plan.operaciones.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Operaciones que el ERP ejecutará en la OLT (dry-run — aún no se ha tocado nada):
              </p>
              {plan.operaciones.map(op => (
                <div key={op.orden} className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-xs text-muted-foreground font-mono shrink-0">#{op.orden}</span>
                    {op.detalle}
                  </div>
                  {op.comandos?.length > 0 ? (
                    <pre className="text-[11px] font-mono bg-background/60 border border-border rounded-md px-2.5 py-1.5 overflow-x-auto text-muted-foreground">
{op.comandos.join('\n')}
                    </pre>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/70 pl-6">
                      Sin comandos CLI — esta operación solo actualiza la base de datos del ERP.
                    </p>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground/70">
                Los bloques muestran los comandos CLI exactos que el ERP inyectará a la OLT
                (los <code>display</code> son verificaciones de solo lectura).
              </p>
            </div>
          )}

          {plan.bloqueos.length > 0 && (
            <div className="space-y-1.5">
              {plan.bloqueos.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-xs rounded-lg border border-amber-700/40 bg-amber-500/5 text-amber-400 px-3 py-2">
                  <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span><strong>{b.recurso}</strong>: {b.motivo}</span>
                </div>
              ))}
            </div>
          )}

          {plan.operaciones.length > 0 && (
            confirmando ? (
              <div className="flex items-center gap-2 rounded-lg border border-red-700/40 bg-red-500/5 px-3 py-2.5">
                <span className="text-xs text-red-400 flex-1">
                  Se ejecutarán {plan.operaciones.length} operación(es) reales sobre la OLT. ¿Confirmar?
                </span>
                <button onClick={() => aplicar.mutate(plan.planHash)} disabled={aplicar.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                  {aplicar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                  Sí, aplicar
                </button>
                <button onClick={() => setConfirmando(false)} disabled={aplicar.isPending}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-accent">
                  Cancelar
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmando(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                <PlayCircle className="w-3.5 h-3.5" />
                Aplicar plan ({plan.operaciones.length} operación(es))
              </button>
            )
          )}
        </>
      )}

      {resultado && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <p className="text-xs font-medium">Resultado de la última aplicación:</p>
          {resultado.resultados.map(r => (
            <div key={r.orden} className={cn(
              'flex items-start gap-2 text-xs rounded-lg border px-3 py-2',
              r.exitoso ? 'border-emerald-700/40 bg-emerald-500/5 text-emerald-400' : 'border-red-700/40 bg-red-500/5 text-red-400',
            )}>
              {r.exitoso ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
              <span>{r.detalle} → {r.mensaje}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab principal ─────────────────────────────────────────────────

export function TabBaseline({ oltId }: { oltId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mostrarForm, setMostrarForm] = useState(false);

  const { data: olt } = useQuery({
    queryKey: ['olt-detalle', oltId],
    queryFn:  () => oltNativoApi.findOne(oltId),
    enabled:  !!oltId,
  });
  const { data: baselines = [], isLoading } = useQuery({
    queryKey: ['olt-baselines'],
    queryFn:  () => oltNativoApi.getBaselines(),
  });

  const baselineId = olt?.baselineId ?? null;
  const asignado   = baselines.find(b => b.id === baselineId) ?? null;

  const asignar = useMutation({
    mutationFn: (id: string | null) => oltNativoApi.asignarBaseline(oltId, id),
    onSuccess: () => {
      toast('Baseline actualizado', { type: 'success' });
      qc.invalidateQueries({ queryKey: ['olt-detalle', oltId] });
      qc.invalidateQueries({ queryKey: ['olt-baseline-plan', oltId] });
      qc.invalidateQueries({ queryKey: ['olt-compliance', oltId] });
    },
    onError: () => toast('Error al asignar baseline', { type: 'error' }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        La OLT no se configura a mano: recibe un <strong>baseline</strong> — una definición declarativa y
        versionada de qué VLANs y traffic tables debe tener. El compliance mide la brecha y el plan la corrige
        con aprobación explícita.
      </p>

      {/* Asignación */}
      <div className="rounded-xl border border-border p-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2">
          <BookMarked className="w-4 h-4" /> Baseline asignado
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select
              value={baselineId ?? ''}
              onChange={e => asignar.mutate(e.target.value || null)}
              disabled={asignar.isPending}
              className="appearance-none bg-background border border-border rounded-lg pl-2.5 pr-8 py-1.5 text-sm focus:outline-none focus:border-primary/50 disabled:opacity-50"
            >
              <option value="">— Sin baseline —</option>
              {baselines.map(b => (
                <option key={b.id} value={b.id}>{b.nombre} v{b.version}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          </div>
          {asignar.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {asignado?.descripcion && (
            <span className="text-xs text-muted-foreground">{asignado.descripcion}</span>
          )}
          <button
            onClick={() => setMostrarForm(v => !v)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-accent"
          >
            <Plus className="w-3.5 h-3.5" />
            {mostrarForm ? 'Ocultar formulario' : 'Nueva versión'}
          </button>
        </div>
        {asignado && (
          <p className="text-xs text-muted-foreground">
            Declara {asignado.spec.vlans.length} VLAN(s) y {asignado.spec.trafficTables.length} traffic table(s).
          </p>
        )}
      </div>

      {mostrarForm && (
        <NuevaVersionForm
          base={asignado}
          onCreado={() => {
            setMostrarForm(false);
            qc.invalidateQueries({ queryKey: ['olt-baselines'] });
          }}
        />
      )}

      {baselineId && <PlanPanel oltId={oltId} />}
    </div>
  );
}
