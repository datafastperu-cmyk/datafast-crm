'use client';

import { useState } from 'react';
import { Save, Plus, FileText } from 'lucide-react';
import { useToast } from '@/components/ui/toaster';

// ─── Types ───────────────────────────────────────────────────────
interface PlantillaConfig {
  id: string;
  nombre: string;
  facturacion: {
    tipo: string;
    diaPago: string;
    crearFactura: string;
    tipoImpuesto: string;
    diasGracia: string;
    aplicarCorte: string;
    aplicarMora: boolean;
    aplicarReconexion: boolean;
    impuesto1: number;
    impuesto2: number;
    impuesto3: number;
  };
  notificaciones: {
    avisoNuevaFactura: string;
    avisoPantalla: string;
    recordatoriosPago: string;
    recordatorio1: string;
    recordatorio2: string;
    recordatorio3: string;
  };
}

const DEFAULT_FACTURACION: PlantillaConfig['facturacion'] = {
  tipo: 'prepago',
  diaPago: '01',
  crearFactura: 'desactivado',
  tipoImpuesto: 'incluido',
  diasGracia: '0',
  aplicarCorte: 'desactivado',
  aplicarMora: false,
  aplicarReconexion: false,
  impuesto1: 0,
  impuesto2: 0,
  impuesto3: 0,
};

const DEFAULT_NOTIFICACIONES: PlantillaConfig['notificaciones'] = {
  avisoNuevaFactura: 'desactivado',
  avisoPantalla: 'desactivado',
  recordatoriosPago: 'desactivado',
  recordatorio1: 'desactivado',
  recordatorio2: 'desactivado',
  recordatorio3: 'desactivado',
};

const PLANTILLAS_INICIALES: PlantillaConfig[] = [
  {
    id: '1',
    nombre: 'Plantilla predeterminada',
    facturacion: { ...DEFAULT_FACTURACION },
    notificaciones: { ...DEFAULT_NOTIFICACIONES },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────
const DIAS_MES = Array.from({ length: 28 }, (_, i) =>
  String(i + 1).padStart(2, '0'),
);
const DIAS_GRACIA_OPTS = [
  { value: '0', label: '0 Días' },
  { value: '1', label: '1 Día' },
  { value: '2', label: '2 Días' },
  { value: '3', label: '3 Días' },
  { value: '5', label: '5 Días' },
  { value: '7', label: '7 Días' },
  { value: '10', label: '10 Días' },
  { value: '15', label: '15 Días' },
];
const RECORDATORIO_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  { value: '-7', label: '7 días antes' },
  { value: '-5', label: '5 días antes' },
  { value: '-3', label: '3 días antes' },
  { value: '-2', label: '2 días antes' },
  { value: '-1', label: '1 día antes' },
  { value: '0', label: 'Día de vencimiento' },
  { value: '1', label: '1 día después' },
  { value: '2', label: '2 días después' },
  { value: '3', label: '3 días después' },
  { value: '5', label: '5 días después' },
  { value: '7', label: '7 días después' },
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
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-3 py-1.5">
      <label className="text-sm text-gray-600 dark:text-gray-400 text-right pt-1.5 leading-tight">
        {label}
      </label>
      <div className="space-y-0.5">
        {children}
        {note && <p className="text-xs text-orange-500">{note}</p>}
      </div>
    </div>
  );
}

const selectCls =
  'w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500';

const inputCls =
  'w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500';

// ─── Main Page ────────────────────────────────────────────────────
export default function PlantillasConfigPage() {
  const { toast } = useToast();
  const [plantillas, setPlantillas] = useState<PlantillaConfig[]>(PLANTILLAS_INICIALES);
  const [selId, setSelId] = useState<string>(PLANTILLAS_INICIALES[0].id);
  const [nombreNueva, setNombreNueva] = useState('');

  const sel = plantillas.find(p => p.id === selId) ?? plantillas[0];

  function updateFacturacion(key: keyof PlantillaConfig['facturacion'], value: string | boolean | number) {
    setPlantillas(prev =>
      prev.map(p => p.id === selId ? { ...p, facturacion: { ...p.facturacion, [key]: value } } : p),
    );
  }
  function updateNotif(key: keyof PlantillaConfig['notificaciones'], value: string) {
    setPlantillas(prev =>
      prev.map(p => p.id === selId ? { ...p, notificaciones: { ...p.notificaciones, [key]: value } } : p),
    );
  }

  function guardarCambios() {
    toast({ title: 'Plantilla guardada', description: `"${sel.nombre}" actualizada.` });
  }

  function guardarNueva() {
    const nombre = nombreNueva.trim() || `Plantilla ${plantillas.length + 1}`;
    const nueva: PlantillaConfig = {
      id: Date.now().toString(),
      nombre,
      facturacion: { ...sel.facturacion },
      notificaciones: { ...sel.notificaciones },
    };
    setPlantillas(prev => [...prev, nueva]);
    setSelId(nueva.id);
    setNombreNueva('');
    toast({ title: 'Nueva plantilla creada', description: `"${nombre}" guardada.` });
  }

  const f = sel.facturacion;
  const n = sel.notificaciones;

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
            <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
              Seleccionar Plantilla
            </label>
            <select
              className={selectCls}
              value={selId}
              onChange={e => setSelId(e.target.value)}
            >
              {plantillas.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
              Nombre Plantilla
            </label>
            <input
              type="text"
              className={inputCls}
              placeholder="Nombre para nueva plantilla..."
              value={nombreNueva}
              onChange={e => setNombreNueva(e.target.value)}
            />
          </div>
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
                <select className={selectCls} value={f.tipo} onChange={e => updateFacturacion('tipo', e.target.value)}>
                  <option value="prepago">Prepago (Adelantado)</option>
                  <option value="postpago">Postpago (Mes vencido)</option>
                  <option value="mixto">Mixto</option>
                </select>
              </Field>

              <Field label="Día pago">
                <select className={selectCls} value={f.diaPago} onChange={e => updateFacturacion('diaPago', e.target.value)}>
                  {DIAS_MES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>

              <Field label="Crear Factura">
                <select className={selectCls} value={f.crearFactura} onChange={e => updateFacturacion('crearFactura', e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <option value="activado">Activado</option>
                </select>
              </Field>

              <Field label="Tipo impuesto">
                <select className={selectCls} value={f.tipoImpuesto} onChange={e => updateFacturacion('tipoImpuesto', e.target.value)}>
                  <option value="incluido">Impuestos incluido</option>
                  <option value="sin_impuesto">Sin impuesto</option>
                  <option value="igv">Con IGV 18%</option>
                </select>
              </Field>

              <Field label="Días de gracia" note="*días tolerancia para aplicar corte">
                <select className={selectCls} value={f.diasGracia} onChange={e => updateFacturacion('diasGracia', e.target.value)}>
                  {DIAS_GRACIA_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>

              <Field label="Aplicar Corte">
                <select className={selectCls} value={f.aplicarCorte} onChange={e => updateFacturacion('aplicarCorte', e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <option value="activado">Activado</option>
                </select>
              </Field>

              <Field label="Aplicar Mora">
                <div className="pt-1">
                  <Toggle checked={f.aplicarMora} onChange={v => updateFacturacion('aplicarMora', v)} />
                </div>
              </Field>

              <Field label="Aplicar Reconexión">
                <div className="pt-1">
                  <Toggle checked={f.aplicarReconexion} onChange={v => updateFacturacion('aplicarReconexion', v)} />
                </div>
              </Field>

              {/* Otros impuestos */}
              <div className="pt-4 pb-1">
                <h4 className="text-center text-sm font-semibold text-gray-700 dark:text-gray-200 mb-0.5">
                  Otros Impuestos
                </h4>
                <p className="text-center text-xs text-gray-500 mb-3">
                  Estos Impuestos serán Agregados al total de la factura
                </p>
                {([1, 2, 3] as const).map(n => {
                  const key = `impuesto${n}` as 'impuesto1' | 'impuesto2' | 'impuesto3';
                  return (
                    <div key={n} className="mb-2">
                      <Field label={`Impuesto #${n} (%)`} note="* Dejar en 0 (cero) para quedar deshabilitado">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          className={inputCls}
                          value={f[key]}
                          onChange={e => updateFacturacion(key, parseFloat(e.target.value) || 0)}
                        />
                      </Field>
                    </div>
                  );
                })}
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
                <select className={selectCls} value={n.avisoNuevaFactura} onChange={e => updateNotif('avisoNuevaFactura', e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="ambos">WhatsApp + SMS</option>
                </select>
              </Field>

              <Field label="Aviso en Pantalla" note="* Aviso sólo en páginas HTTP">
                <select className={selectCls} value={n.avisoPantalla} onChange={e => updateNotif('avisoPantalla', e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <option value="activado">Activado</option>
                </select>
              </Field>

              <Field label="Recordatorios de pago">
                <select className={selectCls} value={n.recordatoriosPago} onChange={e => updateNotif('recordatoriosPago', e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="ambos">WhatsApp + SMS</option>
                </select>
              </Field>

              <Field label="Recordatorio #1">
                <select className={selectCls} value={n.recordatorio1} onChange={e => updateNotif('recordatorio1', e.target.value)}>
                  {RECORDATORIO_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>

              <Field label="Recordatorio #2">
                <select className={selectCls} value={n.recordatorio2} onChange={e => updateNotif('recordatorio2', e.target.value)}>
                  {RECORDATORIO_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>

              <Field label="Recordatorio #3">
                <select className={selectCls} value={n.recordatorio3} onChange={e => updateNotif('recordatorio3', e.target.value)}>
                  {RECORDATORIO_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>

              <p className="text-xs text-orange-500 pl-[172px] pt-1">
                * Días antes/después del vencimiento de una factura
              </p>

              {/* Buttons */}
              <div className="pt-6 pb-2 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={guardarCambios}
                  className="flex items-center gap-1.5 rounded-full border border-blue-500 text-blue-600 dark:text-blue-400 px-4 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <Save className="h-3.5 w-3.5" />
                  Guardar cambios
                </button>
                <button
                  type="button"
                  onClick={guardarNueva}
                  className="flex items-center gap-1.5 rounded-full border border-blue-500 text-blue-600 dark:text-blue-400 px-4 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
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
