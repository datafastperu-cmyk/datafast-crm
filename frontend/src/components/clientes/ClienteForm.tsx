'use client';

import { useState }       from 'react';
import { useRouter }      from 'next/navigation';
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import { useMutation }    from '@tanstack/react-query';
import { Loader2, Search, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';

import { clientesApi, type CreateClienteDto } from '@/lib/api/clientes';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Schema ──────────────────────────────────────────────────
const schema = z.object({
  tipoDocumento:    z.enum(['dni','ruc','ce','pasaporte']),
  numeroDocumento:  z.string().min(7, 'Mínimo 7 caracteres').max(12),
  nombres:          z.string().min(2, 'Nombre requerido'),
  apellidoPaterno:  z.string().min(2, 'Apellido paterno requerido'),
  apellidoMaterno:  z.string().optional(),
  email:            z.string().email('Email inválido').optional().or(z.literal('')),
  telefono:         z.string().min(7, 'Teléfono requerido'),
  telefonoAlt:      z.string().optional(),
  whatsapp:         z.string().optional(),
  direccion:        z.string().min(5, 'Dirección requerida'),
  referencia:       z.string().optional(),
  departamento:     z.string().optional(),
  provincia:        z.string().optional(),
  distrito:         z.string().optional(),
  tipoServicio:     z.enum(['ftth','wisp','dedicado','mixto']).optional(),
  esEmpresa:        z.boolean().optional(),
  rucEmpresa:       z.string().optional(),
  razonSocial:      z.string().optional(),
  notasInternas:    z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  clienteId?: string;         // Si viene → modo edición
  initialValues?: Partial<FormValues>;
  onSuccess?: (id: string) => void;
}

export function ClienteForm({ clienteId, initialValues, onSuccess }: Props) {
  const router        = useRouter();
  const { toast }     = useToast();
  const isEdit        = !!clienteId;

  const [reniecStatus, setReniecStatus] = useState<
    'idle' | 'loading' | 'ok' | 'error'
  >('idle');
  const [reniecMsg, setReniecMsg] = useState('');

  const {
    register, handleSubmit, setValue, watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: {
      tipoDocumento: 'dni',
      esEmpresa:     false,
      tipoServicio:  'ftth',
      ...initialValues,
    },
  });

  const tipoDoc   = watch('tipoDocumento');
  const esEmpresa = watch('esEmpresa');

  // ── RENIEC Lookup ─────────────────────────────────────────
  const consultarReniec = async () => {
    const dni = watch('numeroDocumento')?.trim();
    if (!dni || dni.length !== 8) {
      toast('El DNI debe tener 8 dígitos', { type: 'warning' });
      return;
    }

    setReniecStatus('loading');
    setReniecMsg('');

    try {
      const datos = await clientesApi.consultarReniec(dni);

      setValue('nombres',         datos.nombres,         { shouldDirty: true });
      setValue('apellidoPaterno', datos.apellidoPaterno, { shouldDirty: true });
      setValue('apellidoMaterno', datos.apellidoMaterno, { shouldDirty: true });

      if (datos.departamento)  setValue('departamento', datos.departamento);
      if (datos.provincia)     setValue('provincia',    datos.provincia);
      if (datos.distrito)      setValue('distrito',     datos.distrito);
      if (datos.direccion)     setValue('direccion',    datos.direccion);

      setReniecStatus('ok');
      setReniecMsg(`Datos obtenidos: ${datos.nombres} ${datos.apellidoPaterno}`);
    } catch (err) {
      setReniecStatus('error');
      setReniecMsg(parseApiError(err));
    }
  };

  // ── Guardar ───────────────────────────────────────────────
  const { mutate: guardar, isPending } = useMutation({
    mutationFn: async (values: FormValues) => {
      const dto: CreateClienteDto = {
        ...values,
        email:       values.email || undefined,
        telefonoAlt: values.telefonoAlt || undefined,
        whatsapp:    values.whatsapp || undefined,
        referencia:  values.referencia || undefined,
      };
      return isEdit
        ? clientesApi.update(clienteId!, dto)
        : clientesApi.create(dto);
    },
    onSuccess: (cliente) => {
      toast(
        isEdit ? 'Cliente actualizado' : 'Cliente registrado',
        { type: 'success', description: cliente.nombreCompleto },
      );
      onSuccess ? onSuccess(cliente.id) : router.push(`/clientes/${cliente.id}`);
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  return (
    <form onSubmit={handleSubmit((v) => guardar(v))} className="space-y-6">

      {/* Botón volver */}
      {!isEdit && (
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>
      )}

      {/* ── SECCIÓN 1: Identificación ─────────────────────── */}
      <Section title="Identificación">

        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo de documento" error={errors.tipoDocumento?.message}>
            <select {...register('tipoDocumento')} className={inputCls()}>
              <option value="dni">DNI</option>
              <option value="ruc">RUC</option>
              <option value="ce">Carné de extranjería</option>
              <option value="pasaporte">Pasaporte</option>
            </select>
          </Field>

          <Field label="Número de documento" error={errors.numeroDocumento?.message}>
            <div className="flex gap-2">
              <input
                {...register('numeroDocumento')}
                placeholder={tipoDoc === 'dni' ? '12345678' : '10123456789'}
                className={inputCls(!!errors.numeroDocumento)}
              />
              {tipoDoc === 'dni' && (
                <button
                  type="button"
                  onClick={consultarReniec}
                  disabled={reniecStatus === 'loading'}
                  className="flex-shrink-0 px-3 rounded-lg border border-input bg-muted
                             text-sm font-medium hover:bg-muted/70 transition-colors
                             disabled:opacity-50"
                  title="Consultar RENIEC"
                >
                  {reniecStatus === 'loading'
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Search className="w-4 h-4" />}
                </button>
              )}
            </div>
            {/* Resultado RENIEC */}
            {reniecStatus !== 'idle' && (
              <div className={cn(
                'flex items-start gap-2 mt-1.5 text-xs rounded-lg px-2.5 py-1.5',
                reniecStatus === 'ok'
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                  : reniecStatus === 'error'
                  ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
                  : 'bg-muted text-muted-foreground',
              )}>
                {reniecStatus === 'ok'
                  ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  : <AlertCircle  className="w-3.5 h-3.5 flex-shrink-0 mt-px" />}
                {reniecMsg}
              </div>
            )}
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Nombres" error={errors.nombres?.message}>
            <input {...register('nombres')} placeholder="Juan Carlos" className={inputCls(!!errors.nombres)} />
          </Field>
          <Field label="Apellido paterno" error={errors.apellidoPaterno?.message}>
            <input {...register('apellidoPaterno')} placeholder="Pérez" className={inputCls(!!errors.apellidoPaterno)} />
          </Field>
          <Field label="Apellido materno">
            <input {...register('apellidoMaterno')} placeholder="García" className={inputCls()} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" {...register('esEmpresa')} className="rounded" />
          <span className="text-foreground">Es empresa / persona jurídica</span>
        </label>

        {esEmpresa && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg border border-border">
            <Field label="RUC">
              <input {...register('rucEmpresa')} placeholder="20123456789" className={inputCls()} />
            </Field>
            <Field label="Razón social">
              <input {...register('razonSocial')} placeholder="Mi Empresa S.A.C." className={inputCls()} />
            </Field>
          </div>
        )}
      </Section>

      {/* ── SECCIÓN 2: Contacto ───────────────────────────── */}
      <Section title="Datos de contacto">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Teléfono principal *" error={errors.telefono?.message}>
            <input {...register('telefono')} placeholder="987654321" className={inputCls(!!errors.telefono)} />
          </Field>
          <Field label="Teléfono alternativo">
            <input {...register('telefonoAlt')} placeholder="987654322" className={inputCls()} />
          </Field>
          <Field label="WhatsApp">
            <input {...register('whatsapp')} placeholder="987654321" className={inputCls()} />
          </Field>
          <Field label="Correo electrónico" error={errors.email?.message}>
            <input {...register('email')} type="email" placeholder="juan@correo.pe" className={inputCls(!!errors.email)} />
          </Field>
        </div>
      </Section>

      {/* ── SECCIÓN 3: Dirección ──────────────────────────── */}
      <Section title="Dirección de instalación">
        <Field label="Dirección completa *" error={errors.direccion?.message}>
          <input
            {...register('direccion')}
            placeholder="Av. Sánchez Cerro 1234, Piura"
            className={inputCls(!!errors.direccion)}
          />
        </Field>
        <Field label="Referencia">
          <input {...register('referencia')} placeholder="A media cuadra del parque" className={inputCls()} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Departamento">
            <input {...register('departamento')} placeholder="Piura" className={inputCls()} />
          </Field>
          <Field label="Provincia">
            <input {...register('provincia')} placeholder="Piura" className={inputCls()} />
          </Field>
          <Field label="Distrito">
            <input {...register('distrito')} placeholder="Piura" className={inputCls()} />
          </Field>
        </div>
      </Section>

      {/* ── SECCIÓN 4: Servicio y notas ───────────────────── */}
      <Section title="Servicio">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo de servicio">
            <select {...register('tipoServicio')} className={inputCls()}>
              <option value="ftth">FTTH (fibra hasta el hogar)</option>
              <option value="wisp">WISP (inalámbrico)</option>
              <option value="dedicado">Dedicado</option>
              <option value="mixto">Mixto</option>
            </select>
          </Field>
        </div>
        <Field label="Notas internas">
          <textarea
            {...register('notasInternas')}
            rows={3}
            placeholder="Observaciones del técnico, referencias de ubicación, etc."
            className={cn(inputCls(), 'resize-none')}
          />
        </Field>
      </Section>

      {/* ── Acciones ─────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-sm rounded-lg border border-input
                     hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending || (!isDirty && isEdit)}
          className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium
                     hover:bg-primary/90 transition-colors
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Guardar cambios' : 'Registrar cliente'}
        </button>
      </div>
    </form>
  );
}

// ─── Helpers de UI ────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground pb-2 border-b border-border">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label, error, children,
}: {
  label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function inputCls(hasError = false): string {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
