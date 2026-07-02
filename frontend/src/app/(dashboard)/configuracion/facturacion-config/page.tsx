'use client';

import { useState }    from 'react';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Plus, Pencil, Trash2, Star, StarOff,
  BadgeDollarSign, TrendingUp, FileCheck, Receipt,
  CheckCircle2, XCircle, AlertTriangle, Lock,
  Building2, CreditCard,
} from 'lucide-react';

import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import apiClient from '@/lib/api';

// ─── Tipos ────────────────────────────────────────────────────
interface ComprobanteConfig {
  id:               string;
  nombre:           string;
  codigo:           string;
  tieneCargaFiscal: boolean;
  serie:            string;
  correlativoActual: number;
  esDefault:        boolean;
  esProtegido:      boolean;
  activo:           boolean;
}

interface ConfiguracionFacturacion {
  moneda:                          string;
  moneda2:                         string;
  igvRate:                         number;
  moraAcumulaSiguienteCiclo:       boolean;
  reconexionAcumulaSiguienteCiclo: boolean;
}

interface Resumen {
  tiposComprobante:    ComprobanteConfig[];
  configuracion:       ConfiguracionFacturacion;
  totalEmitidas:       number;
  totalVencidas:       number;
  montoDeudaPendiente: number;
}

interface BancoItem    { id: string; nombre: string; esProtegido: boolean; activo: boolean; }
interface FormaPagoItem { id: string; nombre: string; esProtegido: boolean; activo: boolean; }

// ─── API ──────────────────────────────────────────────────────
const api = {
  getResumen:     (): Promise<Resumen> =>
    apiClient.get('/facturacion-config').then(r => {
      const d = r.data.data;
      if (d?.configuracion) {
        d.configuracion.igvRate = parseFloat(d.configuracion.igvRate) || 0;
      }
      return d;
    }),
  updateGlobal:   (data: Partial<ConfiguracionFacturacion>) =>
    apiClient.patch('/facturacion-config/global', data).then(r => r.data.data),
  crearTipo:      (data: Omit<ComprobanteConfig, 'id' | 'correlativoActual'>) =>
    apiClient.post('/facturacion-config/comprobantes', data).then(r => r.data.data),
  actualizarTipo: (id: string, data: Partial<ComprobanteConfig>) =>
    apiClient.patch(`/facturacion-config/comprobantes/${id}`, data).then(r => r.data.data),
  eliminarTipo:   (id: string) =>
    apiClient.delete(`/facturacion-config/comprobantes/${id}`).then(r => r.data.data),
  setDefault:     (id: string) =>
    apiClient.put(`/facturacion-config/comprobantes/${id}/default`).then(r => r.data.data),
};

// ─── Monedas LatAm ────────────────────────────────────────────
const MONEDAS = [
  { code: 'PEN', label: 'Sol Peruano (S/)',          pais: 'Perú' },
  { code: 'USD', label: 'Dólar Americano ($)',        pais: 'Internacional' },
  { code: 'COP', label: 'Peso Colombiano ($)',        pais: 'Colombia' },
  { code: 'MXN', label: 'Peso Mexicano ($)',          pais: 'México' },
  { code: 'CLP', label: 'Peso Chileno ($)',           pais: 'Chile' },
  { code: 'ARS', label: 'Peso Argentino ($)',         pais: 'Argentina' },
  { code: 'BOB', label: 'Boliviano (Bs.)',            pais: 'Bolivia' },
  { code: 'BRL', label: 'Real Brasileño (R$)',        pais: 'Brasil' },
  { code: 'CRC', label: 'Colón Costarricense (₡)',   pais: 'Costa Rica' },
  { code: 'GTQ', label: 'Quetzal Guatemalteco (Q)',   pais: 'Guatemala' },
  { code: 'HNL', label: 'Lempira Hondureño (L)',      pais: 'Honduras' },
  { code: 'NIO', label: 'Córdoba Nicaragüense (C$)',  pais: 'Nicaragua' },
  { code: 'PAB', label: 'Balboa Panameño (B/.)',      pais: 'Panamá' },
  { code: 'PYG', label: 'Guaraní Paraguayo (₲)',      pais: 'Paraguay' },
  { code: 'UYU', label: 'Peso Uruguayo ($U)',         pais: 'Uruguay' },
  { code: 'DOP', label: 'Peso Dominicano (RD$)',      pais: 'R. Dominicana' },
  { code: 'VES', label: 'Bolívar Venezolano (Bs.S)', pais: 'Venezuela' },
];

// ─── Schemas ──────────────────────────────────────────────────
const globalSchema = z.object({
  moneda:                          z.string().length(3),
  moneda2:                         z.string().length(3),
  igvRate:                         z.coerce.number().int().min(0).max(100),
  moraAcumulaSiguienteCiclo:       z.boolean(),
  reconexionAcumulaSiguienteCiclo: z.boolean(),
});

const tipoSchema = z.object({
  nombre:           z.string().min(2).max(100),
  codigo:           z.string().min(1).max(30).regex(/^[a-z0-9_]+$/, 'Solo minúsculas, números y _'),
  tieneCargaFiscal: z.boolean(),
  serie:            z.string().min(1).max(10),
  esDefault:        z.boolean().optional(),
});

type GlobalForm = z.infer<typeof globalSchema>;
type TipoForm  = z.infer<typeof tipoSchema>;

// ─── Componente principal ────────────────────────────────────
export default function FacturacionConfigPage() {
  const qc    = useQueryClient();
  const toast = useToast().toast;

  const [modalTipo, setModalTipo]   = useState<'crear' | ComprobanteConfig | null>(null);
  const [eliminando, setEliminando] = useState<string | null>(null);

  const { data, isLoading } = useQuery<Resumen>({
    queryKey: ['facturacion-config'],
    queryFn:  api.getResumen,
    staleTime: 60_000,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['facturacion-config'] });

  // ── Mutaciones globales ──────────────────────────────────────
  const { mutate: guardarGlobal, isPending: guardandoGlobal } = useMutation({
    mutationFn: (v: GlobalForm) =>
      api.updateGlobal(v),
    onSuccess: () => { invalidar(); toast('Configuración guardada', { type: 'success' }); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminarTipo } = useMutation({
    mutationFn: (id: string) => api.eliminarTipo(id),
    onSuccess: () => { setEliminando(null); invalidar(); toast('Tipo eliminado', { type: 'success' }); },
    onError:   (e) => { setEliminando(null); toast(parseApiError(e), { type: 'error' }); },
  });

  const { mutate: toggleDefault } = useMutation({
    mutationFn: (id: string) => api.setDefault(id),
    onSuccess: () => { invalidar(); toast('Tipo por defecto actualizado', { type: 'success' }); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  const config   = data?.configuracion;
  const tipos    = data?.tiposComprobante ?? [];

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Facturación y cobranza</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Matriz central de comprobantes, impuestos y comportamiento de cargos adicionales.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Columna izquierda ──────────────────────────────────── */}
        <div className="space-y-6">

      {/* ── Tipos de Comprobante ────────────────────────────────── */}
      <Card title="Tipos de Comprobante de Pago" icon={<Receipt className="w-4 h-4" />}
        action={
          <button onClick={() => setModalTipo('crear')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Agregar tipo
          </button>
        }>

        {tipos.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No hay tipos de comprobante configurados. Agrega al menos uno para poder facturar.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tipos.map(t => (
              <div key={t.id}
                className={cn('flex items-center gap-3 py-3', !t.activo && 'opacity-50')}>
                {/* Indicador carga fiscal */}
                <div className={cn(
                  'flex-shrink-0 w-2 h-8 rounded-full',
                  t.tieneCargaFiscal ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600',
                )} title={t.tieneCargaFiscal ? 'Con carga fiscal' : 'Sin carga fiscal'} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{t.nombre}</span>
                    {t.esDefault && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded
                                       bg-primary/10 text-primary border border-primary/20">
                        Default
                      </span>
                    )}
                    {!t.activo && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded
                                       bg-muted text-muted-foreground">
                        Inactivo
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground font-mono">
                      código: {t.codigo}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      serie: {t.serie}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      último N°: {t.correlativoActual.toString().padStart(5, '0')}
                    </span>
                    <span className={cn('flex items-center gap-1 text-xs',
                      t.tieneCargaFiscal ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                      {t.tieneCargaFiscal
                        ? <><CheckCircle2 className="w-3 h-3" /> Con IGV/IVA</>
                        : <><XCircle className="w-3 h-3" /> Sin carga fiscal</>
                      }
                    </span>
                  </div>
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleDefault(t.id)}
                    disabled={t.esDefault}
                    title={t.esDefault ? 'Ya es el tipo por defecto' : 'Establecer como defecto'}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-30">
                    {t.esDefault
                      ? <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                      : <StarOff className="w-4 h-4 text-muted-foreground" />
                    }
                  </button>
                  <button
                    onClick={() => setModalTipo(t)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <Pencil className="w-4 h-4 text-muted-foreground" />
                  </button>
                  {t.esProtegido ? (
                    <span
                      title="Comprobante de sistema — no se puede eliminar"
                      className="p-1.5 rounded-lg cursor-not-allowed opacity-40">
                      <Lock className="w-4 h-4 text-muted-foreground" />
                    </span>
                  ) : (
                    <button
                      onClick={() => setEliminando(t.id)}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Config global ───────────────────────────────────────── */}
      {config && (
        <GlobalConfigForm
          config={config}
          onSave={guardarGlobal}
          isPending={guardandoGlobal}
        />
      )}

        </div>{/* fin columna izquierda */}

        {/* ── Columna derecha ────────────────────────────────────── */}
        <div className="space-y-4">
          <BancosCard />
          <FormasPagoCard />
        </div>{/* fin columna derecha */}

      </div>{/* fin grid */}

      {/* ── Modal tipo de comprobante ───────────────────────────── */}
      {modalTipo !== null && (
        <TipoComprobanteModal
          tipo={modalTipo === 'crear' ? null : modalTipo}
          onClose={() => setModalTipo(null)}
          onSaved={() => { setModalTipo(null); invalidar(); }}
        />
      )}

      {/* ── Confirm eliminar ────────────────────────────────────── */}
      {eliminando && (
        <ConfirmDialog
          mensaje="¿Eliminar este tipo de comprobante? Esta acción no se puede deshacer."
          advertencia="Solo se puede eliminar si ningún cliente ni factura lo utiliza."
          onConfirm={() => eliminarTipo(eliminando)}
          onCancel={() => setEliminando(null)}
        />
      )}
    </div>
  );
}

// ─── Config global (moneda, igv, mora, reconexión) ─────────────
function GlobalConfigForm({
  config, onSave, isPending,
}: {
  config: ConfiguracionFacturacion;
  onSave: (v: GlobalForm) => void;
  isPending: boolean;
}) {
  const toast = useToast().toast;

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<GlobalForm>({
    resolver: zodResolver(globalSchema),
    defaultValues: {
      moneda:                          config.moneda,
      moneda2:                         config.moneda2 ?? 'USD',
      igvRate:                         Math.round(config.igvRate * 100),
      moraAcumulaSiguienteCiclo:       config.moraAcumulaSiguienteCiclo,
      reconexionAcumulaSiguienteCiclo: config.reconexionAcumulaSiguienteCiclo,
    },
  });

  const watchMora       = watch('moraAcumulaSiguienteCiclo');
  const watchReconexion = watch('reconexionAcumulaSiguienteCiclo');

  const { mutate: autoGuardar } = useMutation({
    mutationFn: (partial: Partial<ConfiguracionFacturacion>) => api.updateGlobal(partial as Partial<ConfiguracionFacturacion>),
    onSuccess: () => toast('Guardado', { type: 'success' }),
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit(onSave)}>
        <Card title="Moneda e impuestos" icon={<BadgeDollarSign className="w-4 h-4" />}
          action={
            <button type="submit" disabled={isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg
                         bg-primary text-primary-foreground font-medium
                         hover:bg-primary/90 disabled:opacity-60 transition-colors">
              {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Guardar
            </button>
          }>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Moneda principal">
              <select {...register('moneda')} className={inp()}>
                {MONEDAS.map(m => (
                  <option key={m.code} value={m.code}>{m.label} — {m.pais}</option>
                ))}
              </select>
            </Field>
            <Field label="Segunda moneda">
              <select {...register('moneda2')} className={inp()}>
                {MONEDAS.map(m => (
                  <option key={m.code} value={m.code}>{m.label} — {m.pais}</option>
                ))}
              </select>
            </Field>
            <Field label="Tasa IGV / IVA (%)" error={errors.igvRate?.message}>
              <div className="relative">
                <input type="number" step="1" min="0" max="100"
                  {...register('igvRate')} className={cn(inp(!!errors.igvRate), 'pr-8')} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </Field>
          </div>
        </Card>
      </form>

      <Card title="Comportamiento de Mora y Reconexión" icon={<AlertTriangle className="w-4 h-4" />}>
        <p className="text-xs text-muted-foreground mb-4">
          Define <strong className="text-foreground">cuándo</strong> se cobra cada cargo al cliente.
          Los montos se configuran por cliente en el wizard (paso 2).
          <span className="block mt-1">Mora: inafecta de IGV/IVA · Reconexión: afecta a IGV/IVA.</span>
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-border space-y-2">
            <Toggle
              label="Mora → siguiente ciclo de facturación"
              checked={watchMora}
              onChange={() => {
                const nuevo = !watchMora;
                setValue('moraAcumulaSiguienteCiclo', nuevo, { shouldDirty: true });
                autoGuardar({ moraAcumulaSiguienteCiclo: nuevo });
              }}
            />
            <p className="text-[11px] text-muted-foreground pl-10">
              {watchMora
                ? 'Se acumula y aparece en la factura del próximo mes.'
                : 'Se agrega como cargo adicional a la factura del mes en que se suspende.'}
            </p>
          </div>

          <div className="p-4 rounded-xl border border-border space-y-2">
            <Toggle
              label="Reconexión → siguiente ciclo de facturación"
              checked={watchReconexion}
              onChange={() => {
                const nuevo = !watchReconexion;
                setValue('reconexionAcumulaSiguienteCiclo', nuevo, { shouldDirty: true });
                autoGuardar({ reconexionAcumulaSiguienteCiclo: nuevo });
              }}
            />
            <p className="text-[11px] text-muted-foreground pl-10">
              {watchReconexion
                ? 'Se acumula y aparece en la factura del próximo mes.'
                : 'Se agrega como cargo adicional a la factura del mes en que se suspende.'}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Modal crear/editar tipo de comprobante ───────────────────
function TipoComprobanteModal({
  tipo, onClose, onSaved,
}: {
  tipo: ComprobanteConfig | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast().toast;
  const esEdicion = tipo !== null;

  const { register, handleSubmit, watch, setValue, formState: { errors, isDirty } } = useForm<TipoForm>({
    resolver: zodResolver(tipoSchema),
    defaultValues: tipo ? {
      nombre:           tipo.nombre,
      codigo:           tipo.codigo,
      tieneCargaFiscal: tipo.tieneCargaFiscal,
      serie:            tipo.serie,
      esDefault:        tipo.esDefault,
    } : {
      nombre: '', codigo: '', tieneCargaFiscal: true, serie: '', esDefault: false,
    },
  });

  const watchCargaFiscal = watch('tieneCargaFiscal');

  const { mutate, isPending } = useMutation({
    mutationFn: (v: TipoForm) => esEdicion
      ? api.actualizarTipo(tipo!.id, v)
      : api.crearTipo(v as any),
    onSuccess: () => { toast(esEdicion ? 'Tipo actualizado' : 'Tipo creado', { type: 'success' }); onSaved(); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground mb-4">
          {esEdicion ? `Editar: ${tipo!.nombre}` : 'Nuevo tipo de comprobante'}
        </h3>

        <form onSubmit={handleSubmit(v => mutate(v))} className="space-y-4">
          <Field label="Nombre visible" error={errors.nombre?.message}>
            <input {...register('nombre')} placeholder="Ej: Factura, Recibo, Comprobante Interno"
              className={inp(!!errors.nombre)} />
          </Field>

          <Field label="Código interno (único, sin espacios)" error={errors.codigo?.message}>
            <input {...register('codigo')} placeholder="Ej: fac, rec, ci"
              disabled={esEdicion}
              className={cn(inp(!!errors.codigo), esEdicion && 'opacity-60 cursor-not-allowed')} />
            {esEdicion && (
              <p className="text-[11px] text-muted-foreground mt-1">
                El código no puede cambiarse una vez creado.
              </p>
            )}
          </Field>

          <Field label="Serie de numeración" error={errors.serie?.message}>
            <input {...register('serie')} placeholder="Ej: F001, R001, CI"
              className={cn(inp(!!errors.serie), 'font-mono')} />
          </Field>

          {/* Toggle carga fiscal */}
          <div className={cn(
            'flex items-center justify-between p-3 rounded-xl border-2 transition-colors',
            watchCargaFiscal ? 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20' : 'border-border',
          )}>
            <div>
              <p className="text-sm font-medium text-foreground">Carga fiscal (IGV/IVA)</p>
              <p className="text-xs text-muted-foreground">
                {watchCargaFiscal
                  ? 'Aplica impuesto sobre el total del comprobante'
                  : 'Comprobante interno sin desglose de impuestos'}
              </p>
            </div>
            <button type="button"
              onClick={() => setValue('tieneCargaFiscal', !watchCargaFiscal, { shouldDirty: true })}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                watchCargaFiscal ? 'bg-amber-500' : 'bg-muted',
              )}>
              <span className={cn(
                'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                watchCargaFiscal && 'translate-x-5',
              )} />
            </button>
          </div>

          <Toggle label="Establecer como tipo por defecto de la empresa"
            {...register('esDefault')} checked={watch('esDefault') ?? false} />

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={isPending || !isDirty}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                         bg-primary text-primary-foreground hover:bg-primary/90
                         disabled:opacity-60 transition-colors">
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {esEdicion ? 'Guardar cambios' : 'Crear tipo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────
function ConfirmDialog({ mensaje, advertencia, onConfirm, onCancel }: {
  mensaje: string; advertencia?: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-6 shadow-xl">
        <p className="text-sm font-medium text-foreground">{mensaje}</p>
        {advertencia && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{advertencia}</p>
        )}
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel}
            className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground
                       hover:bg-destructive/90 transition-colors">
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bancos ───────────────────────────────────────────────
function BancosCard() {
  const qc    = useQueryClient();
  const toast = useToast().toast;
  const [modal, setModal] = useState<'crear' | BancoItem | null>(null);

  const { data: bancos = [] } = useQuery<BancoItem[]>({
    queryKey: ['bancos-isp'],
    queryFn:  () => apiClient.get('/facturacion-config/bancos').then(r => r.data.data ?? []),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['bancos-isp'] });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/facturacion-config/bancos/${id}`),
    onSuccess: () => { invalidar(); toast('Banco eliminado', { type: 'success' }); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <>
      <Card title="Bancos" icon={<Building2 className="w-4 h-4" />}
        subtitle="Opciones disponibles al registrar pagos."
        action={
          <button onClick={() => setModal('crear')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                       bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Agregar banco
          </button>
        }>
        <div className="divide-y divide-border">
          {bancos.map(b => (
            <div key={b.id} className="flex items-center gap-3 py-3">
              <div className="flex-shrink-0 w-2 h-8 rounded-full bg-blue-400 dark:bg-blue-500" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{b.nombre}</span>
                  {b.esProtegido && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded
                                     bg-muted text-muted-foreground">Sistema</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setModal(b)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <Pencil className="w-4 h-4 text-muted-foreground" />
                </button>
                {b.esProtegido ? (
                  <span title="Del sistema — no se puede eliminar"
                    className="p-1.5 cursor-not-allowed opacity-40">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </span>
                ) : (
                  <button onClick={() => eliminar(b.id)}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {modal !== null && (
        <ItemNombreModal
          titulo={modal === 'crear' ? 'Agregar banco' : 'Editar banco'}
          label="Nombre del Banco"
          placeholder="Ej: BCP, Interbank, Scotiabank"
          defaultValue={modal === 'crear' ? '' : (modal as BancoItem).nombre}
          btnConfirmar={modal === 'crear' ? 'Agregar' : 'Guardar'}
          mutationFn={(nombre) => modal === 'crear'
            ? apiClient.post('/facturacion-config/bancos', { nombre }).then(r => r.data)
            : apiClient.patch(`/facturacion-config/bancos/${(modal as BancoItem).id}`, { nombre }).then(r => r.data)
          }
          onClose={() => setModal(null)}
          onSaved={() => {
            const msg = modal === 'crear' ? 'Banco agregado' : 'Banco actualizado';
            setModal(null);
            invalidar();
            toast(msg, { type: 'success' });
          }}
        />
      )}
    </>
  );
}

// ─── Formas de Pago ───────────────────────────────────────
function FormasPagoCard() {
  const qc    = useQueryClient();
  const toast = useToast().toast;
  const [modal, setModal] = useState<'crear' | FormaPagoItem | null>(null);

  const { data: formas = [] } = useQuery<FormaPagoItem[]>({
    queryKey: ['formas-pago-isp'],
    queryFn:  () => apiClient.get('/facturacion-config/formas-pago').then(r => r.data.data ?? []),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['formas-pago-isp'] });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/facturacion-config/formas-pago/${id}`),
    onSuccess: () => { invalidar(); toast('Forma de pago eliminada', { type: 'success' }); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <>
      <Card title="Formas de Pago" icon={<CreditCard className="w-4 h-4" />}
        subtitle="Opciones disponibles al registrar pagos."
        action={
          <button onClick={() => setModal('crear')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                       bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Agregar
          </button>
        }>
        <div className="divide-y divide-border">
          {formas.map(f => (
            <div key={f.id} className="flex items-center gap-3 py-3">
              <div className="flex-shrink-0 w-2 h-8 rounded-full bg-emerald-400 dark:bg-emerald-500" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{f.nombre}</span>
                  {f.esProtegido && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded
                                     bg-muted text-muted-foreground">Sistema</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setModal(f)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <Pencil className="w-4 h-4 text-muted-foreground" />
                </button>
                {f.esProtegido ? (
                  <span title="Del sistema — no se puede eliminar"
                    className="p-1.5 cursor-not-allowed opacity-40">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </span>
                ) : (
                  <button onClick={() => eliminar(f.id)}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {modal !== null && (
        <ItemNombreModal
          titulo={modal === 'crear' ? 'Agregar forma de pago' : 'Editar forma de pago'}
          label="Nombre"
          placeholder="Ej: Yape, Plin, Cheque"
          defaultValue={modal === 'crear' ? '' : (modal as FormaPagoItem).nombre}
          btnConfirmar={modal === 'crear' ? 'Aceptar' : 'Guardar'}
          mutationFn={(nombre) => modal === 'crear'
            ? apiClient.post('/facturacion-config/formas-pago', { nombre }).then(r => r.data)
            : apiClient.patch(`/facturacion-config/formas-pago/${(modal as FormaPagoItem).id}`, { nombre }).then(r => r.data)
          }
          onClose={() => setModal(null)}
          onSaved={() => {
            const msg = modal === 'crear' ? 'Forma de pago agregada' : 'Forma de pago actualizada';
            setModal(null);
            invalidar();
            toast(msg, { type: 'success' });
          }}
        />
      )}
    </>
  );
}

// ─── Modal genérico nombre ────────────────────────────────
function ItemNombreModal({
  titulo, label, placeholder, defaultValue, btnConfirmar,
  onClose, onSaved, mutationFn,
}: {
  titulo: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  btnConfirmar: string;
  onClose: () => void;
  onSaved: () => void;
  mutationFn: (nombre: string) => Promise<unknown>;
}) {
  const toast = useToast().toast;
  const [nombre, setNombre] = useState(defaultValue);

  const { mutate, isPending } = useMutation({
    mutationFn: () => mutationFn(nombre.trim()),
    onSuccess:  () => onSaved(),
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground mb-4">{titulo}</h3>
        <Field label={label}>
          <input
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && nombre.trim()) mutate(); }}
            placeholder={placeholder}
            className={inp()}
            autoFocus
          />
        </Field>
        <div className="flex gap-3 mt-5">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => mutate()}
            disabled={isPending || !nombre.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                       bg-primary text-primary-foreground hover:bg-primary/90
                       disabled:opacity-60 transition-colors">
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {btnConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────
function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string;
  color: 'blue' | 'green' | 'amber' | 'red';
}) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400',
    green:  'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
    amber:  'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
    red:    'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400',
  };
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', colors[color])}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-base font-semibold text-foreground font-mono">{value}</p>
      </div>
    </div>
  );
}

function Card({ title, icon, children, action, subtitle }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; subtitle?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Toggle({ label, checked, ...props }: { label: string; checked: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <input type="checkbox" className="sr-only" checked={checked} {...props} />
      <div className={cn(
        'relative w-9 h-5 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
      )}>
        <span className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-4',
        )} />
      </div>
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

function inp(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
