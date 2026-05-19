'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Plus, FileText, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toaster';
import { plantillasAbonadosApi } from '@/lib/api/plantillas-abonados';
import type { PlantillaAbonado, FacturacionConfig, NotificacionesConfig } from '@/lib/api/plantillas-abonados';
import { parseApiError } from '@/lib/utils';

// ─── Defaults ────────────────────────────────────────────────────
const DEFAULT_FACTURACION: FacturacionConfig = {
  tipo: 'prepago', diaPago: '01', crearFactura: 'desactivado',
  tipoImpuesto: 'incluido', diasGracia: '0', aplicarCorte: 'desactivado',
  aplicarMora: false, montoMora: 0, aplicarReconexion: false, montoReconexion: 0,
  impuesto1: 0, impuesto2: 0, impuesto3: 0,
};
const DEFAULT_NOTIFICACIONES: NotificacionesConfig = {
  avisoNuevaFactura: 'desactivado', avisoPantalla: 'desactivado',
  recordatoriosPago: 'desactivado', recordatorio1: 'desactivado',
  recordatorio2: 'desactivado', recordatorio3: 'desactivado',
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

const RECORDATORIO_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  ...Array.from({ length: 10 }, (_, i) => ({
    value: String(-(i + 1)),
    label: i === 0 ? '1 día antes' : `${i + 1} días antes`,
  })),
  ...Array.from({ length: 25 }, (_, i) => ({
    value: String(i + 1),
    label: i === 0 ? '1 día después' : `${i + 1} días después`,
  })),
];

// ─── Sub-components ───────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-4' : 'translate-x-0.5'
      }`} />
    </button>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-3 py-1.5">
      <label className="text-sm text-gray-600 dark:text-gray-400 text-right pt-1.5 leading-tight">{label}</label>
      <div className="space-y-0.5">
        {children}
        {note && <p className="text-xs text-orange-500">{note}</p>}
      </div>
    </div>
  );
}

const selectCls = 'w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500';
const inputCls  = 'w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500';

// ─── Page ─────────────────────────────────────────────────────────
export default function PlantillasConfigPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: plantillas = [], isLoading } = useQuery<PlantillaAbonado[]>({
    queryKey: ['plantillas-abonados'],
    queryFn: plantillasAbonadosApi.list,
  });

  const [selId, setSelId] = useState<string | null>(null);
  const [nombreNueva, setNombreNueva] = useState('');
  const [facturacion, setFact] = useState<FacturacionConfig>({ ...DEFAULT_FACTURACION });
  const [notificaciones, setNotif] = useState<NotificacionesConfig>({ ...DEFAULT_NOTIFICACIONES });

  // Cuando cargan las plantillas, selecciona la primera
  useEffect(() => {
    if (plantillas.length > 0 && selId === null) {
      const primera = plantillas[0];
      setSelId(primera.id);
      setFact({ ...DEFAULT_FACTURACION, ...primera.facturacion });
      setNotif({ ...DEFAULT_NOTIFICACIONES, ...primera.notificaciones });
    }
  }, [plantillas, selId]);

  // Cuando cambia la selección, carga sus datos
  function seleccionarPlantilla(id: string) {
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
    <div className="p-0 min-h-screen bg-gray-100 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-gray-800 dark:bg-gray-900 text-white px-6 py-3 flex items-center gap-2 shadow">
        <FileText className="h-4 w-4 text-gray-300" />
        <span className="text-sm font-semibold tracking-wide">Plantillas de configuración</span>
      </div>

      <div className="p-6 space-y-4 max-w-6xl">
        {/* Selector + Nombre */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 px-5 py-4 flex flex-wrap gap-6 items-center">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Seleccionar Plantilla</label>
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
                {plantillas.length === 0 && <option value="">Sin plantillas</option>}
                {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
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
              onClick={() => { if (confirm('¿Eliminar esta plantilla?')) mutDelete.mutate(selId); }}
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
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
              <FileText className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Facturación</span>
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
                      <span className="text-sm text-gray-500">S/</span>
                      <input
                        type="number" min={0} step={0.01}
                        className={inputCls}
                        placeholder="Monto de mora"
                        value={facturacion.montoMora}
                        onChange={e => updateF('montoMora', parseFloat(e.target.value) || 0)}
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
                      <span className="text-sm text-gray-500">S/</span>
                      <input
                        type="number" min={0} step={0.01}
                        className={inputCls}
                        placeholder="Monto de reconexión"
                        value={facturacion.montoReconexion}
                        onChange={e => updateF('montoReconexion', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  )}
                </div>
              </Field>

              <div className="pt-4 pb-1">
                <h4 className="text-center text-sm font-semibold text-gray-700 dark:text-gray-200 mb-0.5">Otros Impuestos</h4>
                <p className="text-center text-xs text-gray-500 mb-3">Estos Impuestos serán Agregados al total de la factura</p>
                {(['impuesto1', 'impuesto2', 'impuesto3'] as const).map((key, i) => (
                  <div key={key} className="mb-2">
                    <Field label={`Impuesto #${i + 1} (%)`} note="* Dejar en 0 (cero) para quedar deshabilitado">
                      <input
                        type="number" min={0} max={100} step={0.01}
                        className={inputCls}
                        value={facturacion[key]}
                        onChange={e => updateF(key, parseFloat(e.target.value) || 0)}
                      />
                    </Field>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Notificaciones ── */}
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-4-5.659V4a2 2 0 10-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Notificaciones</span>
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
              {(['recordatorio1', 'recordatorio2', 'recordatorio3'] as const).map((key, i) => (
                <Field key={key} label={`Recordatorio #${i + 1}`}>
                  <select className={selectCls} value={notificaciones[key]} onChange={e => updateN(key, e.target.value)}>
                    {RECORDATORIO_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              ))}
              <p className="text-xs text-orange-500 pl-[172px] pt-1">
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
    </div>
  );
}
