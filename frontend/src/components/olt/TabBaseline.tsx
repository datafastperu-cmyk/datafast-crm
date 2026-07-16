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
import { BaselineEditorModal } from './BaselineEditorModal';

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

      {/* Adopciones: VLANs preexistentes que el ERP usará — nunca en silencio */}
      {(plan.adopciones ?? []).length > 0 && (
        <div className="space-y-1.5">
          {plan.adopciones.map((a) => (
            <div key={a.vlanId} className="flex items-start gap-2 text-xs rounded-lg border border-sky-700/40 bg-sky-500/5 text-sky-400 px-3 py-2">
              <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{a.detalle}</span>
            </div>
          ))}
        </div>
      )}

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
  const [uplinkEstandar, setUplinkEstandar] = useState('0/9/0');

  const generarEstandar = useMutation({
    mutationFn: () => oltNativoApi.generarBaselineEstandar(uplinkEstandar.trim()),
    onSuccess: async (b) => {
      toast(`Baseline "${b.nombre}" v${b.version} listo — asignándolo a esta OLT…`, { type: 'success' });
      await oltNativoApi.asignarBaseline(oltId, b.id);
      qc.invalidateQueries({ queryKey: ['olt-baselines'] });
      qc.invalidateQueries({ queryKey: ['olt-detalle', oltId] });
      qc.invalidateQueries({ queryKey: ['olt-baseline-plan', oltId] });
      qc.invalidateQueries({ queryKey: ['olt-compliance', oltId] });
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al generar el estándar', { type: 'error' }),
  });

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

      {/* Estándar canónico del ERP — directriz "inyectar desde cero" */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" /> Baseline Datafast Estándar
        </p>
        <p className="text-xs text-muted-foreground">
          La configuración canónica del ERP (VLAN 1600 TR-069, VLAN 200 Internet, carril ERP-MGMT,
          velocidades ERP-50M…ERP-800M, service-ports 2000–3999) — idéntica en toda OLT. Genera la
          versión vigente y asígnala a esta OLT en un paso.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={uplinkEstandar}
            onChange={e => setUplinkEstandar(e.target.value)}
            placeholder="0/9/0"
            className="w-28 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-primary/50"
            title="Puerto uplink de esta OLT (frame/slot/port)"
          />
          <button
            onClick={() => generarEstandar.mutate()}
            disabled={generarEstandar.isPending || !/^\d+\/\d+\/\d+$/.test(uplinkEstandar.trim())}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {generarEstandar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookMarked className="w-3.5 h-3.5" />}
            Generar estándar y asignar
          </button>
        </div>
      </div>

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
            Nueva versión…
          </button>
        </div>
        {asignado && (
          <p className="text-xs text-muted-foreground">
            Declara {asignado.spec.vlans.length} VLAN(s) y {asignado.spec.trafficTables.length} traffic table(s).
          </p>
        )}
      </div>

      <BaselineEditorModal
        open={mostrarForm}
        base={asignado}
        onClose={() => setMostrarForm(false)}
        onCreado={() => {
          setMostrarForm(false);
          qc.invalidateQueries({ queryKey: ['olt-baselines'] });
        }}
      />

      {baselineId && <PlanPanel oltId={oltId} />}
    </div>
  );
}
