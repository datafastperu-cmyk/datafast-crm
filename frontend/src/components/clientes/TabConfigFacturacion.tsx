'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, FileText } from 'lucide-react';
import { clientesApi } from '@/lib/api/clientes';
import { plantillasAbonadosApi } from '@/lib/api/plantillas-abonados';
import { plantillasApi } from '@/lib/api/plantillas';
import { useToast } from '@/components/ui/toaster';
import { parseApiError } from '@/lib/utils';
import type { FacturacionConfig, NotificacionesConfig } from '@/lib/api/plantillas-abonados';

// ── Defaults ──────────────────────────────────────────────────────
const DEF_FACT: FacturacionConfig = {
  tipo: 'prepago', diaPago: '01', crearFactura: 'desactivado',
  plantillaAvisoFactura: '',
  esquemaImpuesto: 'incluido', diasGracia: '0', aplicarCorte: 'desactivado',
  aplicarMora: false, montoMora: 0, aplicarReconexion: false, montoReconexion: 0,
  impuesto1: 0,
};
const DEF_NOTIF: NotificacionesConfig = {
  avisoNuevaFactura: 'desactivado', avisoPantalla: 'desactivado',
  recordatoriosPago: 'desactivado', recordatorio1: 'desactivado',
  recordatorio2: 'desactivado', recordatorio3: 'desactivado',
  plantillaRecordatorio1: '', plantillaRecordatorio2: '', plantillaRecordatorio3: '',
};

// ── Opciones ──────────────────────────────────────────────────────
const DIAS_MES = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, '0'));

const CREAR_FACTURA_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  ...Array.from({ length: 25 }, (_, i) => ({
    value: String(i + 1), label: i === 0 ? '1 día antes' : `${i + 1} días antes`,
  })),
];
const DIAS_GRACIA_OPTS = [
  { value: '0', label: '0 Días' },
  ...Array.from({ length: 25 }, (_, i) => ({
    value: String(i + 1), label: i === 0 ? '1 Día' : `${i + 1} Días`,
  })),
];
const APLICAR_CORTE_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  ...Array.from({ length: 5 }, (_, i) => ({
    value: String(i + 1), label: i === 0 ? '1 mes vencido' : `${i + 1} meses vencidos`,
  })),
];
const BAJAR_VEL_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  { value: '512k', label: '512 Kbps' },
  { value: '1m', label: '1 Mbps' },
  { value: '2m', label: '2 Mbps' },
];
const RECORDATORIO_ANTES = Array.from({ length: 10 }, (_, i) => ({
  value: String(-(i + 1)), label: i === 0 ? '1 Día Antes' : `${i + 1} Días Antes`,
}));
const RECORDATORIO_DESPUES = Array.from({ length: 25 }, (_, i) => ({
  value: String(i + 1), label: i === 0 ? '1 Día Después' : `${i + 1} Días Después`,
}));

// ── Helpers ───────────────────────────────────────────────────────
const selectCls = 'w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const inputCls  = 'w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-blue-500' : 'bg-muted'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function DecimalInput({ value, onChange, className, placeholder }: {
  value: number; onChange: (v: number) => void; className?: string; placeholder?: string;
}) {
  const [display, setDisplay] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDisplay(value.toFixed(2)); }, [value, focused]);
  return (
    <input type="text" inputMode="decimal" className={className} placeholder={placeholder}
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

// ── Date calculations ─────────────────────────────────────────────
export function calcularFechas(diaPago: string, crearFactura: string, diasGracia: string) {
  const hoy = new Date();
  const dia = parseInt(diaPago, 10) || 1;

  let pago = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
  if (pago <= hoy) pago = new Date(hoy.getFullYear(), hoy.getMonth() + 1, dia);

  const fmt = (d: Date) =>
    d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const corte = diasGracia === '0' || diasGracia === 'desactivado'
    ? null
    : new Date(pago.getTime() + parseInt(diasGracia, 10) * 86400000);

  const crearDias = parseInt(crearFactura, 10);
  const crear = isNaN(crearDias) || crearFactura === 'desactivado'
    ? null
    : new Date(pago.getTime() - crearDias * 86400000);

  return {
    pago: fmt(pago),
    corte: corte ? fmt(corte) : null,
    crear: crear ? fmt(crear) : null,
  };
}

export function calcularFechaRecordatorio(diaPago: string, valor: string): string | null {
  if (valor === 'desactivado') return null;
  const hoy = new Date();
  const dia = parseInt(diaPago, 10) || 1;
  let pago = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
  if (pago <= hoy) pago = new Date(hoy.getFullYear(), hoy.getMonth() + 1, dia);
  const offset = parseInt(valor, 10);
  if (isNaN(offset)) return null;
  const fecha = new Date(pago.getTime() + offset * 86400000);
  return fecha.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Main component ────────────────────────────────────────────────
export function TabConfigFacturacion({ clienteId }: { clienteId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['cliente-facturacion-config', clienteId],
    queryFn: () => clientesApi.getFacturacionConfig(clienteId),
  });

  const { data: plantillas = [] } = useQuery({
    queryKey: ['plantillas-abonados'],
    queryFn: plantillasAbonadosApi.list,
  });
  const { data: plantillasMsg = [] } = useQuery({
    queryKey: ['plantillas', 'whatsapp'],
    queryFn: () => plantillasApi.listar('whatsapp'),
  });

  const [facturacion, setFact] = useState<FacturacionConfig>({ ...DEF_FACT });
  const [notificaciones, setNotif] = useState<NotificacionesConfig>({ ...DEF_NOTIF });
  const [bajarVelocidad, setBajarVelocidad] = useState('desactivado');
  const [fechaFija, setFechaFija] = useState('');
  const [corteFijoProgramado, setCorteFijoProgramado] = useState('');

  useEffect(() => {
    if (!data) return;
    if (data.facturacion) {
      const f = data.facturacion as any;
      setFact({ ...DEF_FACT, ...f });
      setBajarVelocidad(f.bajarVelocidad ?? 'desactivado');
      setFechaFija(f.fechaFija ?? '');
      setCorteFijoProgramado(f.corteFijoProgramado ?? '');
    }
    if (data.notificaciones) setNotif({ ...DEF_NOTIF, ...(data.notificaciones as any) });
  }, [data]);

  const mut = useMutation({
    mutationFn: () => clientesApi.saveFacturacionConfig(clienteId, {
      ...facturacion, bajarVelocidad, fechaFija: fechaFija || null, corteFijoProgramado: corteFijoProgramado || null,
    }, notificaciones),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cliente-facturacion-config', clienteId] });
      qc.invalidateQueries({ queryKey: ['cliente', clienteId] });
      qc.invalidateQueries({ queryKey: ['plantillas-abonados'] });
      toast('Configuración guardada', { type: 'success' });
    },
    onError: (e) => toast('Error', { description: parseApiError(e), type: 'error' }),
  });

  function cargarPlantilla(id: string) {
    const p = plantillas.find(x => x.id === id);
    if (!p) return;
    setFact({ ...DEF_FACT, ...p.facturacion });
    setNotif({ ...DEF_NOTIF, ...p.notificaciones });
  }

  function updateF<K extends keyof FacturacionConfig>(k: K, v: FacturacionConfig[K]) {
    setFact(prev => ({ ...prev, [k]: v }));
  }
  function updateN<K extends keyof NotificacionesConfig>(k: K, v: NotificacionesConfig[K]) {
    setNotif(prev => ({ ...prev, [k]: v }));
  }

  const fechas = calcularFechas(facturacion.diaPago, facturacion.crearFactura, facturacion.diasGracia);
  const recFechas = (['recordatorio1', 'recordatorio2', 'recordatorio3'] as const).map(k =>
    calcularFechaRecordatorio(facturacion.diaPago, notificaciones[k]),
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Seleccionar plantilla */}
      <div className="flex items-center gap-3 bg-muted/30 border border-border rounded-lg px-4 py-3">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Configurar usando plantilla</span>
        <select className={selectCls} defaultValue="" onChange={e => { if (e.target.value) cargarPlantilla(e.target.value); }}>
          <option value="">Seleccionar...</option>
          {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

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
              <select className={selectCls} value={facturacion.plantillaAvisoFactura ?? ''} onChange={e => updateF('plantillaAvisoFactura', e.target.value)}>
                <option value="">— Sin plantilla específica —</option>
                {plantillasMsg.map(p => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
              </select>
            </Field>
            <Field label="Esquema de impuesto">
              <select className={selectCls} value={facturacion.esquemaImpuesto} onChange={e => updateF('esquemaImpuesto', e.target.value)}>
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
            <Field label="Bajar Velocidad" note="*Cancela velocidad del cliente y no suspende. Se aplica el límite de velocidad. Automáticamente cuando el cliente paga salen sus facturas.">
              <select className={selectCls} value={bajarVelocidad} onChange={e => setBajarVelocidad(e.target.value)}>
                {BAJAR_VEL_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Fecha Fija">
              <input type="date" className={inputCls} value={fechaFija}
                onChange={e => setFechaFija(e.target.value)} />
            </Field>
            <Field label="Corte Fijo Programado">
              <input type="date" className={inputCls} value={corteFijoProgramado}
                onChange={e => setCorteFijoProgramado(e.target.value)} />
            </Field>
            <Field label="Aplicar Mora">
              <div className="flex items-center gap-3 pt-1">
                <Toggle checked={facturacion.aplicarMora} onChange={v => updateF('aplicarMora', v)} />
                {facturacion.aplicarMora && (
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-sm text-muted-foreground">S/</span>
                    <DecimalInput className={inputCls} placeholder="Monto mora"
                      value={facturacion.montoMora} onChange={v => updateF('montoMora', v)} />
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
                    <DecimalInput className={inputCls} placeholder="Monto reconexión"
                      value={facturacion.montoReconexion} onChange={v => updateF('montoReconexion', v)} />
                  </div>
                )}
              </div>
            </Field>

            <div className="pt-4 pb-1">
              <h4 className="text-center text-sm font-semibold text-foreground mb-0.5">Otros Impuestos</h4>
              <p className="text-center text-xs text-muted-foreground mb-3">Estos Impuestos serán Agregados al total de la factura</p>
              <div className="mb-2">
                <Field label="Impuesto #1 (%)" note="* Dejar en 0 (cero) para quedar deshabilitado">
                  <DecimalInput className={inputCls} value={facturacion.impuesto1} onChange={v => updateF('impuesto1', v)} />
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
                  <select className={selectCls} value={(notificaciones[plantillaKey] as string) ?? ''} onChange={e => updateN(plantillaKey, e.target.value)}>
                    <option value="">— Sin plantilla específica —</option>
                    {plantillasMsg.map(p => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
                  </select>
                </Field>
              );
            })}
            <p className="text-xs text-orange-500 pt-1">
              * Días antes/después del vencimiento de una factura
            </p>

            {/* Fechas calculadas — debajo de Recordatorio #3 */}
            <div className="pt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 px-3 py-2 text-xs text-center">
                <span className="text-muted-foreground">Día de pago: </span>
                <span className="font-semibold text-yellow-700 dark:text-yellow-400">{fechas.pago}</span>
              </div>
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 px-3 py-2 text-xs text-center">
                <span className="text-muted-foreground">Día de corte: </span>
                <span className="font-semibold text-red-600 dark:text-red-400">{fechas.corte ?? 'Sin corte'}</span>
              </div>
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 px-3 py-2 text-xs text-center">
                <span className="text-muted-foreground">Crear factura: </span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">{fechas.crear ?? 'Desactivado'}</span>
              </div>
            </div>

            {/* Preview recordatorios */}
            <div className="pt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Aviso pantalla: </span>
                <span className="font-medium">{notificaciones.avisoPantalla === 'activado' ? 'Activado' : 'Desactivado'}</span>
              </div>
              {(['recordatorio1', 'recordatorio2', 'recordatorio3'] as const).map((key, i) => {
                const fecha = recFechas[i];
                const label = notificaciones[key] === 'desactivado' ? 'Desactivado' : (fecha ?? '—');
                const colors = [
                  'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800',
                  'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
                  'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700',
                ];
                return (
                  <div key={key} className={`rounded-lg border px-3 py-2 text-xs ${colors[i]}`}>
                    <span className="text-muted-foreground">Recordatorio #{i + 1}: </span>
                    <span className="font-medium">{label}</span>
                  </div>
                );
              })}
            </div>

            {/* Botón guardar */}
            <div className="pt-4 pb-1 flex justify-center">
              <button type="button" onClick={() => mut.mutate()} disabled={mut.isPending}
                className="btn-primary">
                {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Guardar cambios
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
