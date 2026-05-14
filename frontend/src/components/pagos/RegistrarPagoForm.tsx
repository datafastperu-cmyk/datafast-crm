'use client';

import { useState }       from 'react';
import { useRouter }      from 'next/navigation';
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, ArrowLeft, Upload, X } from 'lucide-react';

import { pagosApi, METODOS_PAGO, REQUIERE_NUM_OPERACION, type RegistrarPagoDto } from '@/lib/api/facturacion';
import { facturacionApi }  from '@/lib/api/facturacion';
import { clientesApi }     from '@/lib/api/clientes';
import { useToast }        from '@/components/ui/toaster';
import { formatPEN, parseApiError, cn } from '@/lib/utils';

const schema = z.object({
  clienteId:       z.string().optional(),
  facturaId:       z.string().optional(),
  contratoId:      z.string().optional(),
  monto:           z.coerce.number().positive('El monto debe ser mayor a 0'),
  metodoPago:      z.string().min(1, 'Selecciona el método'),
  banco:           z.string().optional(),
  numeroOperacion: z.string().optional(),
  numeroCuenta:    z.string().optional(),
  fechaPago:       z.string().min(1, 'Fecha requerida'),
  notas:           z.string().optional(),
  autoVerificar:   z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (REQUIERE_NUM_OPERACION.has(data.metodoPago as any) && !data.numeroOperacion?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `El número de operación es obligatorio para ${data.metodoPago}`,
      path: ['numeroOperacion'],
    });
  }
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

  const {
    register, handleSubmit, watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: {
      clienteId,
      facturaId,
      contratoId,
      fechaPago:     hoy,
      metodoPago:    'efectivo',
      autoVerificar: false,
    },
  });

  const metodoPago    = watch('metodoPago');
  const facIdWatch    = watch('facturaId');
  const clienteIdW    = watch('clienteId');
  const requiereNum   = REQUIERE_NUM_OPERACION.has(metodoPago as any);
  const requiresBanco = ['transferencia_bancaria','deposito_bancario','cheque'].includes(metodoPago);

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
        metodoPago:      values.metodoPago,
        banco:           values.banco || undefined,
        numeroOperacion: values.numeroOperacion || undefined,
        numeroCuenta:    values.numeroCuenta || undefined,
        fechaPago:       values.fechaPago,
        notas:           values.notas || undefined,
        comprobanteUrl:  comprobanteUrl || undefined,
        autoVerificar:   values.autoVerificar || metodoPago === 'efectivo',
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
        <div className="grid grid-cols-2 gap-4">
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

      {/* ── SECCIÓN 2: Método ─────────────────────────── */}
      <Section title="Método de pago">
        <Field label="Método *" error={errors.metodoPago?.message}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {METODOS_PAGO.slice(0, 6).map(({ value, label }) => (
              <label key={value}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer',
                  'text-sm transition-all',
                  metodoPago === value
                    ? 'border-primary bg-primary/5 text-primary font-medium'
                    : 'border-input hover:border-muted-foreground',
                )}>
                <input type="radio" value={value} {...register('metodoPago')} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
          {/* Otros métodos como select */}
          <select {...register('metodoPago')}
            className={cn(input(), 'mt-2 text-xs text-muted-foreground')}>
            {METODOS_PAGO.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>

        {/* Número de operación */}
        {requiereNum && (
          <Field label={`N° de operación ${requiereNum ? '*' : ''}`} error={errors.numeroOperacion?.message}>
            <input
              {...register('numeroOperacion')}
              placeholder={metodoPago === 'yape' ? 'Ej: 12345678' : 'N° de transacción'}
              className={input(!!errors.numeroOperacion)}
            />
            <p className="text-xs text-muted-foreground">
              Requerido para detectar pagos duplicados automáticamente.
            </p>
          </Field>
        )}

        {/* Banco */}
        {requiresBanco && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Banco">
              <select {...register('banco')} className={input()}>
                <option value="">— Seleccionar —</option>
                {(cuentas as any[]).length > 0
                  ? (cuentas as any[]).map((c) => (
                    <option key={c.id} value={c.banco}>
                      {c.banco} ···{c.numeroCuenta?.slice(-4)} ({c.moneda})
                    </option>
                  ))
                  : ['BCP','BBVA','Interbank','Scotiabank','BanBif','Financiero'].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
              </select>
            </Field>
            <Field label="Últimos 4 dígitos de cuenta">
              <input {...register('numeroCuenta')} placeholder="6411" maxLength={4} className={input()} />
            </Field>
          </div>
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
        {metodoPago !== 'efectivo' && (
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
    'w-full px-3 py-2 text-sm rounded-lg border bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
