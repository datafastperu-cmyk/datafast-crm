'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Cpu, Eye, EyeOff, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { oltNativoApi, type OltDispositivo, type CreateOltDto, type UpdateOltDto, type TestConexionOltResult } from '@/lib/api/olt-nativo';
import { mikrotikApi } from '@/lib/api/mikrotik';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { Portal } from '@/components/ui/portal';
import { ProveedoresTab } from './ProveedoresTab';
import { TopologiaTab }   from './TopologiaTab';
import { PeligrosoTab }   from './PeligrosoTab';

interface Props {
  open:     boolean;
  onClose:  () => void;
  editing?: OltDispositivo | null;
}

const MARCAS   = ['huawei', 'zte', 'vsol', 'cdata'] as const;
const METODOS  = [
  { value: 'nativo_ssh',  label: 'SSH Nativo' },
  { value: 'nativo_snmp', label: 'SNMP Nativo' },
] as const;

type FormData = {
  nombre:                string;
  descripcion:           string;
  marca:                 string;
  modelo:                string;
  metodoConexion:        string;
  ipGestion:             string;
  puerto:                string;
  usuarioAnclado:        string;
  contrasena:            string;
  slotsTotales:          string;
  puertosPorSlot:        string;
  usarVlanGestion:       boolean;
  vlanGestionDefecto:    string;
  snmpCommunity:         string;
  snmpVersion:           string;
  routerId:              string;
  dispositivoMonitoreoId:string;
  ubicacion:             string;
  latitud:               string;
  longitud:              string;
};

function emptyForm(): FormData {
  return {
    nombre: '', descripcion: '', marca: 'huawei', modelo: '',
    metodoConexion: 'nativo_ssh', ipGestion: '', puerto: '22',
    usuarioAnclado: '', contrasena: '',
    slotsTotales: '1', puertosPorSlot: '8',
    usarVlanGestion: false, vlanGestionDefecto: '',
    snmpCommunity: 'public', snmpVersion: '2',
    routerId: '', dispositivoMonitoreoId: '',
    ubicacion: '', latitud: '', longitud: '',
  };
}

function fromOlt(olt: OltDispositivo): FormData {
  const vlan = olt.vlanGestionDefecto != null ? String(olt.vlanGestionDefecto) : '';
  return {
    nombre:                 olt.nombre,
    descripcion:            olt.descripcion ?? '',
    marca:                  olt.marca,
    modelo:                 olt.modelo ?? '',
    metodoConexion:         olt.metodoConexion,
    ipGestion:              olt.ipGestion,
    puerto:                 String(olt.puerto ?? 22),
    usuarioAnclado:         olt.usuarioAnclado,
    contrasena:             '',
    slotsTotales:           String(olt.slotsTotales ?? 1),
    puertosPorSlot:         String(olt.puertosPorSlot ?? 8),
    usarVlanGestion:        olt.vlanGestionDefecto != null,
    vlanGestionDefecto:     vlan,
    snmpCommunity:          olt.snmpCommunity ?? 'public',
    snmpVersion:            String(olt.snmpVersion ?? 2),
    routerId:               olt.routerId ?? '',
    dispositivoMonitoreoId: olt.dispositivoMonitoreoId ?? '',
    ubicacion:              olt.ubicacion ?? '',
    latitud:                olt.latitud != null ? String(olt.latitud) : '',
    longitud:               olt.longitud != null ? String(olt.longitud) : '',
  };
}

function toCreateDto(f: FormData): CreateOltDto {
  const dto: CreateOltDto = {
    nombre:         f.nombre.trim(),
    marca:          f.marca as CreateOltDto['marca'],
    metodoConexion: f.metodoConexion as CreateOltDto['metodoConexion'],
    ipGestion:      f.ipGestion.trim(),
    usuarioAnclado: f.usuarioAnclado.trim(),
    contrasena:     f.contrasena,
    routerId:       f.routerId,
  };
  if (f.descripcion.trim())           dto.descripcion           = f.descripcion.trim();
  if (f.modelo.trim())                dto.modelo                = f.modelo.trim();
  if (f.puerto)                       dto.puerto                = parseInt(f.puerto, 10);
  if (f.slotsTotales)                 dto.slotsTotales          = parseInt(f.slotsTotales, 10);
  if (f.puertosPorSlot)               dto.puertosPorSlot        = parseInt(f.puertosPorSlot, 10);
  if (f.usarVlanGestion && f.vlanGestionDefecto) dto.vlanGestionDefecto = parseInt(f.vlanGestionDefecto, 10);
  if (f.snmpCommunity.trim())         dto.snmpCommunity         = f.snmpCommunity.trim();
  if (f.snmpVersion)                  dto.snmpVersion           = parseInt(f.snmpVersion, 10);
  if (f.dispositivoMonitoreoId.trim()) dto.dispositivoMonitoreoId = f.dispositivoMonitoreoId.trim();
  if (f.ubicacion.trim())             dto.ubicacion             = f.ubicacion.trim();
  if (f.latitud)                      dto.latitud               = parseFloat(f.latitud);
  if (f.longitud)                     dto.longitud              = parseFloat(f.longitud);
  return dto;
}

function toUpdateDto(f: FormData): UpdateOltDto {
  const base = toCreateDto(f) as UpdateOltDto;
  if (!f.contrasena) delete base.contrasena;
  return base;
}

type ActiveTab = 'config' | 'proveedores' | 'topologia' | 'peligroso';

export function OltFormModal({ open, onClose, editing }: Props) {
  const qc = useQueryClient();
  const [form, setForm]         = useState<FormData>(emptyForm);
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors]     = useState<Partial<Record<keyof FormData, string>>>({});
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testResult, setTestResult] = useState<TestConexionOltResult | null>(null);
  const [activeTab, setActiveTab]   = useState<ActiveTab>('config');

  const { toast } = useToast();

  const { data: routers = [] } = useQuery({
    queryKey: ['routers'],
    queryFn:  mikrotikApi.listar,
    enabled:  open,
  });

  useEffect(() => {
    if (!open) return;
    setForm(editing ? fromOlt(editing) : emptyForm());
    setErrors({});
    setShowPass(false);
    setTestStatus('idle');
    setTestResult(null);
    setActiveTab('config');
  }, [open, editing]);

  useEffect(() => {
    if (!open) return () => {};
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((p) => ({ ...p, [field]: e.target.value }));
    setErrors((p) => ({ ...p, [field]: undefined }));
  };

  const toggle = (field: keyof FormData) => () =>
    setForm((p) => ({ ...p, [field]: !p[field] }));

  const mutation = useMutation({
    mutationFn: (data: CreateOltDto | UpdateOltDto) =>
      editing
        ? oltNativoApi.actualizar(editing.id, data as UpdateOltDto)
        : oltNativoApi.crear(data as CreateOltDto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-nativas'] });
      qc.invalidateQueries({ queryKey: ['olts-config'] });
      onClose();
    },
  });

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!form.nombre.trim())        errs.nombre        = 'Requerido';
    if (!form.ipGestion.trim())     errs.ipGestion     = 'Requerido';
    if (!form.usuarioAnclado.trim()) errs.usuarioAnclado = 'Requerido';
    if (!editing && !form.contrasena) errs.contrasena  = 'Requerido al crear';
    if (!form.routerId)             errs.routerId      = 'Selecciona un Router';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleTest = async () => {
    if (!form.ipGestion.trim()) { toast('Ingresa la IP de gestión antes de probar', { type: 'error' }); return; }
    if (!form.usuarioAnclado.trim()) { toast('Ingresa el usuario antes de probar', { type: 'error' }); return; }
    if (!form.contrasena && !editing) { toast('Ingresa la contraseña antes de probar', { type: 'error' }); return; }
    setTestStatus('testing');
    setTestResult(null);
    try {
      const result = await oltNativoApi.testConexionDirecta({
        ip:       form.ipGestion.trim(),
        puerto:   parseInt(form.puerto, 10) || 22,
        usuario:  form.usuarioAnclado.trim(),
        password: form.contrasena,
        marca:    form.marca,
        oltId:    editing?.id,
      });
      setTestResult(result);
      setTestStatus(result.exitoso ? 'ok' : 'error');
    } catch {
      setTestResult({ exitoso: false, mensaje: 'Error al contactar el servidor' });
      setTestStatus('error');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    mutation.mutate(editing ? toUpdateDto(form) : toCreateDto(form));
  };

  if (!open) return null;

  const isEdit = !!editing;

  return (
    <Portal>
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div role="dialog" aria-modal="true" className="relative w-full sm:max-w-2xl sm:mx-4 bg-background flex flex-col
                      h-[96dvh] sm:h-auto sm:max-h-[92vh]
                      rounded-t-2xl sm:rounded-2xl shadow-2xl
                      animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4
                        border-b border-border rounded-t-2xl bg-background">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Cpu className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-tight">
                {isEdit ? 'Editar OLT' : 'Nueva OLT'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isEdit ? `Modificar "${editing!.nombre}"` : 'Registrar equipo OLT'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs — solo en modo edición */}
        {isEdit && (
          <div className="flex-shrink-0 flex border-b border-border px-5 overflow-x-auto">
            {([
              { id: 'config',     label: 'Configuración' },
              { id: 'proveedores',label: 'Proveedores'   },
              { id: 'topologia',  label: 'Topología'     },
              { id: 'peligroso',  label: 'Peligroso'     },
            ] as { id: ActiveTab; label: string }[]).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                  activeTab === id
                    ? id === 'peligroso'
                      ? 'border-red-500 text-red-400'
                      : 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Tab: Proveedores */}
        {isEdit && activeTab === 'proveedores' && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <ProveedoresTab oltId={editing!.id} />
            </div>
            <div className="flex-shrink-0 flex items-center justify-end px-5 py-4 border-t border-border bg-background rounded-b-2xl">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors text-foreground">
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Tab: Topología */}
        {isEdit && activeTab === 'topologia' && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <TopologiaTab oltId={editing!.id} />
            </div>
            <div className="flex-shrink-0 flex items-center justify-end px-5 py-4 border-t border-border bg-background rounded-b-2xl">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors text-foreground">
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Tab: Peligroso */}
        {isEdit && activeTab === 'peligroso' && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <PeligrosoTab
                oltId={editing!.id}
                oltNombre={editing!.nombre}
                onDeleted={onClose}
              />
            </div>
            <div className="flex-shrink-0 flex items-center justify-end px-5 py-4 border-t border-border bg-background rounded-b-2xl">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors text-foreground">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          className={cn('flex flex-col flex-1 min-h-0', isEdit && activeTab !== 'config' ? 'hidden' : '')}
        >
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

            {/* Identificación */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Identificación</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Nombre *" error={errors.nombre}>
                  <input value={form.nombre} onChange={set('nombre')} placeholder="Cabecera Norte - OLT Principal"
                    className={inputCls(errors.nombre)} />
                </Field>
                <Field label="Marca *" error={errors.marca}>
                  <select value={form.marca} onChange={set('marca')} className={inputCls()}>
                    {MARCAS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </select>
                </Field>
                <Field label="Modelo" error={errors.modelo}>
                  <input value={form.modelo} onChange={set('modelo')} placeholder="MA5800-X7"
                    className={inputCls()} />
                </Field>
                <Field label="Router MikroTik *" error={errors.routerId}>
                  <select value={form.routerId} onChange={set('routerId')} className={inputCls(errors.routerId)}>
                    <option value="">— seleccionar —</option>
                    {routers.map((r) => (
                      <option key={r.id} value={r.id}>{r.nombre} ({r.ipGestion})</option>
                    ))}
                  </select>
                </Field>
                <Field label="Descripción" error={undefined} className="sm:col-span-2">
                  <textarea value={form.descripcion} onChange={set('descripcion')} rows={2}
                    placeholder="Descripción opcional del equipo"
                    className={inputCls() + ' resize-none'} />
                </Field>
              </div>
            </section>

            {/* Conexión */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Conexión</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Método de conexión *" error={undefined}>
                  <select value={form.metodoConexion} onChange={set('metodoConexion')} className={inputCls()}>
                    {METODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </Field>
                <Field label="IP de gestión (VPN) *" error={errors.ipGestion}>
                  <input value={form.ipGestion} onChange={set('ipGestion')} placeholder="10.0.50.2"
                    className={inputCls(errors.ipGestion)} />
                </Field>
                <Field label="Puerto" error={undefined}>
                  <input value={form.puerto} onChange={set('puerto')} type="number" min={1} max={65535}
                    placeholder="22" className={inputCls()} />
                </Field>
                <Field label="Usuario *" error={errors.usuarioAnclado}>
                  <input value={form.usuarioAnclado} onChange={set('usuarioAnclado')} placeholder="admin"
                    className={inputCls(errors.usuarioAnclado)} autoComplete="off" />
                </Field>
                <Field label={isEdit ? 'Contraseña (vacío = sin cambios)' : 'Contraseña *'} error={errors.contrasena}
                       className="sm:col-span-2">
                  <div className="relative">
                    <input
                      value={form.contrasena} onChange={set('contrasena')}
                      type={showPass ? 'text' : 'password'}
                      placeholder={isEdit ? 'Dejar vacío para mantener actual' : 'Contraseña de la OLT'}
                      className={cn(inputCls(errors.contrasena), 'pr-10')}
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowPass((p) => !p)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </Field>
              </div>

              {/* Probar conexión */}
              <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-3 mt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> Probar conexión SSH
                </p>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testStatus === 'testing'}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors border',
                    testStatus === 'ok'      ? 'bg-green-500/20 text-green-400 border-green-500/30'
                    : testStatus === 'error' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                             : 'bg-muted text-foreground hover:bg-muted/70 border-border',
                    testStatus === 'testing' && 'opacity-70 cursor-not-allowed',
                  )}
                >
                  {testStatus === 'testing' ? <><Loader2      className="w-4 h-4 animate-spin" /> Probando…</>         :
                   testStatus === 'ok'       ? <><CheckCircle2 className="w-4 h-4" />             Conexión exitosa</>  :
                   testStatus === 'error'    ? <><XCircle      className="w-4 h-4" />             Reintentar</>        :
                                               <><RefreshCw    className="w-4 h-4" />             Probar conexión</>}
                </button>
                {testResult && (
                  <div className={cn(
                    'rounded-lg px-4 py-3 text-sm border',
                    testResult.exitoso
                      ? 'bg-green-500/10 border-green-500/20 text-green-300'
                      : 'bg-red-500/10 border-red-500/20 text-red-300',
                  )}>
                    <p className="font-medium">{testResult.mensaje}</p>
                    {testResult.exitoso && testResult.latenciaMs != null && (
                      <p className="text-xs mt-1 opacity-70">Latencia: {testResult.latenciaMs}ms</p>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Capacidad */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Capacidad física</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Field label="Slots totales" error={undefined}>
                  <input value={form.slotsTotales} onChange={set('slotsTotales')} type="number" min={1} max={64}
                    className={inputCls()} />
                </Field>
                <Field label="Puertos por slot" error={undefined}>
                  <input value={form.puertosPorSlot} onChange={set('puertosPorSlot')} type="number" min={1} max={128}
                    className={inputCls()} />
                </Field>
              </div>

              {/* VLAN de administración — opcional */}
              <div className="mt-3 rounded-xl border border-border p-3.5 space-y-3 bg-muted/10">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.usarVlanGestion}
                    onClick={toggle('usarVlanGestion')}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors border',
                      form.usarVlanGestion
                        ? 'bg-primary border-primary'
                        : 'bg-muted border-border',
                    )}
                  >
                    <span className={cn(
                      'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5',
                      form.usarVlanGestion ? 'translate-x-4' : 'translate-x-0.5',
                    )} />
                  </button>
                  <span className="text-sm font-medium text-foreground">Usar VLAN de administración</span>
                  <span className="text-xs text-muted-foreground">(desactivar si la OLT conecta directo por ETH sin VLAN)</span>
                </label>
                {form.usarVlanGestion && (
                  <Field label="VLAN gestión (1-4094)" error={undefined}>
                    <input
                      value={form.vlanGestionDefecto}
                      onChange={set('vlanGestionDefecto')}
                      type="number" min={1} max={4094} placeholder="Ej: 201"
                      className={inputCls()}
                    />
                  </Field>
                )}
              </div>
            </section>

            {/* SNMP */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">SNMP</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Community" error={undefined}>
                  <input value={form.snmpCommunity} onChange={set('snmpCommunity')} placeholder="public"
                    className={inputCls()} />
                </Field>
                <Field label="Versión" error={undefined}>
                  <select value={form.snmpVersion} onChange={set('snmpVersion')} className={inputCls()}>
                    <option value="1">v1</option>
                    <option value="2">v2c</option>
                    <option value="3">v3</option>
                  </select>
                </Field>
              </div>
            </section>

            {/* Ubicación */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Ubicación</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Descripción ubicación" error={undefined} className="sm:col-span-1">
                  <input value={form.ubicacion} onChange={set('ubicacion')} placeholder="Cabecera Norte — Av. km 4.5"
                    className={inputCls()} />
                </Field>
                <Field label="Latitud" error={undefined}>
                  <input value={form.latitud} onChange={set('latitud')} type="number" step="any"
                    placeholder="-5.1945" className={inputCls()} />
                </Field>
                <Field label="Longitud" error={undefined}>
                  <input value={form.longitud} onChange={set('longitud')} type="number" step="any"
                    placeholder="-80.6328" className={inputCls()} />
                </Field>
              </div>
            </section>

          </div>

          {/* Footer */}
          <div className="flex-shrink-0 flex items-center justify-end gap-2.5 px-5 py-4 border-t border-border bg-background rounded-b-2xl">
            {mutation.isError && (
              <p className="flex-1 text-xs text-red-500 truncate">
                {(mutation.error as any)?.response?.data?.message ?? 'Error al guardar'}
              </p>
            )}
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors text-foreground">
              Cancelar
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90
                         transition-colors font-medium disabled:opacity-60">
              {mutation.isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear OLT'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </Portal>
  );
}

// ─── helpers ──────────────────────────────────────────────────

function inputCls(err?: string) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground transition-colors outline-none',
    'focus:ring-2 focus:ring-primary/30 focus:border-primary',
    err ? 'border-red-500' : 'border-border hover:border-muted-foreground/50',
  );
}

function Field({
  label, error, children, className,
}: {
  label: string; error?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
