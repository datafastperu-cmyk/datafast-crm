'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  BookMarked, CheckCircle2, Loader2, Plus, Trash2, X, XCircle, AlertTriangle,
} from 'lucide-react';
import { oltNativoApi, type OltBaselineItem } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { Portal } from '@/components/ui/portal';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Editor de baselines por secciones + verificación de requerimientos.
//
// Al presionar "Crear versión" se evalúan dos niveles:
//  · ESTRUCTURAL (bloqueante): lo escrito debe ser válido en sí mismo.
//  · OPERATIVO (advertencia): el baseline debe declarar el mínimo para que
//    el ERP opere solo con recursos propios (directriz "inyectar desde 0").
// La compatibilidad contra la OLT real (VLANs preexistentes, tipo smart,
// uso real) la verifica el PLAN al asignar/aplicar — no este editor.
// ─────────────────────────────────────────────────────────────

interface VlanRow { vlanId: string; nombre: string; uplink: boolean; tr069: boolean }
interface TtRow   { nombre: string; cirKbps: string; pirKbps: string }

interface Check { ok: boolean; texto: string }

interface Props {
  open:    boolean;
  base:    OltBaselineItem | null;   // prellenar desde este baseline (nueva versión)
  onClose: () => void;
  onCreado: (b: OltBaselineItem) => void;
}

export function BaselineEditorModal({ open, base, onClose, onCreado }: Props) {
  const { toast } = useToast();

  const [nombre, setNombre]     = useState(base?.nombre ?? 'Datafast Estándar');
  const [descripcion, setDesc]  = useState('');
  const [uplinkPort, setUplink] = useState(base?.spec.uplinkPort ?? '0/9/0');
  const [rangoIni, setRangoIni] = useState(String(base?.spec.servicePortRange?.inicio ?? 2000));
  const [rangoFin, setRangoFin] = useState(String(base?.spec.servicePortRange?.fin ?? 3999));
  const [vlans, setVlans] = useState<VlanRow[]>(
    base?.spec.vlans.map(v => ({
      vlanId: String(v.vlanId), nombre: v.nombre,
      uplink: !!v.uplink, tr069: v.proposito === 'tr069',
    })) ?? [{ vlanId: '', nombre: '', uplink: true, tr069: false }],
  );
  const [tts, setTts] = useState<TtRow[]>(
    base?.spec.trafficTables.map(t => ({
      nombre: t.nombre, cirKbps: String(t.cirKbps), pirKbps: String(t.pirKbps),
    })) ?? [{ nombre: '', cirKbps: '', pirKbps: '' }],
  );
  const [intentado, setIntentado] = useState(false);

  // ── Verificación de requerimientos ──────────────────────────
  const { estructural, operativo, estructuralOk } = useMemo(() => {
    const vlanIds = vlans.map(v => Number(v.vlanId));
    const hayUplinks = vlans.some(v => v.uplink || v.tr069);
    const ttNombres = tts.map(t => t.nombre.trim()).filter(Boolean);

    const estructural: Check[] = [
      { ok: nombre.trim().length > 0, texto: 'Nombre del baseline definido' },
      { ok: vlans.every(v => Number(v.vlanId) >= 1 && Number(v.vlanId) <= 4094), texto: 'VLAN IDs entre 1 y 4094' },
      { ok: new Set(vlanIds).size === vlanIds.length, texto: 'VLAN IDs sin duplicados' },
      { ok: vlans.every(v => v.nombre.trim().length > 0), texto: 'Toda VLAN tiene nombre' },
      { ok: vlans.filter(v => v.tr069).length <= 1, texto: 'Máximo una VLAN TR-069 (exclusiva)' },
      { ok: tts.every(t => Number(t.cirKbps) >= 64 && Number(t.cirKbps) <= 10_000_000), texto: 'CIR entre 64 y 10 000 000 kbps' },
      { ok: tts.every(t => Number(t.pirKbps) >= Number(t.cirKbps)), texto: 'PIR ≥ CIR en cada traffic table' },
      { ok: tts.every(t => t.nombre.trim().length > 0), texto: 'Toda traffic table tiene nombre' },
      { ok: new Set(ttNombres).size === ttNombres.length, texto: 'Nombres de traffic tables sin duplicados' },
      { ok: !hayUplinks || /^\d+\/\d+\/\d+$/.test(uplinkPort.trim()), texto: 'Puerto uplink con formato frame/slot/port' },
      { ok: Number(rangoIni) >= 1 && Number(rangoFin) >= Number(rangoIni), texto: 'Rango de service-ports coherente (fin ≥ inicio)' },
    ];

    const operativo: Check[] = [
      { ok: vlans.some(v => v.tr069), texto: 'Declara la VLAN de gestión TR-069' },
      { ok: vlans.some(v => !v.tr069), texto: 'Declara al menos una VLAN de servicio' },
      { ok: ttNombres.includes('ERP-MGMT'), texto: 'Declara el carril de gestión ERP-MGMT' },
      { ok: ttNombres.some(n => n !== 'ERP-MGMT'), texto: 'Declara al menos una velocidad de cliente' },
      { ok: !!rangoIni && !!rangoFin, texto: 'Declara el rango de service-ports del ERP' },
      { ok: /^\d+\/\d+\/\d+$/.test(uplinkPort.trim()), texto: 'Declara el puerto uplink' },
    ];

    return { estructural, operativo, estructuralOk: estructural.every(c => c.ok) };
  }, [nombre, vlans, tts, uplinkPort, rangoIni, rangoFin]);

  const crear = useMutation({
    mutationFn: () => oltNativoApi.crearBaseline({
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || undefined,
      vlans: vlans.map(v => ({
        vlanId: Number(v.vlanId),
        nombre: v.nombre.trim(),
        ...(v.uplink || v.tr069 ? { uplink: true } : {}),
        ...(v.tr069 ? { proposito: 'tr069' } : {}),
      })),
      trafficTables: tts.map(t => ({
        nombre: t.nombre.trim(), cirKbps: Number(t.cirKbps), pirKbps: Number(t.pirKbps),
      })),
      uplinkPort: uplinkPort.trim() || undefined,
      servicePortRange: rangoIni && rangoFin
        ? { inicio: Number(rangoIni), fin: Number(rangoFin) }
        : undefined,
    }),
    onSuccess: (b) => {
      toast(`Baseline "${b.nombre}" v${b.version} creado`, { type: 'success' });
      onCreado(b);
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al crear baseline', { type: 'error' }),
  });

  if (!open) return null;

  const inputCls = 'bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary/50';

  const setVlan = (i: number, patch: Partial<VlanRow>) =>
    setVlans(rows => rows.map((r, j) => {
      if (j !== i) return patch.tr069 ? { ...r, tr069: false } : r; // tr069 exclusiva
      return { ...r, ...patch };
    }));
  const setTt = (i: number, patch: Partial<TtRow>) =>
    setTts(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = () => {
    setIntentado(true);
    if (!estructuralOk) {
      toast('El baseline no cumple los requisitos estructurales — revisa el checklist', { type: 'error' });
      return;
    }
    crear.mutate();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div className="relative w-full max-w-3xl bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <BookMarked className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold">
                {base ? `Nueva versión de "${base.nombre}" (desde v${base.version})` : 'Crear baseline'}
              </h2>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Nombre (nombre existente → versión nueva)</label>
                <input value={nombre} onChange={e => setNombre(e.target.value)} className={cn(inputCls, 'w-full mt-1')} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Descripción de esta versión</label>
                <input value={descripcion} onChange={e => setDesc(e.target.value)} placeholder="Qué cambia y por qué" className={cn(inputCls, 'w-full mt-1')} />
              </div>
            </div>

            {/* VLANs */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">VLANs del ERP</p>
              {vlans.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={v.vlanId} onChange={e => setVlan(i, { vlanId: e.target.value })}
                    placeholder="ID" type="number" min={1} max={4094} className={cn(inputCls, 'w-20 font-mono')} />
                  <input value={v.nombre} onChange={e => setVlan(i, { nombre: e.target.value })}
                    placeholder="ERP-INTERNET" className={cn(inputCls, 'flex-1 font-mono')} />
                  <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                    <input type="checkbox" checked={v.uplink || v.tr069} disabled={v.tr069}
                      onChange={e => setVlan(i, { uplink: e.target.checked })} />
                    uplink
                  </label>
                  <label className="flex items-center gap-1 text-xs whitespace-nowrap" title="VLAN exclusiva de gestión TR-069 (implica uplink)">
                    <input type="checkbox" checked={v.tr069}
                      onChange={e => setVlan(i, { tr069: e.target.checked })} />
                    TR-069
                  </label>
                  <button onClick={() => setVlans(rows => rows.filter((_, j) => j !== i))}
                    className="p-1.5 text-muted-foreground hover:text-red-400" title="Quitar VLAN">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button onClick={() => setVlans(rows => [...rows, { vlanId: '', nombre: '', uplink: true, tr069: false }])}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                <Plus className="w-3.5 h-3.5" /> Agregar VLAN
              </button>
            </div>

            {/* Traffic tables */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">Traffic tables (kbps, CIR=PIR para simétrico)</p>
              {tts.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={t.nombre} onChange={e => setTt(i, { nombre: e.target.value })}
                    placeholder="ERP-100M" className={cn(inputCls, 'flex-1 font-mono')} />
                  <input value={t.cirKbps} onChange={e => setTt(i, { cirKbps: e.target.value })}
                    placeholder="CIR" type="number" className={cn(inputCls, 'w-28 font-mono')} />
                  <input value={t.pirKbps} onChange={e => setTt(i, { pirKbps: e.target.value })}
                    placeholder="PIR" type="number" className={cn(inputCls, 'w-28 font-mono')} />
                  <button onClick={() => setTts(rows => rows.filter((_, j) => j !== i))}
                    className="p-1.5 text-muted-foreground hover:text-red-400" title="Quitar traffic table">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button onClick={() => setTts(rows => [...rows, { nombre: '', cirKbps: '', pirKbps: '' }])}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                <Plus className="w-3.5 h-3.5" /> Agregar traffic table
              </button>
            </div>

            {/* Uplink + rango */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Puerto uplink (frame/slot/port)</label>
                <input value={uplinkPort} onChange={e => setUplink(e.target.value)} placeholder="0/9/0"
                  className={cn(inputCls, 'w-full mt-1 font-mono')} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Service-ports — inicio</label>
                <input value={rangoIni} onChange={e => setRangoIni(e.target.value)} type="number" className={cn(inputCls, 'w-full mt-1 font-mono')} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Service-ports — fin</label>
                <input value={rangoFin} onChange={e => setRangoFin(e.target.value)} type="number" className={cn(inputCls, 'w-full mt-1 font-mono')} />
              </div>
            </div>

            {/* Checklist de requerimientos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border p-3 space-y-1.5">
                <p className="text-xs font-semibold">Requisitos estructurales (bloquean el guardado)</p>
                {estructural.map((c, i) => (
                  <p key={i} className={cn('flex items-center gap-1.5 text-xs',
                    c.ok ? 'text-emerald-400' : intentado ? 'text-red-400 font-medium' : 'text-muted-foreground')}>
                    {c.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                    {c.texto}
                  </p>
                ))}
              </div>
              <div className="rounded-xl border border-border p-3 space-y-1.5">
                <p className="text-xs font-semibold">Requisitos operativos del ERP (advertencia)</p>
                {operativo.map((c, i) => (
                  <p key={i} className={cn('flex items-center gap-1.5 text-xs',
                    c.ok ? 'text-emerald-400' : 'text-amber-400')}>
                    {c.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                    {c.texto}
                  </p>
                ))}
                {!operativo.every(c => c.ok) && (
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Puedes guardar igual, pero sin estas piezas el ERP no puede operar solo con
                    recursos propios en las OLTs que usen este baseline.
                  </p>
                )}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              La compatibilidad contra la OLT real (VLANs preexistentes, tipo smart, uso actual)
              se verifica en el plan de convergencia al asignar el baseline — con adopciones y
              bloqueos visibles antes de aplicar.
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
            <button
              onClick={submit}
              disabled={crear.isPending || (intentado && !estructuralOk)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {crear.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookMarked className="w-4 h-4" />}
              Crear versión
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
