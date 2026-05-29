'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Plug, ChevronRight, MessageSquare, Save, Loader2,
  Eye, EyeOff, Zap,
} from 'lucide-react';
import { sistemaApi, type ProveedorActivo } from '@/lib/api/sistema';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Constantes ────────────────────────────────────────────────
const SENTINEL = '***stored***';

const INPUT = [
  'w-full px-3 py-2 text-sm rounded-lg border border-input',
  'bg-background text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring transition-colors',
].join(' ');

const CODIGOS_PAIS = [
  { label: 'Perú (+51)',      value: '+51'  },
  { label: 'Colombia (+57)',  value: '+57'  },
  { label: 'México (+52)',    value: '+52'  },
  { label: 'Argentina (+54)', value: '+54'  },
  { label: 'Chile (+56)',     value: '+56'  },
  { label: 'Ecuador (+593)',  value: '+593' },
  { label: 'Bolivia (+591)',  value: '+591' },
  { label: 'Venezuela (+58)', value: '+58'  },
  { label: 'Uruguay (+598)',  value: '+598' },
  { label: 'Paraguay (+595)', value: '+595' },
];

// ─── Tarjetas de integración ───────────────────────────────────
const INTEGRATIONS = [
  {
    id:       'google',
    name:     'Google Workspace',
    description: 'Calendar, Contacts, Drive y Maps',
    href:     '/configuracion/integraciones/google',
    badge:    'Disponible',
    badgeCls: 'bg-emerald-500/10 text-emerald-500',
    logo:     'G',
    logoCls:  'bg-blue-500/10 text-blue-600',
  },
  {
    id:       'mensajeria',
    name:     'Pasarela de Mensajería',
    description: 'WhatsApp, AUTOMATIZADO.VIP, Twilio, Vonage y API personalizada',
    href:     '#gateway-config',
    badge:    'Configurar',
    badgeCls: 'bg-violet-500/10 text-violet-500',
    logo:     'M',
    logoCls:  'bg-violet-500/10 text-violet-500',
  },
  {
    id:       'mikrotik',
    name:     'MikroTik RouterOS',
    description: 'Gestión de routers y PPPoE',
    href:     '/red/routers',
    badge:    'Configurar',
    badgeCls: 'bg-blue-500/10 text-blue-500',
    logo:     'M',
    logoCls:  'bg-blue-500/10 text-blue-500',
  },
  {
    id:       'smartolt',
    name:     'SmartOLT',
    description: 'Gestión de OLTs y ONUs FTTH',
    href:     '/configuracion/servidor',
    badge:    'Configurar',
    badgeCls: 'bg-purple-500/10 text-purple-500',
    logo:     'S',
    logoCls:  'bg-purple-500/10 text-purple-500',
  },
  {
    id:       'mercadopago',
    name:     'MercadoPago',
    description: 'Pasarela de pagos en línea',
    href:     '/configuracion/pasarela-pagos',
    badge:    'Configurar',
    badgeCls: 'bg-sky-500/10 text-sky-500',
    logo:     'MP',
    logoCls:  'bg-sky-500/10 text-sky-500',
  },
];

// ─── Metadatos por proveedor ───────────────────────────────────
type ProviderMeta = {
  display:     string;
  color:       string;
  f1Label:     string; f1Ph: string; f1Hint: string;
  f2Label:     string; f2Ph: string; f2Hint: string;
  f3Label:     string; f3Ph: string; f3Hint: string;
  hideSecret?: boolean;
};

const PROVIDER_META: Record<ProveedorActivo, ProviderMeta> = {
  META_GRAPH: {
    display: 'Meta Graph API — WhatsApp Business',
    color:   'emerald',
    f1Label: 'Phone ID',            f1Ph: '123456789012345',   f1Hint: 'ID del número en Meta Business',
    f2Label: 'Business Account ID', f2Ph: '987654321098765',   f2Hint: 'ID de la cuenta WhatsApp Business (opcional)',
    f3Label: 'Access Token',        f3Ph: 'EAABwzLixnjY...',  f3Hint: 'Token permanente — se cifra con AES-256 antes de guardarse',
  },
  AUTOMATIZADO_VIP: {
    display:    'AUTOMATIZADO.VIP',
    color:      'violet',
    hideSecret: true,
    f1Label:    'API Key (AutomatizadoVIP)', f1Ph: 'ak_live_...',  f1Hint: 'Token de autenticación para api.automatizado.vip — cifrado AES-256',
    f2Label:    '',                          f2Ph: '',              f2Hint: '',
    f3Label:    'Instance ID',              f3Ph: 'inst_abc123',   f3Hint: 'ID de instancia asignado en automatizado.vip',
  },
  TWILIO: {
    display: 'Twilio',
    color:   'red',
    f1Label: 'Account SID (API Key)',   f1Ph: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', f1Hint: 'Account SID de tu consola Twilio — cifrado AES-256',
    f2Label: 'Auth Token (API Secret)', f2Ph: SENTINEL,                            f2Hint: 'Auth Token de Twilio — cifrado AES-256',
    f3Label: 'From Number (Client ID)', f3Ph: '+14155238886',                      f3Hint: 'Número de origen habilitado en Twilio',
  },
  VONAGE: {
    display: 'Vonage (Nexmo)',
    color:   'violet',
    f1Label: 'API Key',                 f1Ph: 'a1b2c3d4',  f1Hint: 'API Key de tu cuenta Vonage — cifrado AES-256',
    f2Label: 'API Secret',              f2Ph: SENTINEL,     f2Hint: 'API Secret de Vonage — cifrado AES-256',
    f3Label: 'Sender Name (Client ID)', f3Ph: 'DataFast',   f3Hint: 'Nombre alfanumérico o número de remitente',
  },
  CUSTOM_API: {
    display: 'API Personalizada',
    color:   'amber',
    f1Label: 'X-API-Key Header',         f1Ph: 'sk_live_...',                    f1Hint: 'Llave principal enviada como X-API-Key — cifrado AES-256',
    f2Label: 'X-API-Secret Header',      f2Ph: SENTINEL,                         f2Hint: 'Secreto enviado como X-API-Secret — cifrado AES-256',
    f3Label: 'Endpoint URL (Client ID)', f3Ph: 'https://api.proveedor.com/send', f3Hint: 'URL del endpoint POST que recibe el payload de mensajería',
  },
};

interface FormValues {
  proveedor:        ProveedorActivo;
  phoneId:          string;
  businessId:       string;
  token:            string;
  apiKey:           string;
  apiSecret:        string;
  clientId:         string;
  pausa:            number;
  limiteCaracteres: number;
  codigoPais:       string;
  activo:           boolean;
}

// ─── Formulario de configuración de gateway ────────────────────
function GatewayConfigForm() {
  const qc        = useQueryClient();
  const { toast } = useToast();
  const [showF1,   setShowF1]   = useState(false);
  const [showF2,   setShowF2]   = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: gwData, isLoading: gwLoading } = useQuery({
    queryKey: ['gw-config'],
    queryFn:  sistemaApi.getGatewayConfig,
    staleTime: 60_000,
  });

  const { data: waData, isLoading: waLoading } = useQuery({
    queryKey: ['wa-config'],
    queryFn:  sistemaApi.getWhatsAppConfig,
    staleTime: 60_000,
  });

  const isLoading = gwLoading || waLoading;

  const { register, watch, reset, setValue, handleSubmit } = useForm<FormValues>({
    defaultValues: {
      proveedor: 'META_GRAPH',
      phoneId: '', businessId: '', token: '',
      apiKey: '', apiSecret: '', clientId: '',
      pausa: 2, limiteCaracteres: 1000, codigoPais: '+51', activo: true,
    },
  });

  useEffect(() => {
    if (gwData) {
      reset({
        proveedor:        gwData.proveedorActivo,
        apiKey:           gwData.apiKey    ?? '',
        apiSecret:        gwData.apiSecret ?? '',
        clientId:         gwData.clientId  ?? '',
        pausa:            gwData.pausa            ?? 2,
        limiteCaracteres: gwData.limiteCaracteres  ?? 1000,
        codigoPais:       gwData.codigoPais        ?? '+51',
        activo:           gwData.activo            ?? true,
        phoneId:          waData?.phoneId    ?? '',
        businessId:       waData?.businessId ?? '',
        token:            waData?.token      ?? '',
      });
    }
  }, [gwData, waData, reset]);

  const proveedor = watch('proveedor');
  const activo    = watch('activo');
  const meta      = PROVIDER_META[proveedor];
  const isMeta    = proveedor === 'META_GRAPH';

  const isConfigured = isMeta
    ? waData?.token  === SENTINEL
    : gwData?.apiKey === SENTINEL;

  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    red:     'bg-red-500/10 text-red-400 border-red-500/20',
    violet:  'bg-violet-500/10 text-violet-400 border-violet-500/20',
    amber:   'bg-amber-500/10 text-amber-500 border-amber-500/20',
  };
  const iconColor: Record<string, string> = {
    emerald: 'text-emerald-500',
    red:     'text-red-400',
    violet:  'text-violet-400',
    amber:   'text-amber-500',
  };
  const pulseColor: Record<string, string> = {
    emerald: 'bg-emerald-500',
    red:     'bg-red-400',
    violet:  'bg-violet-400',
    amber:   'bg-amber-500',
  };

  const cardColor = colorMap[meta.color]  ?? colorMap.emerald;
  const iconCls   = iconColor[meta.color] ?? iconColor.emerald;
  const iconBgCls = `bg-${meta.color}-500/10`;

  const onSave = handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      const trafico = {
        pausa:            Number(values.pausa)            || 2,
        limiteCaracteres: Number(values.limiteCaracteres) || 1000,
        codigoPais:       values.codigoPais || '+51',
        activo:           values.activo,
      };

      if (values.proveedor === 'META_GRAPH') {
        await sistemaApi.updateGatewayConfig({ proveedorActivo: 'META_GRAPH', ...trafico });
        await sistemaApi.updateWhatsAppConfig({
          phoneId:    values.phoneId    || undefined,
          businessId: values.businessId || undefined,
          token:      values.token !== SENTINEL ? values.token : SENTINEL,
        });
      } else {
        await sistemaApi.updateGatewayConfig({
          proveedorActivo: values.proveedor,
          apiKey:    values.apiKey    !== SENTINEL ? values.apiKey    : SENTINEL,
          apiSecret: (!meta.hideSecret && values.apiSecret !== SENTINEL) ? values.apiSecret : SENTINEL,
          clientId:  values.clientId || undefined,
          ...trafico,
        });
      }
      qc.invalidateQueries({ queryKey: ['gw-config'] });
      qc.invalidateQueries({ queryKey: ['wa-config'] });
      toast('Configuración de mensajería guardada', { type: 'success' });
    } catch (e) {
      toast(parseApiError(e), { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  });

  return (
    <div id="gateway-config" className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', iconBgCls)}>
          {isMeta
            ? <MessageSquare className={cn('w-4 h-4', iconCls)} />
            : <Zap           className={cn('w-4 h-4', iconCls)} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground">{meta.display}</h2>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <Zap className="w-2.5 h-2.5" />
              automatizado.vip
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Credenciales para el envío de notificaciones automáticas
          </p>
        </div>
        {isConfigured && (
          <span className={cn('ml-auto flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border', cardColor)}>
            <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', pulseColor[meta.color] ?? 'bg-emerald-500')} />
            Configurado
          </span>
        )}
      </div>

      <div className="px-6 py-5 space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={onSave} className="space-y-5">
            {/* Selector de proveedor */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Proveedor de mensajería</label>
              <select {...register('proveedor')} className={cn(INPUT, 'cursor-pointer')}>
                <option value="META_GRAPH">Meta Graph API (WhatsApp Business)</option>
                <option value="AUTOMATIZADO_VIP">AUTOMATIZADO.VIP</option>
                <option value="TWILIO">Twilio</option>
                <option value="VONAGE">Vonage (Nexmo)</option>
                <option value="CUSTOM_API">API Personalizada</option>
              </select>
              <p className="text-[10px] text-muted-foreground">
                Las notificaciones automáticas usarán este proveedor para todos los envíos.
              </p>
            </div>

            {/* ─── Campos META_GRAPH ────────────────────────── */}
            {isMeta && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      {meta.f1Label} <span className="text-rose-500">*</span>
                    </label>
                    <input type="text" placeholder={meta.f1Ph} {...register('phoneId')} className={INPUT} />
                    <p className="text-[10px] text-muted-foreground">{meta.f1Hint}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      {meta.f2Label}{' '}
                      <span className="text-muted-foreground font-normal">(opcional)</span>
                    </label>
                    <input type="text" placeholder={meta.f2Ph} {...register('businessId')} className={INPUT} />
                    <p className="text-[10px] text-muted-foreground">{meta.f2Hint}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{meta.f3Label}</label>
                  <div className="relative">
                    <input
                      type={showF1 ? 'text' : 'password'}
                      placeholder={meta.f3Ph}
                      {...register('token')}
                      className={cn(INPUT, 'pr-10 font-mono text-xs')}
                    />
                    <button type="button" onClick={() => setShowF1(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showF1 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{meta.f3Hint}</p>
                </div>
              </>
            )}

            {/* ─── Campos no-META_GRAPH ─────────────────────── */}
            {!isMeta && (
              <>
                <div className={cn('grid grid-cols-1 gap-4', !meta.hideSecret && 'sm:grid-cols-2')}>
                  {/* f1: apiKey */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      {meta.f1Label} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showF1 ? 'text' : 'password'}
                        placeholder={meta.f1Ph}
                        {...register('apiKey')}
                        className={cn(INPUT, 'pr-10 font-mono text-xs')}
                      />
                      <button type="button" onClick={() => setShowF1(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showF1 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{meta.f1Hint}</p>
                  </div>

                  {/* f2: apiSecret — oculto para AUTOMATIZADO_VIP */}
                  {!meta.hideSecret && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">
                        {meta.f2Label} <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showF2 ? 'text' : 'password'}
                          placeholder={meta.f2Ph}
                          {...register('apiSecret')}
                          className={cn(INPUT, 'pr-10 font-mono text-xs')}
                        />
                        <button type="button" onClick={() => setShowF2(v => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                          {showF2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{meta.f2Hint}</p>
                    </div>
                  )}
                </div>

                {/* f3: clientId / Instance ID (plaintext) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{meta.f3Label}</label>
                  <input type="text" placeholder={meta.f3Ph} {...register('clientId')} className={INPUT} />
                  <p className="text-[10px] text-muted-foreground">{meta.f3Hint}</p>
                </div>
              </>
            )}

            {/* ─── Control de tráfico ──────────────────────── */}
            <div className="border border-border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Control de tráfico
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {activo ? 'Gateway activo' : 'Gateway inactivo'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setValue('activo', !activo, { shouldDirty: true })}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full',
                      'transition-colors duration-200 focus:outline-none',
                      activo ? 'bg-emerald-500' : 'bg-muted',
                    )}
                    aria-label="Activar Gateway"
                  >
                    <span className={cn(
                      'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200',
                      activo ? 'translate-x-4' : 'translate-x-0.5',
                    )} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Pausa entre mensajes (seg)</label>
                  <input
                    type="number" min={0} max={60}
                    {...register('pausa', { valueAsNumber: true })}
                    className={INPUT}
                  />
                  <p className="text-[10px] text-muted-foreground">0–60 segundos entre envíos</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Límite de caracteres</label>
                  <input
                    type="number" min={50} max={5000}
                    {...register('limiteCaracteres', { valueAsNumber: true })}
                    className={INPUT}
                  />
                  <p className="text-[10px] text-muted-foreground">Mensajes más largos se rechazan</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Código de país</label>
                  <select {...register('codigoPais')} className={cn(INPUT, 'cursor-pointer')}>
                    {CODIGOS_PAIS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground">Se antepone a números sin código</p>
                </div>
              </div>
            </div>

            {/* Nota sentinel */}
            {isConfigured && (
              <p className="text-[10px] text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
                Las llaves cifradas muestran <code className="font-mono">{SENTINEL}</code>.
                Déjalas así para conservarlas, o escribe valores nuevos para reemplazarlas.
              </p>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
                )}
              >
                {isSaving
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
                  : <><Save    className="w-3.5 h-3.5" /> Guardar configuración</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────
export default function IntegracionesPage() {
  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Plug className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integraciones</h1>
          <p className="text-xs text-muted-foreground">Conecta servicios externos con tu CRM</p>
        </div>
      </div>

      {/* Tarjetas de integración */}
      <div className="grid gap-3">
        {INTEGRATIONS.map((integ) => (
          <Link
            key={integ.id}
            href={integ.href}
            className="group flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-accent/30 transition-colors"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${integ.logoCls}`}>
              {integ.logo}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{integ.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${integ.badgeCls}`}>
                  {integ.badge}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{integ.description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </Link>
        ))}
      </div>

      {/* Configuración de pasarela de mensajería */}
      <GatewayConfigForm />
    </div>
  );
}
