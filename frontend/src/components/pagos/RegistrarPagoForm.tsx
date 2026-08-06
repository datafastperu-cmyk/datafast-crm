'use client';

import { useState, useEffect } from 'react';
import { useRouter }      from 'next/navigation';
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, ArrowLeft, Upload, X } from 'lucide-react';

import { pagosApi, type RegistrarPagoDto } from '@/lib/api/facturacion';
import { facturacionApi }  from '@/lib/api/facturacion';
import { clientesApi }     from '@/lib/api/clientes';
import { useToast }        from '@/components/ui/toaster';
import { formatPEN, parseApiError, cn } from '@/lib/utils';

// Los tres ejes de un ingreso: cómo pagó (forma), por qué medio (canal) y dónde entró el
// dinero (cuenta receptora). El tercero es el que faltaba: hasta F1 el ERP sabía que
// entraron S/ 85 por Yape y no sabía en qué cuenta estaban.
//
// La obligatoriedad del número de operación la decide el CANAL, no una lista en el
// frontend: si la regla viviera aquí, el portal y la app móvil tendrían otra.
const schema = z.object({
  clienteId:       z.string().optional(),
  facturaId:       z.string().optional(),
  contratoId:      z.string().optional(),
  monto:           z.coerce.number().positive('El monto debe ser mayor a 0'),
  formaPago:       z.string().min(1, 'Selecciona la forma de pago'),
  canalPagoId:     z.string().min(1, 'Selecciona el canal'),
  cuentaReceptoraId: z.string().optional(),
  numeroOperacion: z.string().optional(),
  fechaPago:       z.string().min(1, 'Fecha requerida'),
  notas:           z.string().optional(),
  autoVerificar:   z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  clienteId?:  string;
  facturaId?:  string;
  contratoId?: string;
  onSuccess?:  () => void;
}

export function RegistrarPagoForm({ clienteId, facturaId, contratoId, onSuccess }: Props) {
  const router    = useRouter();
  const { toast } = useToast();
  const hoy       = new Date().toISOString().split('T')[0];
  const [comprobanteUrl, setComprobanteUrl] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile]   = useState(false);

  // Una clave por apertura del formulario, repetida en cada intento. Es lo que impide que
  // un doble clic o un reintento del navegador creen DOS cobros: el efectivo no tiene
  // número de operación, así que sin esto no había nada que los distinguiera.
  const [idempotencyKey] = useState(() =>
    (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  );

  const {
    register, handleSubmit, watch, setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: {
      clienteId,
      facturaId,
      contratoId,
      fechaPago:     hoy,
      formaPago:     'efectivo',
      autoVerificar: false,
    },
  });

  const formaPago     = watch('formaPago');
  const canalPagoId   = watch('canalPagoId');
  const facIdWatch    = watch('facturaId');
  const clienteIdW    = watch('clienteId');

  // Catálogos. `soloManuales` deja fuera los canales que solo crea una pasarela: ofrecer
  // MercadoPago en la caja permitiría registrar a mano un cobro que el webhook va a
  // registrar solo, y el ingreso acabaría contado dos veces.
  const { data: formas = [] } = useQuery({
    queryKey: ['formas-pago'], queryFn: pagosApi.getFormas, staleTime: Infinity,
  });
  const { data: canales = [] } = useQuery({
    queryKey: ['canales-pago'], queryFn: () => pagosApi.getCanales(true), staleTime: 5 * 60_000,
  });

  const canalesDeLaForma = canales.filter((c) => c.formaPago === formaPago);
  const canal            = canales.find((c) => c.id === canalPagoId);
  const requiereNum      = !!canal?.requiereNumeroOperacion;

  // Al cambiar de forma, el canal anterior deja de ser válido. Se preselecciona el único
  // si solo hay uno — pedirle al cajero que elija entre una opción es fricción sin motivo.
  useEffect(() => {
    if (canal && canal.formaPago === formaPago) return;
    setValue('canalPagoId', canalesDeLaForma.length === 1 ? canalesDeLaForma[0].id : '');
  }, [formaPago, canales.length]); // eslint-disable-line

  // La cuenta la SUGIERE el canal; el operador puede cambiarla si tiene permiso.
  useEffect(() => {
    if (canal?.cuentaReceptoraDefaultId) {
      setValue('cuentaReceptoraId', canal.cuentaReceptoraDefaultId);
    }
  }, [canalPagoId]); // eslint-disable-line

  // Cargar datos de la factura si hay facturaId
  const { data: factura } = useQuery({
    queryKey: ['factura-mini', facIdWatch],
    queryFn:  () => facturacionApi.getById(facIdWatch!),
    enabled:  !!facIdWatch && facIdWatch.length === 36,
    staleTime: Infinity,
  });

  // Cargar cliente
  const { data: cliente } = useQuery({
    queryKey: ['cliente-mini', clienteIdW],
    queryFn:  () => clientesApi.getById(clienteIdW!),
    enabled:  !!clienteIdW && clienteIdW.length === 36,
    staleTime: Infinity,
  });

  // Cuentas bancarias de la empresa
  const { data: cuentas = [] } = useQuery({
    queryKey: ['cuentas-bancarias'],
    queryFn:  pagosApi.getCuentasBancarias,
    staleTime: Infinity,
  });

  const { mutate: registrar, isPending } = useMutation({
    mutationFn: (values: FormValues) => {
      const dto: RegistrarPagoDto = {
        clienteId:       values.clienteId || clienteId,
        facturaId:       values.facturaId || undefined,
        contratoId:      values.contratoId || undefined,
        monto:           values.monto,
        canalPagoId:     values.canalPagoId,
        cuentaReceptoraId: values.cuentaReceptoraId || undefined,
        // `metodoPago` se sigue enviando: la columna se conserva escrita para que el
        // histórico se lea tal como se registró, y es lo que hace reversible la migración
        // de catálogos. El backend deriva su valor del canal si no coincide.
        metodoPago:      canal?.codigo ?? values.formaPago,
        numeroOperacion: values.numeroOperacion || undefined,
        fechaPago:       values.fechaPago,
        notas:           values.notas || undefined,
        comprobanteUrl:  comprobanteUrl || undefined,
        autoVerificar:   values.autoVerificar || values.formaPago === 'efectivo',
        idempotencyKey,
      };
      return pagosApi.registrar(dto);
    },
    onSuccess: (pago) => {
      toast(
        pago.estado === 'verificado' ? '✓ Pago registrado y aplicado' : 'Pago registrado — pendiente de verificación',
        { type: 'success', description: `${formatPEN(pago.monto)} · ${pago.metodoPago}` },
      );
      onSuccess ? onSuccess() : router.push('/pagos');
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      // En producción: POST /api/v1/pagos/{id}/comprobante
      // Aquí simulamos un URL de preview del objeto local
      const url = URL.createObjectURL(file);
      setComprobanteUrl(url);
      toast('Comprobante cargado', { type: 'success' });
    } catch { toast('Error al cargar archivo', { type: 'error' }); }
    finally { setUploadingFile(false); }
  };

  return (
    <form onSubmit={handleSubmit((v) => registrar(v))} className="space-y-5">

      <button type="button" onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Volver
      </button>

      {/* Info de factura/cliente si vienen pre-cargados */}
      {(factura || cliente) && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-1">
          {factura && (
            <>
              <p className="text-sm font-semibold text-foreground">
                {factura.numeroCompleto} · {formatPEN(factura.total)}
              </p>
              <p className="text-xs text-muted-foreground">
                {factura.descripcion}
                {(factura.saldo ?? 0) > 0 && <span className="text-destructive font-medium ml-2">Saldo: {formatPEN(factura.saldo)}</span>}
              </p>
            </>
          )}
          {cliente && !factura && (
            <p className="text-sm font-semibold text-foreground">{cliente.nombreCompleto}</p>
          )}
        </div>
      )}

      {/* ── SECCIÓN 1: Importe ────────────────────────── */}
      <Section title="Importe">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Monto (S/) *" error={errors.monto?.message}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">S/</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                {...register('monto')}
                placeholder="0.00"
                className={cn(input(!!errors.monto), 'pl-8')}
              />
            </div>
          </Field>
          <Field label="Fecha de pago *" error={errors.fechaPago?.message}>
            <input type="date" {...register('fechaPago')} className={input(!!errors.fechaPago)} />
          </Field>
        </div>

        {/* Factura asociada si no vino como prop */}
        {!facturaId && (
          <Field label="Factura a aplicar (UUID — opcional)">
            <input {...register('facturaId')} placeholder="Dejar vacío para abono general" className={input()} />
          </Field>
        )}
      </Section>

      {/* ── SECCIÓN 2: Forma → Canal → Cuenta ─────────── */}
      <Section title="Cómo pagó">
        <Field label="Forma de pago *" error={errors.formaPago?.message}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {formas.map(({ codigo, nombre }) => (
              <label key={codigo}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer',
                  'text-sm transition-all',
                  formaPago === codigo
                    ? 'border-primary bg-primary/5 text-primary font-medium'
                    : 'border-input hover:border-muted-foreground',
                )}>
                <input type="radio" value={codigo} {...register('formaPago')} className="sr-only" />
                {nombre}
              </label>
            ))}
          </div>
        </Field>

        {/* El canal depende de la forma. Sin canales configurados no se inventa uno:
            se dice qué falta y dónde arreglarlo. */}
        <Field label="Canal *" error={errors.canalPagoId?.message}>
          {canalesDeLaForma.length === 0 ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              No hay canales configurados para esta forma de pago.
              Créalos en Finanzas → Ajustes de Cobranza.
            </p>
          ) : (
            <select {...register('canalPagoId')} className={input(!!errors.canalPagoId)}>
              <option value="">— Seleccionar —</option>
              {canalesDeLaForma.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          )}
        </Field>

        {/* Dónde entró el dinero. Se sugiere desde el canal; cambiarla es un movimiento
            de tesorería, así que va como decisión explícita del operador. */}
        {canal && (
          <Field label="Cuenta receptora">
            <select {...register('cuentaReceptoraId')} className={input()}>
              <option value="">— Sin asignar —</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre ?? c.banco}
                  {c.numeroCuenta ? ` ···${c.numeroCuenta.slice(-4)}` : ''} ({c.moneda})
                </option>
              ))}
            </select>
            {canal.cuentaReceptoraDefaultId ? (
              <p className="text-xs text-muted-foreground">
                Sugerida por el canal «{canal.nombre}». Cámbiala solo si el dinero entró en otra.
              </p>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Este canal no tiene cuenta por defecto — indica dónde entró el dinero.
              </p>
            )}
          </Field>
        )}

        {/* La obligatoriedad la decide el canal, no una lista en el frontend. */}
        {requiereNum && (
          <Field label="N° de operación *" error={errors.numeroOperacion?.message}>
            <input
              {...register('numeroOperacion')}
              placeholder="N° de transacción"
              className={input(!!errors.numeroOperacion)}
            />
            <p className="text-xs text-muted-foreground">
              Es lo que impide cobrar dos veces la misma operación.
            </p>
          </Field>
        )}

        {canal && (Number(canal.comisionPorcentaje) > 0 || Number(canal.comisionFija) > 0) && (
          <p className="text-xs text-muted-foreground">
            Este canal retiene comisión ({canal.comisionPorcentaje}% + S/ {canal.comisionFija}).
            El abonado paga el importe completo; la comisión se registra como gasto.
          </p>
        )}
      </Section>

      {/* ── SECCIÓN 3: Comprobante ────────────────────── */}
      <Section title="Comprobante / Voucher">
        <div className="space-y-3">
          {comprobanteUrl ? (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-green-200 bg-green-50
                            dark:bg-green-950/20 dark:border-green-800">
              <CheckIcon />
              <p className="text-sm font-medium text-green-700 dark:text-green-400 flex-1">
                Comprobante cargado
              </p>
              <button type="button" onClick={() => setComprobanteUrl(null)}
                className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl
                              border-2 border-dashed border-border hover:border-primary
                              cursor-pointer transition-colors text-center">
              {uploadingFile
                ? <Loader2 className="w-6 h-6 animate-spin text-primary" />
                : <Upload className="w-6 h-6 text-muted-foreground" />}
              <div>
                <p className="text-sm font-medium text-foreground">Subir foto del voucher</p>
                <p className="text-xs text-muted-foreground">JPG, PNG o PDF · máx. 5MB</p>
              </div>
              <input type="file" accept="image/*,.pdf" className="sr-only" onChange={handleFileUpload} />
            </label>
          )}
        </div>
      </Section>

      {/* ── SECCIÓN 4: Notas y opciones ───────────────── */}
      <Section title="Notas">
        <Field label="Observaciones">
          <textarea {...register('notas')} rows={2} placeholder="Notas adicionales del cajero…"
            className={cn(input(), 'resize-none')} />
        </Field>
        {formaPago !== 'efectivo' && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" {...register('autoVerificar')} className="rounded mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Verificar automáticamente</p>
              <p className="text-xs text-muted-foreground">
                Omite la revisión manual y aplica el pago a la factura de inmediato.
              </p>
            </div>
          </label>
        )}
      </Section>

      {/* Acciones */}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.back()}
          className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={isPending}
          className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium
                     hover:bg-primary/90 transition-colors disabled:opacity-60">
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Registrar pago
        </button>
      </div>
    </form>
  );
}

// ─── Componentes ──────────────────────────────────────────────
function CheckIcon() {
  return <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground pb-2 border-b border-border">{title}</h3>
      {children}
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

function input(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
