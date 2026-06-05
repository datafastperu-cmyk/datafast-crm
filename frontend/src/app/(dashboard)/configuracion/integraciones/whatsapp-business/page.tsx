'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  MessageSquare, Save, Loader2, Eye, EyeOff, Zap, ChevronLeft,
  ChevronDown, RotateCcw, Shield, Lock,
} from 'lucide-react';
import { sistemaApi, type ProveedorActivo } from '@/lib/api/sistema';
import { useToast }       from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Constantes ─────────────────────────────────────────────────────────────
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

// Códigos sin '+' para DATAFAST_MENSAJERIA_MASIVA (motor HTTP nativo)
const CODIGOS_PAIS_MASIVA = [
  { label: 'Perú (+51)',      value: '51'  },
  { label: 'Colombia (+57)',  value: '57'  },
  { label: 'México (+52)',    value: '52'  },
  { label: 'Argentina (+54)', value: '54'  },
  { label: 'Chile (+56)',     value: '56'  },
  { label: 'Ecuador (+593)',  value: '593' },
  { label: 'Bolivia (+591)',  value: '591' },
  { label: 'Venezuela (+58)', value: '58'  },
  { label: 'Uruguay (+598)',  value: '598' },
  { label: 'Paraguay (+595)', value: '595' },
];

type ProviderMeta = {
  display: string; color: string;
  f1Label: string; f1Ph: string; f1Hint: string;
  f2Label: string; f2Ph: string; f2Hint: string;
  f3Label: string; f3Ph: string; f3Hint: string;
  hideSecret?: boolean;
  noCredentials?: boolean;
};

const PROVIDER_META: Record<ProveedorActivo, ProviderMeta> = {
  META_GRAPH: {
    display: 'Meta Graph API', color: 'emerald',
    f1Label: 'Phone ID',             f1Ph: '123456789012345',   f1Hint: 'ID del número en Meta Business',
    f2Label: 'Business Account ID',  f2Ph: '987654321098765',   f2Hint: 'ID de la cuenta (opcional)',
    f3Label: 'Access Token',         f3Ph: 'EAABwzLixnjY...',   f3Hint: 'Token permanente — cifrado AES-256',
  },
  AUTOMATIZADO_VIP: {
    display: 'AUTOMATIZADO.VIP', color: 'violet', hideSecret: true,
    f1Label: 'API Key / Token',  f1Ph: 'ak_live_...',   f1Hint: 'Token de autenticación',
    f2Label: '', f2Ph: '', f2Hint: '',
    f3Label: 'Instance ID',      f3Ph: 'inst_abc123',   f3Hint: 'ID de instancia en automatizado.vip',
  },
  TWILIO: {
    display: 'Twilio', color: 'red',
    f1Label: 'Account SID',   f1Ph: 'ACxxxxxxxxx',    f1Hint: 'Account SID — cifrado AES-256',
    f2Label: 'Auth Token',    f2Ph: SENTINEL,          f2Hint: 'Auth Token — cifrado AES-256',
    f3Label: 'From Number',   f3Ph: '+14155238886',    f3Hint: 'Número de origen',
  },
  VONAGE: {
    display: 'Vonage (Nexmo)', color: 'violet',
    f1Label: 'API Key',        f1Ph: 'a1b2c3d4',       f1Hint: 'API Key — cifrado AES-256',
    f2Label: 'API Secret',     f2Ph: SENTINEL,          f2Hint: 'API Secret — cifrado AES-256',
    f3Label: 'Sender Name',    f3Ph: 'DataFast',        f3Hint: 'Nombre alfanumérico remitente',
  },
  CUSTOM_API: {
    display: 'API Personalizada', color: 'amber',
    f1Label: 'X-API-Key',          f1Ph: 'sk_live_...',                    f1Hint: 'Llave principal — cifrado AES-256',
    f2Label: 'X-API-Secret',       f2Ph: SENTINEL,                          f2Hint: 'Secreto — cifrado AES-256',
    f3Label: 'Endpoint URL',       f3Ph: 'https://api.proveedor.com/send',  f3Hint: 'URL del endpoint POST',
  },
  DATAFAST_MENSAJERIA_MASIVA: {
    display: 'DATAFAST Mensajería Masiva', color: 'teal', noCredentials: true,
    f1Label: '', f1Ph: '', f1Hint: '',
    f2Label: '', f2Ph: '', f2Hint: '',
    f3Label: '', f3Ph: '', f3Hint: '',
  },
};

const COLOR_BADGE: Record<string, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  red:     'bg-red-500/10 text-red-400 border-red-500/20',
  violet:  'bg-violet-500/10 text-violet-400 border-violet-500/20',
  amber:   'bg-amber-500/10 text-amber-500 border-amber-500/20',
  green:   'bg-green-500/10 text-green-400 border-green-500/20',
  teal:    'bg-teal-500/10 text-teal-400 border-teal-500/20',
};
const COLOR_ICON: Record<string, string> = {
  emerald: 'text-emerald-500', red: 'text-red-400',
  violet:  'text-violet-400',  amber: 'text-amber-500',
  green:   'text-green-400',   teal: 'text-teal-400',
};
const COLOR_PULSE: Record<string, string> = {
  emerald: 'bg-emerald-500', red: 'bg-red-400',
  violet:  'bg-violet-400',  amber: 'bg-amber-500',
  green:   'bg-green-400',   teal: 'bg-teal-400',
};

interface FormValues {
  proveedor:             ProveedorActivo;
  phoneId:               string;
  businessId:            string;
  token:                 string;
  apiKey:                string;
  apiSecret:             string;
  clientId:              string;
  pausa:                 number;
  limiteCaracteres:      number;
  codigoPais:            string;
  activo:                boolean;
  metaGraphActivo:       boolean;
  twilioActivo:          boolean;
  vonageActivo:          boolean;
  customApiActivo:       boolean;
  automatizadoVipActivo: boolean;
  limiteDiarioMasivo:    number;
  whatsappNumeroOrigen: string;
}

// ─── Toggle helper ────────────────────────────────────────────────────────────
function Toggle({
  on, onToggle, disabled = false,
}: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        on ? 'bg-emerald-500' : 'bg-muted border border-border',
      )}
    >
      <span className={cn(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200',
        on ? 'translate-x-4' : 'translate-x-0.5',
      )} />
    </button>
  );
}

// ─── Formulario principal ─────────────────────────────────────────────────────
function GatewayConfigForm() {
  const qc        = useQueryClient();
  const { toast } = useToast();
  const [showF1,       setShowF1]       = useState(false);
  const [showF2,       setShowF2]       = useState(false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

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
      proveedor:             'META_GRAPH',
      phoneId: '', businessId: '', token: '',
      apiKey: '', apiSecret: '', clientId: '',
      pausa: 2, limiteCaracteres: 1000, codigoPais: '+51',
      activo: false,
      metaGraphActivo: true, twilioActivo: false, vonageActivo: false,
      customApiActivo: false, automatizadoVipActivo: false,
      limiteDiarioMasivo: 500,
      whatsappNumeroOrigen: '',
    },
  });

  useEffect(() => {
    if (gwData) {
      const isMasivaP = gwData.proveedorActivo === 'DATAFAST_MENSAJERIA_MASIVA';
      reset({
        proveedor:             gwData.proveedorActivo,
        apiKey:                '',
        apiSecret:             '',
        clientId:              gwData.clientId  ?? '',
        pausa:                 gwData.pausa             ?? (isMasivaP ? 12 : 2),
        limiteCaracteres:      gwData.limiteCaracteres   ?? 1000,
        codigoPais:            isMasivaP
          ? (gwData.codigoPais ?? '51').replace(/^\+/, '')
          : (gwData.codigoPais ?? '+51'),
        activo:                gwData.activo             ?? false,
        metaGraphActivo:       gwData.metaGraphActivo       ?? true,
        twilioActivo:          gwData.twilioActivo          ?? false,
        vonageActivo:          gwData.vonageActivo          ?? false,
        customApiActivo:       gwData.customApiActivo       ?? false,
        automatizadoVipActivo: gwData.automatizadoVipActivo ?? false,
        limiteDiarioMasivo:    gwData.limiteDiarioMasivo ?? 500,
        phoneId:               waData?.phoneId    ?? '',
        businessId:            waData?.businessId ?? '',
        token:                 '',
        whatsappNumeroOrigen: gwData.whatsappNumeroOrigen ?? '',
      });
    }
  }, [gwData, waData, reset]); // eslint-disable-line

  const proveedor              = watch('proveedor');
  const activo                 = watch('activo');
  const metaGraphActivo        = watch('metaGraphActivo');
  const twilioActivo           = watch('twilioActivo');
  const vonageActivo           = watch('vonageActivo');
  const customApiActivo        = watch('customApiActivo');
  const automatizadoVipActivo  = watch('automatizadoVipActivo');
  const whatsappNumeroOrigen   = watch('whatsappNumeroOrigen');
  const meta                   = PROVIDER_META[proveedor];
  const isMeta                 = proveedor === 'META_GRAPH';
  const isMasiva               = proveedor === 'DATAFAST_MENSAJERIA_MASIVA';

  // Mapa proveedor → campo del formulario para el toggle de activación
  const ACTIVO_FIELD: Record<ProveedorActivo, keyof FormValues> = {
    META_GRAPH:                 'metaGraphActivo',
    TWILIO:                     'twilioActivo',
    VONAGE:                     'vonageActivo',
    CUSTOM_API:                 'customApiActivo',
    AUTOMATIZADO_VIP:           'automatizadoVipActivo',
    DATAFAST_MENSAJERIA_MASIVA: 'activo',
  };
  const activoField   = ACTIVO_FIELD[proveedor];
  const ACTIVO_WATCH: Record<ProveedorActivo, boolean> = {
    META_GRAPH:                 metaGraphActivo,
    TWILIO:                     twilioActivo,
    VONAGE:                     vonageActivo,
    CUSTOM_API:                 customApiActivo,
    AUTOMATIZADO_VIP:           automatizadoVipActivo,
    DATAFAST_MENSAJERIA_MASIVA: activo,
  };
  const currentActivo = ACTIVO_WATCH[proveedor];

  // Switch de MASIVA sólo se puede encender si hay número de WhatsApp configurado
  const masivaCanActivate = !!whatsappNumeroOrigen?.trim();

  const isConfigured = isMeta
    ? !!(waData?.token)
    : isMasiva
    ? gwData?.activo
    : gwData?.apiKeyStored;

  const cardColor = COLOR_BADGE[meta.color] ?? COLOR_BADGE.emerald;
  const iconCls   = COLOR_ICON[meta.color]  ?? COLOR_ICON.emerald;
  const iconBgCls = `bg-${meta.color}-500/10`;

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      await sistemaApi.restart();
      toast('Servicios reiniciados. El backend estará disponible en ~10 segundos.', { type: 'success' });
    } catch (e) {
      toast(parseApiError(e) || 'Error al reiniciar servicios', { type: 'error' });
    } finally {
      setTimeout(() => setIsRestarting(false), 12_000);
    }
  };

  const onSave = handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      const activoValue = values[ACTIVO_FIELD[values.proveedor]] as boolean;

      if (values.proveedor === 'META_GRAPH') {
        await sistemaApi.updateGatewayConfig({
          proveedorActivo: 'META_GRAPH',
          activo:          activoValue,
        });
        await sistemaApi.updateWhatsAppConfig({
          phoneId:    values.phoneId    || undefined,
          businessId: values.businessId || undefined,
          token:      values.token ? values.token : undefined,
        });
      } else if (values.proveedor === 'DATAFAST_MENSAJERIA_MASIVA') {
        await sistemaApi.updateGatewayConfig({
          proveedorActivo:      'DATAFAST_MENSAJERIA_MASIVA',
          activo:               activoValue,
          pausa:                Number(values.pausa)            || 12,
          limiteCaracteres:     Number(values.limiteCaracteres) || 1000,
          codigoPais:           values.codigoPais || '51',
          limiteDiarioMasivo:   Number(values.limiteDiarioMasivo) || 500,
          whatsappNumeroOrigen: values.whatsappNumeroOrigen || undefined,
        });
      } else {
        await sistemaApi.updateGatewayConfig({
          proveedorActivo: values.proveedor,
          activo:          activoValue,
          apiKey:    values.apiKey    && values.apiKey    !== SENTINEL ? values.apiKey    : undefined,
          apiSecret: !meta.hideSecret && values.apiSecret && values.apiSecret !== SENTINEL ? values.apiSecret : undefined,
          clientId:  values.clientId || undefined,
        });
      }

      qc.invalidateQueries({ queryKey: ['gw-config'] });
      qc.invalidateQueries({ queryKey: ['wa-config'] });
      toast('Configuración guardada correctamente', { type: 'success' });
    } catch (e) {
      toast(parseApiError(e), { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', iconBgCls)}>
          {isMasiva
            ? <Shield        className={cn('w-4 h-4', iconCls)} />
            : isMeta
            ? <MessageSquare className={cn('w-4 h-4', iconCls)} />
            : <Zap           className={cn('w-4 h-4', iconCls)} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground">WhatsApp Business</h2>
            <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border', COLOR_BADGE[meta.color] ?? COLOR_BADGE.emerald)}>
              <Zap className="w-2.5 h-2.5" />{meta.display}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Credenciales para el envío de notificaciones automáticas
          </p>
        </div>
        {isConfigured && (
          <span className={cn('ml-auto flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border', cardColor)}>
            <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', COLOR_PULSE[meta.color] ?? 'bg-emerald-500')} />
            {isMasiva ? 'Servicio activo' : 'Configurado'}
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
                <option value="DATAFAST_MENSAJERIA_MASIVA">DATAFAST Mensajería Masiva (HTTP nativo)</option>
              </select>
              <p className="text-[10px] text-muted-foreground">
                Las notificaciones automáticas usarán este proveedor para todos los envíos.
              </p>
            </div>

            {/* ── META_GRAPH: credenciales ──────────────────────────────── */}
            {isMeta && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">{meta.f1Label} <span className="text-rose-500">*</span></label>
                    <input type="text" placeholder={meta.f1Ph} {...register('phoneId')} className={INPUT} />
                    <p className="text-[10px] text-muted-foreground">{meta.f1Hint}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">{meta.f2Label} <span className="text-muted-foreground font-normal">(opcional)</span></label>
                    <input type="text" placeholder={meta.f2Ph} {...register('businessId')} className={INPUT} />
                    <p className="text-[10px] text-muted-foreground">{meta.f2Hint}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{meta.f3Label}</label>
                  <div className="relative">
                    <input type={showF1 ? 'text' : 'password'} placeholder={meta.f3Ph} {...register('token')} className={cn(INPUT, 'pr-10 font-mono text-xs')} />
                    <button type="button" onClick={() => setShowF1(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showF1 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{meta.f3Hint}</p>
                </div>
              </>
            )}

            {/* ── Otros proveedores (Twilio, Vonage, etc.) ─────────────── */}
            {!isMeta && !isMasiva && (
              <>
                <div className={cn('grid grid-cols-1 gap-4', !meta.hideSecret && 'sm:grid-cols-2')}>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">{meta.f1Label} <span className="text-rose-500">*</span></label>
                    <div className="relative">
                      <input type={showF1 ? 'text' : 'password'} placeholder={meta.f1Ph} {...register('apiKey')} className={cn(INPUT, 'pr-10 font-mono text-xs')} />
                      <button type="button" onClick={() => setShowF1(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showF1 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{meta.f1Hint}</p>
                  </div>
                  {!meta.hideSecret && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">{meta.f2Label} <span className="text-rose-500">*</span></label>
                      <div className="relative">
                        <input type={showF2 ? 'text' : 'password'} placeholder={meta.f2Ph} {...register('apiSecret')} className={cn(INPUT, 'pr-10 font-mono text-xs')} />
                        <button type="button" onClick={() => setShowF2(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                          {showF2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{meta.f2Hint}</p>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{meta.f3Label}</label>
                  <input type="text" placeholder={meta.f3Ph} {...register('clientId')} className={INPUT} />
                  <p className="text-[10px] text-muted-foreground">{meta.f3Hint}</p>
                </div>
              </>
            )}

            {/* ── Switch gateway (no-masiva) ───────────────────────────── */}
            {!isMasiva && (
              <div className="flex items-center justify-between border border-border rounded-lg px-4 py-3">
                <span className="text-xs font-medium text-foreground">
                  {currentActivo ? 'Gateway activo' : 'Gateway inactivo'}
                </span>
                <Toggle
                  on={currentActivo}
                  onToggle={() => setValue(activoField, !currentActivo as any, { shouldDirty: true })}
                />
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════
                DATAFAST_MENSAJERIA_MASIVA — Card dedicada
            ══════════════════════════════════════════════════════════ */}
            {isMasiva && (
              <div className="rounded-xl border border-teal-500/30 overflow-hidden">

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-teal-500/20 bg-gradient-to-r from-[#0d2b45] to-[#0d3d35]">
                  <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      WHATSAPP MENSAJERÍA MASIVA DATAFAST
                    </h3>
                    <p className="text-[10px] text-white/50">Motor nativo — independiente del CRM interactivo</p>
                  </div>
                  <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30 text-[10px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                    Motor Nativo
                  </span>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 bg-card">

                  {/* Número origen */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      Número de WhatsApp del Aplicativo
                    </label>
                    <input
                      type="text"
                      placeholder="51999888777"
                      {...register('whatsappNumeroOrigen')}
                      className={INPUT}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Número emisor del motor nativo (campo <code className="font-mono">whatsapp_numero_origen</code>)
                    </p>
                  </div>

                  {/* Parámetros de envío */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Límite caracteres</label>
                      <input
                        type="number" min={50} max={5000}
                        {...register('limiteCaracteres', { valueAsNumber: true })}
                        className={INPUT}
                      />
                      <p className="text-[10px] text-muted-foreground">Mensajes más largos se rechazan</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Pausa Entre mensaje (Segundos)</label>
                      <input
                        type="number" min={0} max={60}
                        {...register('pausa', { valueAsNumber: true })}
                        className={INPUT}
                      />
                      <p className="text-[10px] text-muted-foreground">Delay anti-ban (BullMQ)</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Código país</label>
                      <div className="relative">
                        <select
                          {...register('codigoPais')}
                          className={cn(INPUT, 'cursor-pointer appearance-none')}
                        >
                          {CODIGOS_PAIS_MASIVA.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      </div>
                      <p className="text-[10px] text-muted-foreground">Se antepone a números sin prefijo</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Cuota diaria máxima</label>
                      <input
                        type="number" min={1} max={10000}
                        {...register('limiteDiarioMasivo', { valueAsNumber: true })}
                        className={INPUT}
                      />
                      <p className="text-[10px] text-muted-foreground">Mensajes masivos / día (anti-ban)</p>
                    </div>
                  </div>

                  {/* Switch: Activar Gateway */}
                  <div className="pt-3 border-t border-border">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                          Activar Gateway
                          {!masivaCanActivate && !activo && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-amber-500">
                              <Lock className="w-3 h-3" /> Requiere configuración
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {!masivaCanActivate && !activo
                            ? 'Configura el número de WhatsApp y guarda antes de activar el servicio'
                            : activo
                            ? 'Notificaciones activas — DATAFAST_MENSAJERIA_MASIVA operativo'
                            : 'Gateway desactivado — los envíos serán bloqueados'}
                        </p>
                      </div>
                      <Toggle
                        on={activo}
                        disabled={!masivaCanActivate && !activo}
                        onToggle={() => {
                          if (!activo && !masivaCanActivate) {
                            toast(
                              'Debe rellenar y guardar la configuración técnica antes de activar el servicio.',
                              { type: 'error' },
                            );
                            return;
                          }
                          setValue('activo', !activo, { shouldDirty: true });
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Footer: Reiniciar | Guardar */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/20">
                  <button
                    type="button"
                    onClick={handleRestart}
                    disabled={isRestarting || isSaving}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-colors bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                  >
                    {isRestarting
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reiniciando…</>
                      : <><RotateCcw className="w-3.5 h-3.5" /> Reiniciar servicios</>}
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving || isRestarting}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isSaving
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
                      : <><Save className="w-3.5 h-3.5" /> Guardar cambios</>}
                  </button>
                </div>
              </div>
            )}
            {/* ══════════════════════════════════════════════════════════ */}

            {/* Botón guardar genérico (no-masiva) */}
            {!isMasiva && (
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSaving
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
                    : <><Save    className="w-3.5 h-3.5" /> Guardar configuración</>}
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function WhatsAppBusinessPage() {
  return (
    <div className="p-6 max-w-3xl space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/configuracion/integraciones" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" />Integraciones
        </Link>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs text-foreground font-medium">WhatsApp Business</span>
      </div>

      <GatewayConfigForm />
    </div>
  );
}
