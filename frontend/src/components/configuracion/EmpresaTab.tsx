'use client';

import { useEffect, useState } from 'react';
import { useForm }             from 'react-hook-form';
import { zodResolver }         from '@hookform/resolvers/zod';
import { z }                   from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Upload, Building2, Globe, ExternalLink, Info,
  ShieldCheck, ShieldAlert, ShieldX, RefreshCw, AlertTriangle,
} from 'lucide-react';

import { configApi, type UpdateEmpresaDto } from '@/lib/api/configuracion';
import api from '@/lib/api';
import type { ApiRespuesta } from '@/types';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

const schema = z.object({
  razonSocial:       z.string().min(3, 'Mínimo 3 caracteres'),
  ruc:               z.string().length(11, 'El RUC debe tener 11 dígitos'),
  direccion:         z.string().optional(),
  whatsappCorporativo:    z.string().min(7, 'Ingresa el número de WhatsApp'),
  telefonoInformativo:    z.string().optional(),
  email:                  z.string().email('Email inválido').optional().or(z.literal('')),
  websiteUrl:        z.string().url('URL inválida (ej: https://miisp.com)').optional().or(z.literal('')),
  dominio: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function EmpresaTab() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const { data: empresa, isLoading } = useQuery({
    queryKey: ['empresa'],
    queryFn:  configApi.getEmpresa,
    staleTime: 5 * 60_000,
  });

  const {
    register, handleSubmit, reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: {},
  });

  useEffect(() => {
    if (empresa) {
      reset(empresa as any);
      if (empresa.logoUrl) setLogoPreview(empresa.logoUrl);
    }
  }, [empresa, reset]);

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: (values: FormValues) => configApi.updateEmpresa(values as UpdateEmpresaDto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empresa'] });
      toast('Configuración guardada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: subirLogo } = useMutation({
    mutationFn: (file: File) => configApi.uploadLogo(file),
    onSuccess: (r) => {
      setLogoPreview(r.logoUrl);
      queryClient.invalidateQueries({ queryKey: ['empresa'] });
      toast('Logo actualizado', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  if (isLoading) return <div className="space-y-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-10 rounded-lg animate-pulse" />)}</div>;

  return (
    <form onSubmit={handleSubmit((v) => guardar(v))} className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

      {/* Categoría 1: Datos de la empresa */}
      <CategoryCard label="Datos de la empresa">
        {/* Logo */}
        <div className="flex items-center gap-5 pb-4 border-b border-border">
          <div className={cn(
            'w-20 h-20 rounded-2xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden flex-shrink-0',
            logoPreview ? 'border-transparent' : 'hover:border-primary transition-colors',
          )}>
            {logoPreview
              ? <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
              : <Building2 className="w-8 h-8 text-muted-foreground" />}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Logo de la empresa</p>
            <p className="text-xs text-muted-foreground mb-2">PNG o SVG · máx 2MB · recomendado 512×512px</p>
            <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                              border border-input bg-background hover:bg-muted cursor-pointer transition-colors">
              <Upload className="w-3 h-3" /> Subir logo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) subirLogo(f); }}
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <Field label="Razón social *" error={errors.razonSocial?.message} span={2}>
            <input {...register('razonSocial')} placeholder="DATAFAST S.A.C." className={inp(!!errors.razonSocial)} />
          </Field>
          <Field label="RUC *" error={errors.ruc?.message}>
            <input {...register('ruc')} placeholder="20123456789" className={cn(inp(!!errors.ruc), 'font-mono')} maxLength={11} />
          </Field>
          <Field label="WhatsApp *" error={errors.whatsappCorporativo?.message}>
            <input {...register('whatsappCorporativo')} placeholder="+51 900 000 000" className={inp(!!errors.whatsappCorporativo)} />
            <p className="text-[11px] text-muted-foreground leading-snug mt-1">Número que recibirá alertas internas de egresos y ONUs</p>
          </Field>
          <Field label="Teléfono Informativo">
            <input {...register('telefonoInformativo')} placeholder="+51 073 123456" className={inp()} />
            <p className="text-[11px] text-muted-foreground leading-snug mt-1">Uso netamente informativo para contacto comercial de la empresa</p>
          </Field>
          <Field label="Email" error={errors.email?.message} span={2}>
            <input {...register('email')} type="email" placeholder="contacto@datafast.pe" className={inp(!!errors.email)} />
          </Field>
          <Field label="Dirección" span={2}>
            <input {...register('direccion')} placeholder="Av. Sánchez Cerro 1234, Piura" className={inp()} />
          </Field>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-border mt-2">
          <button type="button" onClick={() => reset()}
            className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
            Restablecer
          </button>
          <button
            type="submit"
            disabled={isPending || !isDirty}
            className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg
                       bg-primary text-primary-foreground font-medium
                       hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar cambios
          </button>
        </div>
      </CategoryCard>

      {/* Categoría 2: Dominio y certificado SSL */}
      <CategoryCard label="Dominio y certificado SSL">
        <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-4 mb-4">
          <div className="flex gap-2.5">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1.5">
              <p className="font-medium">¿Cómo funciona?</p>
              <p>Ingresa el dominio o subdominio que apunta a este servidor. El sistema obtiene el certificado HTTPS automáticamente.</p>
              <p>
                Sin dominio propio, usa{' '}
                <a href="https://www.duckdns.org" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 underline font-medium">
                  DuckDNS <ExternalLink className="w-3 h-3" />
                </a>
                {' '}o{' '}
                <a href="https://www.noip.com" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 underline font-medium">
                  No-IP <ExternalLink className="w-3 h-3" />
                </a>
                {' '}(gratuitos). Crea una cuenta, registra un subdominio y apúntalo a la IP de este servidor. Luego ingresa ese subdominio aquí.
              </p>
            </div>
          </div>
        </div>

        <Field label="Sitio web" error={errors.websiteUrl?.message}>
          <input {...register('websiteUrl')} placeholder="https://datafast.pe" className={inp(!!errors.websiteUrl)} />
        </Field>

        <Field label="Dominio o subdominio (sin https://)">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              {...register('dominio')}
              placeholder="erp.miisp.com  ó  miisp.duckdns.org"
              className={cn(inp(), 'pl-9')}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Guarda los cambios primero, luego activa el HTTPS con el botón de abajo.
          </p>
        </Field>

        <SslStatusCard />
      </CategoryCard>

    </form>
  );
}

// ─── SSL Status Card ──────────────────────────────────────────

interface SslStatusData {
  hasCert: boolean; expiresAt: string | null; domain: string | null;
  cloudflare: boolean; serverIp: string; domainIp: string | null; dnsOk: boolean;
}
interface SslResult { success: boolean; message: string; hint?: string; cloudflare?: boolean; }

function SslStatusCard() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<SslStatusData>({
    queryKey: ['ssl-status'],
    queryFn: async () => {
      const res = await api.get<ApiRespuesta<SslStatusData>>('/config/ssl-status');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const { mutate: provisionar, isPending } = useMutation<SslResult>({
    mutationFn: async () => {
      const res = await api.post<ApiRespuesta<SslResult>>('/config/provisionar-ssl');
      return res.data.data;
    },
    onSuccess: (result) => {
      if (result.success) {
        toast('Certificado HTTPS activado correctamente', { type: 'success' });
        qc.invalidateQueries({ queryKey: ['ssl-status'] });
      } else {
        toast(result.message, { type: 'error' });
      }
    },
    onError: () => toast('Error al obtener el certificado SSL', { type: 'error' }),
  });

  if (!data && isLoading) {
    return <div className="h-16 rounded-xl bg-muted animate-pulse mt-3" />;
  }
  if (!data?.domain) return null;

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Estado del certificado HTTPS</p>
        <button type="button" onClick={() => refetch()}
          className="p-1 rounded hover:bg-muted transition-colors">
          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* DNS status */}
      {data.domainIp && !data.dnsOk && !data.cloudflare && (
        <div className="flex gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
          <ShieldX className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">El dominio no apunta a este servidor</p>
            <p>El dominio resuelve a <code className="font-mono">{data.domainIp}</code> pero este servidor está en <code className="font-mono">{data.serverIp}</code>. Actualiza el registro DNS.</p>
          </div>
        </div>
      )}

      {/* Cloudflare proxy detected */}
      {data.cloudflare && !data.hasCert && (
        <div className="flex gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">Tu dominio usa Cloudflare Proxy</p>
            <p>Para obtener el certificado HTTPS, necesitas desactivar temporalmente el proxy:</p>
            <ol className="list-decimal list-inside space-y-0.5 ml-1">
              <li>Ve a <strong>Cloudflare → DNS → Records</strong></li>
              <li>Haz clic en el ícono naranja del registro de tu dominio → cambia a <strong>DNS only</strong> (nube gris)</li>
              <li>Regresa aquí y haz clic en <strong>Activar HTTPS</strong></li>
              <li>Una vez obtenido el certificado, vuelve a activar el proxy en Cloudflare (nube naranja)</li>
            </ol>
          </div>
        </div>
      )}

      {/* Cert status */}
      {data.hasCert ? (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 border border-green-200 dark:bg-green-950/30 dark:border-green-800">
          <ShieldCheck className="w-4 h-4 text-green-600 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-green-700 dark:text-green-400">HTTPS activo</p>
            {data.expiresAt && (
              <p className="text-green-600 dark:text-green-500">
                Vence el {new Date(data.expiresAt).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })} · Se renueva automáticamente
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
          <ShieldAlert className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">Sin certificado HTTPS todavía</p>
        </div>
      )}

      {!data.hasCert && (
        <button
          type="button"
          onClick={() => provisionar()}
          disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          {isPending ? 'Obteniendo certificado SSL…' : 'Obtener certificado SSL'}
        </button>
      )}
    </div>
  );
}

function CategoryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-6 py-3 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, error, children, span }: {
  label: string; error?: string; children: React.ReactNode; span?: number;
}) {
  return (
    <div className={cn('space-y-1.5', span === 2 && 'col-span-2')}>
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function inp(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
