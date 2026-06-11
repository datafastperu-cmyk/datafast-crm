'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Plus, FileText, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toaster';
import { plantillasAbonadosApi } from '@/lib/api/plantillas-abonados';
import type { PlantillaAbonado, FacturacionConfig, NotificacionesConfig } from '@/lib/api/plantillas-abonados';
import { plantillasApi } from '@/lib/api/plantillas';
import { parseApiError } from '@/lib/utils';

// ─── Defaults ────────────────────────────────────────────────────
const DEFAULT_FACTURACION: FacturacionConfig = {
  tipo: 'prepago', diaPago: '01', crearFactura: 'desactivado',
  plantillaAvisoFactura: '',
  tipoImpuesto: 'incluido', diasGracia: '0', aplicarCorte: 'desactivado',
  aplicarMora: false, montoMora: 0, aplicarReconexion: false, montoReconexion: 0,
  impuesto1: 0,
};
const DEFAULT_NOTIFICACIONES: NotificacionesConfig = {
  avisoNuevaFactura: 'desactivado', avisoPantalla: 'desactivado',
  recordatoriosPago: 'desactivado', recordatorio1: 'desactivado',
  recordatorio2: 'desactivado', recordatorio3: 'desactivado',
  plantillaRecordatorio1: '', plantillaRecordatorio2: '', plantillaRecordatorio3: '',
};

// ─── Opciones ─────────────────────────────────────────────────────
const DIAS_MES = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, '0'));

const CREAR_FACTURA_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  ...Array.from({ length: 25 }, (_, i) => ({
    value: String(i + 1),
    label: i === 0 ? '1 día antes' : `${i + 1} días antes`,
  })),
];

const DIAS_GRACIA_OPTS = [
  { value: '0', label: '0 Días' },
  ...Array.from({ length: 25 }, (_, i) => ({
    value: String(i + 1),
    label: i === 0 ? '1 Día' : `${i + 1} Días`,
  })),
];

const APLICAR_CORTE_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  ...Array.from({ length: 5 }, (_, i) => ({
    value: String(i + 1),
    label: i === 0 ? '1 mes vencido' : `${i + 1} meses vencidos`,
  })),
];

const RECORDATORIO_ANTES = Array.from({ length: 10 }, (_, i) => ({
  value: String(-(i + 1)),
  label: i === 0 ? '1 Día Antes' : `${i + 1} Días Antes`,
}));
const RECORDATORIO_DESPUES = Array.from({ length: 25 }, (_, i) => ({
  value: String(i + 1),
  label: i === 0 ? '1 Día Después' : `${i + 1} Días Después`,
}));

// ─── Sub-components ───────────────────────────────────────────────
function DecimalInput({ value, onChange, className, placeholder }: {
  value: number; onChange: (v: number) => void; className?: string; placeholder?: string;
}) {
  const [display, setDisplay] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDisplay(value.toFixed(2)); }, [value, focused]);
  return (
    <input
      type="text" inputMode="decimal" className={className} placeholder={placeholder}
      value={display}
      onChange={e => setDisplay(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = Math.max(0, parseFloat(display) || 0);
        const formatted = parsed.toFixed(2);
        setDisplay(formatted);
        onChange(parseFloat(formatted));
      }}
    />
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-blue-500' : 'bg-muted'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
        checked ? 'translate-x-4' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 py-1.5">
      <label className="text-xs font-medium text-foreground block">{label}</label>
      <div className="space-y-0.5">
        {children}
        {note && <p className="text-xs text-orange-500">{note}</p>}
      </div>
    </div>
  );
}

const selectCls = 'w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const inputCls  = 'w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

// ─── Page ─────────────────────────────────────────────────────────
export default function PlantillasConfigPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rawPlantillas, isLoading } = useQuery<PlantillaAbonado[]>({
    queryKey: ['plantillas-abonados'],
    queryFn: plantillasAbonadosApi.list,
  });
  const plantillas = Array.isArray(rawPlantillas) ? rawPlantillas : [];

  const { data: rawPlantillasMsg } = useQuery({
    queryKey: ['plantillas', 'whatsapp'],
    queryFn: () => plantillasApi.listar('whatsapp'),
  });
  const plantillasMsg = Array.isArray(rawPlantillasMsg) ? rawPlantillasMsg : [];

  const [selId, setSelId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nombreNueva, setNombreNueva] = useState('');
  const [facturacion, setFact] = useState<FacturacionConfig>({ ...DEFAULT_FACTURACION });
  const [notificaciones, setNotif] = useState<NotificacionesConfig>({ ...DEFAULT_NOTIFICACIONES });

  // Carga la plantilla seleccionada por el usuario (sin preselección automática)
  function seleccionarPlantilla(id: string) {
    if (!id) {
      setSelId(null);
      setFact({ ...DEFAULT_FACTURACION });
      setNotif({ ...DEFAULT_NOTIFICACIONES });
      return;
    }
    const p = plantillas.find(x => x.id === id);
    if (!p) return;
    setSelId(id);
    setFact({ ...DEFAULT_FACTURACION, ...p.facturacion });
    setNotif({ ...DEFAULT_NOTIFICACIONES, ...p.notificaciones });
  }

  const mutUpdate = useMutation({
    mutationFn: ({ id, nombre }: { id: string; nombre: string }) =>
      plantillasAbonadosApi.update(id, { nombre, facturacion, notificaciones }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plantillas-abonados'] });
      toast('Plantilla guardada', { description: 'Los cambios fueron guardados.' });
    },
    onError: (e) => toast('Error', { description: parseApiError(e), type: 'error' }),
  });

  const mutCreate = useMutation({
    mutationFn: (nombre: string) =>
      plantillasAbonadosApi.create({ nombre, facturacion, notificaciones }),
    onSuccess: (nueva) => {
      qc.invalidateQueries({ queryKey: ['plantillas-abonados'] });
      setSelId(nueva.id);
      setNombreNueva('');
      toast('Plantilla creada', { description: `"${nueva.nombre}" guardada.` });
    },
    onError: (e) => toast('Error', { description: parseApiError(e), type: 'error' }),
  });

  const mutDelete = useMutation({
    mutationFn: (id: string) => plantillasAbonadosApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plantillas-abonados'] });
      setSelId(null);
      toast('Plantilla eliminada');
    },
    onError: (e) => toast('Error', { description: parseApiError(e), type: 'error' }),
  });

  const selPlantilla = plantillas.find(p => p.id === selId);

  function guardarCambios() {
    if (!selId || !selPlantilla) return;
    mutUpdate.mutate({ id: selId, nombre: selPlantilla.nombre });
  }

  function guardarNueva() {
    const nombre = nombreNueva.trim();
    if (!nombre) {
      toast('Nombre requerido', { description: 'Ingresa un nombre para la nueva plantilla.', type: 'warning' });
      return;
    }
    mutCreate.mutate(nombre);
  }

  const busy = mutUpdate.isPending || mutCreate.isPending;

  function updateF<K extends keyof FacturacionConfig>(k: K, v: FacturacionConfig[K]) {
    setFact(prev => ({ ...prev, [k]: v }));
  }
  function updateN<K extends keyof NotificacionesConfig>(k: K, v: NotificacionesConfig[K]) {
    setNotif(prev => ({ ...prev, [k]: v }));
  }

  return (
    <div className="p-0 min-h-screen bg-background">
      {/* Header */}
      <div className="bg-[hsl(var(--sidebar-bg))] text-white px-6 py-3 flex items-center gap-2 shadow">
        <FileText className="h-4 w-4 text-white/60" />
        <span className="text-sm font-semibold tracking-wide">Plantillas de configuración</span>
      </div>

      <div className="p-6 space-y-4 max-w-6xl">
        {/* Selector + Nombre */}
        <div className="bg-card rounded-lg border border-border px-5 py-4 flex flex-wrap gap-6 items-center">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <label className="text-sm text-muted-foreground whitespace-nowrap">Seleccionar Plantilla</label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
              </div>
            ) : (
              <select
                className={selectCls}
                value={selId ?? ''}
                onChange={e => seleccionarPlantilla(e.target.value)}
              >
                <option value="">— Seleccionar plantilla —</option>
                {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <label className="text-sm text-muted-foreground whitespace-nowrap">
              Nombre Plantilla <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className={`${inputCls} ${!nombreNueva.trim() ? 'border-red-300 focus:ring-red-400' : ''}`}
              placeholder="Requerido para guardar nueva plantilla"
              value={nombreNueva}
              onChange={e => setNombreNueva(e.target.value)}
            />
          </div>
          {selId && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={mutDelete.isPending}
              className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Facturación ── */}
          <div className="bg-card rounded-lg border border-border">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Facturación</span>
            </div>
            <div className="px-4 py-3 space-y-0.5">
              <Field label="Tipo">
                <select className={selectCls} value={facturacion.tipo} onChange={e => updateF('tipo', e.target.value)}>
                  <option value="prepago">Prepago (Adelantado)</option>
                  <option value="postpago">Postpago (Mes vencido)</option>
                </select>
              </Field>
              <Field label="Día pago">
                <select className={selectCls} value={facturacion.diaPago} onChange={e => updateF('diaPago', e.target.value)}>
                  {DIAS_MES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Crear Factura">
                <select className={selectCls} value={facturacion.crearFactura} onChange={e => updateF('crearFactura', e.target.value)}>
                  {CREAR_FACTURA_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Aviso de factura disponible">
                <select
                  className={selectCls}
                  value={facturacion.plantillaAvisoFactura ?? ''}
                  onChange={e => updateF('plantillaAvisoFactura', e.target.value)}
                >
                  <option value="">— Sin plantilla específica —</option>
                  {plantillasMsg.map(p => (
                    <option key={p.id ?? p.codigo} value={p.id ?? p.codigo}>{p.nombre}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo impuesto">
                <select className={selectCls} value={facturacion.tipoImpuesto} onChange={e => updateF('tipoImpuesto', e.target.value)}>
                  <option value="ninguno">Ninguno</option>
                  <option value="incluido">Impuestos incluidos</option>
                  <option value="mas_impuestos">Más impuestos</option>
                </select>
              </Field>
              <Field label="Días de gracia" note="*días tolerancia para aplicar corte">
                <select className={selectCls} value={facturacion.diasGracia} onChange={e => updateF('diasGracia', e.target.value)}>
                  {DIAS_GRACIA_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Aplicar Corte">
                <select className={selectCls} value={facturacion.aplicarCorte} onChange={e => updateF('aplicarCorte', e.target.value)}>
                  {APLICAR_CORTE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Aplicar Mora">
                <div className="flex items-center gap-3 pt-1">
                  <Toggle checked={facturacion.aplicarMora} onChange={v => updateF('aplicarMora', v)} />
                  {facturacion.aplicarMora && (
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="text-sm text-muted-foreground">S/</span>
                      <DecimalInput
                        className={inputCls}
                        placeholder="Monto de mora"
                        value={facturacion.montoMora}
                        onChange={v => updateF('montoMora', v)}
                      />
                    </div>
                  )}
                </div>
              </Field>
              <Field label="Aplicar Reconexión">
                <div className="flex items-center gap-3 pt-1">
                  <Toggle checked={facturacion.aplicarReconexion} onChange={v => updateF('aplicarReconexion', v)} />
                  {facturacion.aplicarReconexion && (
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="text-sm text-muted-foreground">S/</span>
                      <DecimalInput
                        className={inputCls}
                        placeholder="Monto de reconexión"
                        value={facturacion.montoReconexion}
                        onChange={v => updateF('montoReconexion', v)}
                      />
                    </div>
                  )}
                </div>
              </Field>

              <div className="pt-4 pb-1">
                <h4 className="text-center text-sm font-semibold text-foreground mb-0.5">Otros Impuestos</h4>
                <p className="text-center text-xs text-muted-foreground mb-3">Estos Impuestos serán Agregados al total de la factura</p>
                <div className="mb-2">
                  <Field label="Impuesto #1 (%)" note="* Dejar en 0 (cero) para quedar deshabilitado">
                    <DecimalInput
                      className={inputCls}
                      value={facturacion.impuesto1}
                      onChange={v => updateF('impuesto1', v)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </div>

          {/* ── Notificaciones ── */}
          <div className="bg-card rounded-lg border border-border">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-4-5.659V4a2 2 0 10-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="text-sm font-semibold text-foreground">Notificaciones</span>
            </div>
            <div className="px-4 py-3 space-y-0.5">
              <Field label="Aviso nueva factura">
                <select className={selectCls} value={notificaciones.avisoNuevaFactura} onChange={e => updateN('avisoNuevaFactura', e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="ambos">WhatsApp + SMS</option>
                </select>
              </Field>
              <Field label="Aviso en Pantalla" note="* Aviso sólo en páginas HTTP">
                <select className={selectCls} value={notificaciones.avisoPantalla} onChange={e => updateN('avisoPantalla', e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <option value="activado">Activado</option>
                </select>
              </Field>
              <Field label="Recordatorios de pago">
                <select className={selectCls} value={notificaciones.recordatoriosPago} onChange={e => updateN('recordatoriosPago', e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="ambos">WhatsApp + SMS</option>
                </select>
              </Field>
              {(['recordatorio1', 'recordatorio2', 'recordatorio3'] as const).map((key, i) => {
                const plantillaKey = `plantillaRecordatorio${i + 1}` as keyof NotificacionesConfig;
                return (
                  <Field key={key} label={`Recordatorio #${i + 1}`}>
                    <select className={selectCls} value={notificaciones[key]} onChange={e => updateN(key, e.target.value)}>
                      <option value="desactivado">Desactivado</option>
                      <optgroup label="Antes del vencimiento">
                        {RECORDATORIO_ANTES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </optgroup>
                      <optgroup label="Después del vencimiento">
                        {RECORDATORIO_DESPUES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </optgroup>
                    </select>
                    <select
                      className={selectCls}
                      value={(notificaciones[plantillaKey] as string) ?? ''}
                      onChange={e => updateN(plantillaKey, e.target.value)}
                    >
                      <option value="">— Sin plantilla específica —</option>
                      {plantillasMsg.map(p => (
                        <option key={p.id ?? p.codigo} value={p.id ?? p.codigo}>{p.nombre}</option>
                      ))}
                    </select>
                  </Field>
                );
              })}
              <p className="text-xs text-orange-500 pt-1">
                * Días antes/después del vencimiento de una factura
              </p>

              {/* Botones */}
              <div className="pt-6 pb-2 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={guardarCambios}
                  disabled={busy || !selId}
                  className="flex items-center gap-1.5 rounded-full border border-blue-500 text-blue-600 dark:text-blue-400 px-4 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                >
                  {mutUpdate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Guardar cambios
                </button>
                <button
                  type="button"
                  onClick={guardarNueva}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-full border border-blue-500 text-blue-600 dark:text-blue-400 px-4 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                >
                  {mutCreate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Guardar Nueva plantilla
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && selId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <p className="font-semibold text-foreground">Eliminar plantilla</p>
            <p className="text-sm text-muted-foreground">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setConfirmDelete(false)} disabled={mutDelete.isPending}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={() => { mutDelete.mutate(selId); setConfirmDelete(false); }} disabled={mutDelete.isPending}
                className="flex-1 py-2 text-sm rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-60">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
