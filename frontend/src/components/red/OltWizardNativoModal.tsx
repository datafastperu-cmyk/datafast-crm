'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, ChevronRight, Cpu, Eye, EyeOff,
  Loader2, Network, Server, X, XCircle, Zap,
} from 'lucide-react';
import {
  oltNativoApi,
  type WizardTopologyResponse,
  type WizardBoardInfo,
} from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { Portal } from '@/components/ui/portal';
import { cn } from '@/lib/utils';

// ─── Tipos de estado interno del wizard ──────────────────────

type Step = 1 | 2 | 3 | 4 | 5;

interface Credenciales {
  ip:        string;
  puerto:    number;
  usuario:   string;
  contrasena:string;
  marca:     string;
}

const MARCAS = ['huawei', 'vsol'] as const;

// ─── Helpers ──────────────────────────────────────────────────

function boardEstadoColor(state: string): string {
  if (state === 'normal' || state === 'active' || state === 'ok') return 'text-emerald-400';
  if (state === 'fault' || state === 'error')                       return 'text-red-400';
  if (state === 'absent')                                           return 'text-muted-foreground';
  return 'text-amber-400';
}

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

const STEP_LABELS: Record<Step, string> = {
  1: 'Credenciales',
  2: 'Conexión',
  3: 'Topología',
  4: 'Configurar',
  5: 'Confirmar',
};

// ─── Componente principal ─────────────────────────────────────

interface Props {
  open:    boolean;
  onClose: () => void;
}

export function OltWizardNativoModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [step, setStep]           = useState<Step>(1);
  const [showPwd, setShowPwd]     = useState(false);
  const [creds, setCreds]         = useState<Credenciales>({
    ip: '', puerto: 22, usuario: 'root', contrasena: '', marca: 'huawei',
  });
  const [connOk, setConnOk]       = useState(false);
  const [connMsg, setConnMsg]     = useState('');
  const [connModel, setConnModel] = useState('');
  const [topology, setTopology]   = useState<WizardTopologyResponse | null>(null);
  const [nombre, setNombre]       = useState('');
  const [modelo, setModelo]       = useState('');

  // ── Step 2: test conexión ──────────────────────────────────
  const testMut = useMutation({
    mutationFn: () => oltNativoApi.testConexionDirecta({
      ip:       creds.ip,
      puerto:   creds.puerto,
      usuario:  creds.usuario,
      password: creds.contrasena,
      marca:    creds.marca,
    }),
    onSuccess: (res) => {
      if (res.exitoso) {
        setConnOk(true);
        setConnMsg(res.mensaje);
      } else {
        setConnOk(false);
        setConnMsg(res.mensaje || 'No se pudo conectar con la OLT');
      }
    },
    onError: () => {
      setConnOk(false);
      setConnMsg('Error de red al probar la conexión');
    },
  });

  // ── Step 3: obtener topología ──────────────────────────────
  const topoMut = useMutation({
    mutationFn: () => oltNativoApi.wizardTopologia({
      ip:         creds.ip,
      puerto:     creds.puerto,
      usuario:    creds.usuario,
      contrasena: creds.contrasena,
      marca:      creds.marca,
    }),
    onSuccess: (res) => {
      if (res.success) {
        setTopology(res);
        if (res.model) setConnModel(res.model);
        if (res.model && !modelo) setModelo(res.model);
        setStep(4);
      } else {
        toast('Error al obtener topología', { description: res.error ?? 'Error desconocido', type: 'error' });
      }
    },
    onError: (err: any) => {
      toast('Error al obtener topología', { description: err?.message ?? '', type: 'error' });
    },
  });

  // ── Step 5: commit ─────────────────────────────────────────
  const commitMut = useMutation({
    mutationFn: () => oltNativoApi.wizardCommit({
      nombre,
      ipGestion:     creds.ip,
      puerto:        creds.puerto,
      usuario:       creds.usuario,
      contrasena:    creds.contrasena,
      marca:         creds.marca,
      modelo:        modelo || connModel || creds.marca.toUpperCase(),
      firmware:      topology?.firmware_version ?? undefined,
      vlans:         topology?.vlans.map(v => ({ vlan_id: v.vlan_id, nombre: v.name })) ?? [],
      trafficTables: topology?.traffic_tables.map(t => ({
        index: t.index, name: t.name,
        cir_kbps: t.cir_kbps ?? undefined,
        pir_kbps: t.pir_kbps ?? undefined,
      })) ?? [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['olt-nativas'] });
      queryClient.invalidateQueries({ queryKey: ['olt-todas'] });
      toast('OLT registrada', { description: `${nombre} agregada correctamente al sistema`, type: 'success' });
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
    setConnModel('');
    setTopology(null);
    setNombre('');
    setModelo('');
    setCreds({ ip: '', puerto: 22, usuario: 'root', contrasena: '', marca: 'huawei' });
    onClose();
  }

  if (!open) return null;

  const step1Valid = creds.ip.trim() && creds.usuario.trim() && creds.contrasena.trim();

  return (
    <Portal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* Modal */}
        <div
          className="relative w-full max-w-2xl bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
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

          {/* Progress steps */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-muted/20">
            {([1, 2, 3, 4, 5] as Step[]).map((n, i) => (
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
                {i < 4 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mb-3" />}
              </div>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">

            {/* ── STEP 1: Credenciales ────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Ingresa los datos de acceso SSH a la OLT. La contraseña se cifra antes de guardarse.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">IP de gestión *</label>
                    <input
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="192.168.1.1"
                      value={creds.ip}
                      onChange={e => setCreds(c => ({ ...c, ip: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Puerto SSH</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value={creds.puerto}
                      onChange={e => setCreds(c => ({ ...c, puerto: parseInt(e.target.value) || 22 }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Usuario *</label>
                    <input
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value={creds.usuario}
                      onChange={e => setCreds(c => ({ ...c, usuario: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Contraseña *</label>
                    <div className="relative">
                      <input
                        type={showPwd ? 'text' : 'password'}
                        className="w-full px-3 py-2 pr-9 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        value={creds.contrasena}
                        onChange={e => setCreds(c => ({ ...c, contrasena: e.target.value }))}
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
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Marca</label>
                    <select
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value={creds.marca}
                      onChange={e => setCreds(c => ({ ...c, marca: e.target.value }))}
                    >
                      {MARCAS.map(m => (
                        <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2: Test conexión ───────────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Network className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">IP:</span>
                    <span className="font-mono text-foreground">{creds.ip}:{creds.puerto}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Cpu className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Marca:</span>
                    <span className="font-medium capitalize">{creds.marca}</span>
                  </div>
                </div>

                {testMut.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Estableciendo conexión SSH…
                  </div>
                )}

                {testMut.isSuccess && (
                  <div className={cn(
                    'flex items-start gap-3 p-4 rounded-lg border',
                    connOk
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-red-500/10 border-red-500/30 text-red-400',
                  )}>
                    {connOk
                      ? <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                      : <XCircle      className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    }
                    <div>
                      <p className="font-medium text-sm">{connOk ? 'Conexión exitosa' : 'Conexión fallida'}</p>
                      <p className="text-xs opacity-80 mt-0.5">{connMsg}</p>
                    </div>
                  </div>
                )}

                {!testMut.isPending && !testMut.isSuccess && (
                  <p className="text-sm text-muted-foreground">
                    Presiona "Probar conexión" para verificar el acceso SSH antes de continuar.
                  </p>
                )}
              </div>
            )}

            {/* ── STEP 3: Topología ───────────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                {topoMut.isPending && (
                  <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                    <Loader2 className="w-7 h-7 animate-spin text-primary" />
                    <p className="text-sm">Leyendo topología de la OLT…</p>
                    <p className="text-xs opacity-60">Boards, VLANs, perfiles y traffic tables</p>
                  </div>
                )}
                {!topoMut.isPending && !topology && (
                  <p className="text-sm text-muted-foreground">
                    Se obtendrá la topología completa: boards, VLANs y traffic tables.
                  </p>
                )}
              </div>
            )}

            {/* ── STEP 4: Configurar ──────────────────────────── */}
            {step === 4 && topology && (
              <div className="space-y-5">
                {/* Resumen de topología */}
                <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Topología detectada
                  </h3>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-muted/30 rounded p-2">
                      <p className="text-lg font-bold text-foreground">{topology.boards.length}</p>
                      <p className="text-[10px] text-muted-foreground">Boards</p>
                    </div>
                    <div className="bg-muted/30 rounded p-2">
                      <p className="text-lg font-bold text-foreground">{topology.vlans.length}</p>
                      <p className="text-[10px] text-muted-foreground">VLANs</p>
                    </div>
                    <div className="bg-muted/30 rounded p-2">
                      <p className="text-lg font-bold text-foreground">{topology.traffic_tables.length}</p>
                      <p className="text-[10px] text-muted-foreground">Traffic tables</p>
                    </div>
                  </div>
                  {/* Lista de boards */}
                  {topology.boards.length > 0 && (
                    <div className="space-y-1">
                      {topology.boards.map((b: WizardBoardInfo) => (
                        <div key={b.slot} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                          <span className="text-muted-foreground">Slot {b.slot} — {b.board_type}</span>
                          <div className="flex items-center gap-2">
                            <span className={cn('font-medium', boardEstadoColor(b.state))}>{b.state}</span>
                            <span className="text-muted-foreground">{b.onu_count} ONUs</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Formulario de nombre */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Nombre de la OLT *</label>
                    <input
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="Ej: OLT-NORTE-01"
                      value={nombre}
                      onChange={e => setNombre(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Modelo</label>
                    <input
                      className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder={connModel || 'Ej: MA5800-X7'}
                      value={modelo}
                      onChange={e => setModelo(e.target.value)}
                    />
                  </div>
                  {topology.firmware_version && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Zap className="w-3 h-3" />
                      Firmware detectado: <span className="font-mono text-foreground">{topology.firmware_version}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── STEP 5: Confirmar ───────────────────────────── */}
            {step === 5 && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                  <h3 className="text-sm font-semibold text-emerald-400">Resumen de la OLT a registrar</h3>
                  {[
                    ['Nombre',   nombre],
                    ['IP',       `${creds.ip}:${creds.puerto}`],
                    ['Marca',    creds.marca.charAt(0).toUpperCase() + creds.marca.slice(1)],
                    ['Modelo',   modelo || connModel || '—'],
                    ['Firmware', topology?.firmware_version ?? '—'],
                    ['VLANs',    `${topology?.vlans.length ?? 0} importadas`],
                    ['Traffic tables', `${topology?.traffic_tables.length ?? 0} importadas`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium text-foreground">{v}</span>
                    </div>
                  ))}
                </div>

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
              disabled={commitMut.isPending || topoMut.isPending || testMut.isPending}
            >
              {step === 1 ? 'Cancelar' : '← Atrás'}
            </button>

            <div className="flex gap-2">
              {/* Step 1 → 2 */}
              {step === 1 && (
                <button
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
                  disabled={!step1Valid}
                  onClick={() => { setConnOk(false); setConnMsg(''); setStep(2); }}
                >
                  Continuar →
                </button>
              )}

              {/* Step 2: probar + avanzar */}
              {step === 2 && (
                <>
                  <button
                    className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted/40 transition-colors disabled:opacity-50"
                    disabled={testMut.isPending}
                    onClick={() => testMut.mutate()}
                  >
                    {testMut.isPending ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Probando…</> : 'Probar conexión'}
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

              {/* Step 3: cargar topología */}
              {step === 3 && !topoMut.isPending && !topology && (
                <button
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                  onClick={() => topoMut.mutate()}
                >
                  Cargar topología
                </button>
              )}

              {/* Step 4 → 5 */}
              {step === 4 && (
                <button
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
                  disabled={!nombre.trim()}
                  onClick={() => setStep(5)}
                >
                  Revisar y confirmar →
                </button>
              )}

              {/* Step 5: commit */}
              {step === 5 && (
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
