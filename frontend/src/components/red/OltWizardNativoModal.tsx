'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, ChevronRight, Eye, EyeOff,
  Loader2, Network, Server, X, XCircle,
} from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { Portal } from '@/components/ui/portal';
import { cn } from '@/lib/utils';

// ─── Tipos ────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface FormState {
  // Identidad
  nombre:     string;
  marca:      string;
  modelo:     string;
  zonaId:     string;
  // Conectividad
  ip:         string;
  puerto:     number;
  usuario:    string;
  contrasena: string;
}

const MARCAS = ['huawei', 'zte', 'vsol', 'cdata'] as const;

const STEP_LABELS: Record<Step, string> = {
  1: 'Identidad',
  2: 'Conectividad',
  3: 'Confirmar',
};

function StepDot({ n, current }: { n: number; current: number }) {
  const done   = current > n;
  const active = current === n;
  return (
    <div className={cn(
      'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors',
      done   ? 'bg-emerald-500 border-emerald-500 text-white'
             : active
             ? 'bg-primary border-primary text-primary-foreground'
             : 'bg-muted/40 border-border text-muted-foreground',
    )}>
      {done ? <CheckCircle2 className="w-4 h-4" /> : n}
    </div>
  );
}

// ─── Componente ───────────────────────────────────────────────

interface Props {
  open:    boolean;
  onClose: () => void;
}

export function OltWizardNativoModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [step, setStep]       = useState<Step>(1);
  const [showPwd, setShowPwd] = useState(false);
  const [connOk, setConnOk]   = useState(false);
  const [connMsg, setConnMsg] = useState('');

  const [form, setForm] = useState<FormState>({
    nombre: '', marca: 'huawei', modelo: '', zonaId: '',
    ip: '', puerto: 22, usuario: 'root', contrasena: '',
  });

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  // ── Step 2: test SSH ──────────────────────────────────────────
  const testMut = useMutation({
    mutationFn: () => oltNativoApi.testConexionDirecta({
      ip:       form.ip,
      puerto:   form.puerto,
      usuario:  form.usuario,
      password: form.contrasena,
      marca:    form.marca,
    }),
    onSuccess: (res) => {
      setConnOk(res.exitoso);
      setConnMsg(res.mensaje || (res.exitoso ? 'Conexión SSH exitosa' : 'Conexión fallida'));
    },
    onError: () => {
      setConnOk(false);
      setConnMsg('Error de red al probar la conexión');
    },
  });

  // ── Step 3: commit ────────────────────────────────────────────
  const commitMut = useMutation({
    mutationFn: () => oltNativoApi.wizardCommit({
      nombre:     form.nombre,
      ipGestion:  form.ip,
      puerto:     form.puerto,
      usuario:    form.usuario,
      contrasena: form.contrasena,
      marca:      form.marca,
      modelo:     form.modelo || form.marca.toUpperCase(),
      zonaId:     form.zonaId || undefined,
      // vlans y trafficTables se cargan post-registro vía OltSyncService
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['olt-nativas'] });
      queryClient.invalidateQueries({ queryKey: ['olt-todas'] });
      queryClient.invalidateQueries({ queryKey: ['olts-config'] });
      toast('OLT registrada', {
        description: `${form.nombre} agregada. Usa "Sincronizar" en la página de detalle para cargar perfiles y VLANs.`,
        type: 'success',
      });
      handleClose();
    },
    onError: (err: any) => {
      toast('Error al registrar OLT', { description: err?.message ?? '', type: 'error' });
    },
  });

  function handleClose() {
    setStep(1);
    setConnOk(false);
    setConnMsg('');
    setForm({ nombre: '', marca: 'huawei', modelo: '', zonaId: '', ip: '', puerto: 22, usuario: 'root', contrasena: '' });
    onClose();
  }

  if (!open) return null;

  const step1Valid = form.nombre.trim() !== '';
  const step2Valid = form.ip.trim() && form.usuario.trim() && form.contrasena.trim();

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <div
          className="relative w-full max-w-lg bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Server className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold">Agregar OLT SSH Nativa</h2>
            </div>
            <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Steps */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-muted/20">
            {([1, 2, 3] as Step[]).map((n, i) => (
              <div key={n} className="flex items-center gap-2">
                <div className="flex flex-col items-center">
                  <StepDot n={n} current={step} />
                  <span className={cn(
                    'text-[10px] mt-0.5 whitespace-nowrap',
                    step === n ? 'text-primary font-medium' : 'text-muted-foreground',
                  )}>
                    {STEP_LABELS[n]}
                  </span>
                </div>
                {i < 2 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mb-3" />}
              </div>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">

            {/* ── STEP 1: Identidad ──────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Define el nombre y la marca de la OLT. Los perfiles y VLANs se sincronizarán automáticamente después del registro.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Nombre de la OLT *</label>
                    <input
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="Ej: OLT-NORTE-01"
                      value={form.nombre}
                      onChange={e => set('nombre', e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Marca</label>
                      <select
                        className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        value={form.marca}
                        onChange={e => set('marca', e.target.value)}
                      >
                        {MARCAS.map(m => (
                          <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Modelo</label>
                      <input
                        className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="Ej: MA5800-X7"
                        value={form.modelo}
                        onChange={e => set('modelo', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2: Conectividad + Test ───────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">IP de gestión *</label>
                    <input
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="192.168.1.1"
                      value={form.ip}
                      onChange={e => { set('ip', e.target.value); setConnOk(false); setConnMsg(''); }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Puerto SSH</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value={form.puerto}
                      onChange={e => set('puerto', parseInt(e.target.value) || 22)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Usuario *</label>
                    <input
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value={form.usuario}
                      onChange={e => set('usuario', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Contraseña *</label>
                    <div className="relative">
                      <input
                        type={showPwd ? 'text' : 'password'}
                        className="w-full px-3 py-2 pr-9 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        value={form.contrasena}
                        onChange={e => { set('contrasena', e.target.value); setConnOk(false); setConnMsg(''); }}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPwd(v => !v)}
                      >
                        {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Resultado del test */}
                {testMut.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Estableciendo conexión SSH…
                  </div>
                )}
                {testMut.isSuccess && connMsg && (
                  <div className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border text-sm',
                    connOk
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400',
                  )}>
                    {connOk
                      ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      : <XCircle      className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    }
                    <span>{connMsg}</span>
                  </div>
                )}
                {!testMut.isPending && !connMsg && (
                  <p className="text-xs text-muted-foreground">
                    Debes probar la conexión SSH antes de continuar.
                  </p>
                )}
              </div>
            )}

            {/* ── STEP 3: Resumen + Commit ──────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Network className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-semibold text-emerald-400">OLT a registrar</span>
                  </div>
                  {([
                    ['Nombre',  form.nombre],
                    ['Marca',   form.marca.charAt(0).toUpperCase() + form.marca.slice(1)],
                    ['Modelo',  form.modelo || '—'],
                    ['IP',      `${form.ip}:${form.puerto}`],
                    ['Usuario', form.usuario],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium text-foreground font-mono">{v}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Después del registro podrás sincronizar la OLT para importar VLANs, perfiles y tarjetas físicas automáticamente.
                </p>
                {commitMut.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Registrando OLT en el sistema…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/10">
            <button
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={step === 1 ? handleClose : () => setStep(s => (s - 1) as Step)}
              disabled={commitMut.isPending || testMut.isPending}
            >
              {step === 1 ? 'Cancelar' : '← Atrás'}
            </button>

            <div className="flex gap-2">
              {/* Step 1 → 2 */}
              {step === 1 && (
                <button
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
                  disabled={!step1Valid}
                  onClick={() => setStep(2)}
                >
                  Continuar →
                </button>
              )}

              {/* Step 2: test + avanzar */}
              {step === 2 && (
                <>
                  <button
                    className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted/40 transition-colors disabled:opacity-50"
                    disabled={!step2Valid || testMut.isPending}
                    onClick={() => { setConnOk(false); setConnMsg(''); testMut.mutate(); }}
                  >
                    {testMut.isPending
                      ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Probando…</>
                      : 'Probar conexión'
                    }
                  </button>
                  {connOk && (
                    <button
                      className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                      onClick={() => setStep(3)}
                    >
                      Continuar →
                    </button>
                  )}
                </>
              )}

              {/* Step 3: commit */}
              {step === 3 && (
                <button
                  className="px-4 py-2 text-sm rounded-md bg-emerald-600 text-white font-medium disabled:opacity-50 hover:bg-emerald-700 transition-colors flex items-center gap-2"
                  disabled={commitMut.isPending}
                  onClick={() => commitMut.mutate()}
                >
                  {commitMut.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Guardando…</>
                    : <><CheckCircle2 className="w-3.5 h-3.5" />Registrar OLT</>
                  }
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
