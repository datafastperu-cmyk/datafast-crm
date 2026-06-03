'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Users, Send, FileText, History, ChevronDown,
  MessageCircle, AlertTriangle, CheckCircle2,
  XCircle, Clock, Loader2, Ban,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import { mensajeriaApi }      from '@/lib/api/mensajeria';
import { plantillasApi }      from '@/lib/api/plantillas';
import { zonasApi }           from '@/lib/api/zonas';
import { mikrotikApi }        from '@/lib/api/mikrotik';

const SELECT_CLS = 'w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer disabled:opacity-50';
const LABEL_CLS  = 'block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5';

// ── Extrae {variables} del contenido de una plantilla ────────
function extraerVariables(contenido: string): string[] {
  const matches = contenido.matchAll(/\{(\w+)\}/g);
  return [...new Set([...matches].map(m => m[1]))];
}

// ── Panel: medidor de cuota ───────────────────────────────────
function CuotaMeter() {
  const { data, isLoading } = useQuery({
    queryKey: ['mensajeria', 'cuota'],
    queryFn:  mensajeriaApi.cuota,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-center h-[88px]">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pct   = data.limiteDiario > 0 ? Math.min((data.usado / data.limiteDiario) * 100, 100) : 0;
  const color = pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const text  = pct >= 100 ? 'text-destructive' : pct >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Cuota Diaria WhatsApp
        </span>
        <span className={cn('text-sm font-bold', text)}>
          {data.usado} / {data.limiteDiario}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[11px] text-muted-foreground">{pct.toFixed(1)}% usado</span>
        <span className="text-[11px] text-muted-foreground">{data.restante} restantes</span>
      </div>
    </div>
  );
}

// ── Panel: monitor de campaña ─────────────────────────────────
function MonitorPanel({ onPausar, pausando }: { onPausar: () => void; pausando: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['mensajeria', 'monitor'],
    queryFn:  mensajeriaApi.monitor,
    refetchInterval: 10_000,
  });

  const stats = [
    { label: 'Encolados',  value: data?.encolados  ?? 0, icon: Clock,         cls: 'text-muted-foreground' },
    { label: 'Enviados',   value: data?.enviados    ?? 0, icon: CheckCircle2,  cls: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Fallidos',   value: data?.fallidos    ?? 0, icon: XCircle,       cls: 'text-destructive' },
    { label: 'Entregados', value: data?.entregados  ?? 0, icon: MessageCircle, cls: 'text-primary' },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Monitor Campaña Activa — Hoy
        </span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {stats.map(({ label, value, icon: Icon, cls }) => (
          <div key={label} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <Icon className={cn('w-4 h-4 flex-shrink-0', cls)} />
            <div>
              <p className="text-base font-bold text-foreground leading-none">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onPausar}
        disabled={pausando}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground text-sm font-semibold transition-colors disabled:opacity-50"
      >
        {pausando
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Ban className="w-4 h-4" />}
        Pausar / Cancelar Campaña
      </button>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────
export default function CampanasPage() {
  const qc = useQueryClient();

  const [sectorId,   setSectorId]   = useState('');
  const [routerId,   setRouterId]   = useState('');
  const [templateId, setTemplateId] = useState('');
  const [variables,  setVariables]  = useState<Record<string, string>>({});

  // ── Remote data ──────────────────────────────────────────────
  const { data: zonas    = [] } = useQuery({ queryKey: ['zonas'],     queryFn: zonasApi.list });
  const { data: routers  = [] } = useQuery({ queryKey: ['routers'],   queryFn: mikrotikApi.listar });
  const { data: plantillas = [] } = useQuery({
    queryKey: ['plantillas', 'whatsapp'],
    queryFn:  () => plantillasApi.listar('whatsapp'),
  });

  const plantillaSeleccionada = useMemo(
    () => plantillas.find(p => p.id === templateId || p.codigo === templateId),
    [plantillas, templateId],
  );

  const varNames = useMemo(
    () => plantillaSeleccionada ? extraerVariables(plantillaSeleccionada.contenido) : [],
    [plantillaSeleccionada],
  );

  // Sync variable keys when template changes
  const handleTemplate = (id: string) => {
    setTemplateId(id);
    setVariables({});
  };

  // ── Mutations ────────────────────────────────────────────────
  const iniciarMut = useMutation({
    mutationFn: mensajeriaApi.iniciarCampana,
    onSuccess: (res) => {
      toast.success(`${res.encolados} mensajes encolados`, {
        description: `Cuota restante hoy: ${res.cuotaRestante}`,
      });
      qc.invalidateQueries({ queryKey: ['mensajeria'] });
    },
    onError: (err: Error) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        .response?.data?.message ?? err.message;
      toast.error('Error al iniciar campaña', { description: msg });
    },
  });

  const pausarMut = useMutation({
    mutationFn: mensajeriaApi.vaciarCola,
    onSuccess: (res) => {
      toast.success(`Campaña pausada — ${res.eliminados} jobs eliminados`);
      qc.invalidateQueries({ queryKey: ['mensajeria'] });
    },
  });

  const handleEnviar = () => {
    if (!templateId) { toast.warning('Selecciona una plantilla'); return; }
    iniciarMut.mutate({
      tipo:       'CAMPANA_MASIVA',
      templateId: templateId || undefined,
      sectorId:   sectorId   || undefined,
      routerId:   routerId   || undefined,
      variables:  Object.keys(variables).length > 0 ? variables : undefined,
    });
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-[#25D366]" />
            <h1 className="text-lg font-bold text-foreground">Marketing WhatsApp</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Campañas masivas nativas — sesión WhatsApp del CRM
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/mensajeria/plantillas" className="flex items-center gap-1.5 text-primary hover:underline font-medium">
            <FileText className="w-4 h-4" /> Plantillas
          </Link>
          <Link href="/mensajeria/historial" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground font-medium">
            <History className="w-4 h-4" /> Historial
          </Link>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* Fila 1: cuota + monitor */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CuotaMeter />
          <MonitorPanel
            onPausar={() => pausarMut.mutate()}
            pausando={pausarMut.isPending}
          />
        </div>

        {/* Fila 2: formulario de campaña */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border bg-[#1a3a8f] rounded-t-xl">
            <Send className="w-4 h-4 text-white" />
            <span className="font-bold text-white text-sm">Nueva Campaña</span>
          </div>

          <div className="p-5 space-y-5">

            {/* Segmentación */}
            <div>
              <p className={LABEL_CLS}>Segmentación de Destinatarios</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Sector / Zona */}
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    <Users className="w-3 h-3 inline mr-1" />Sector / Zona
                  </label>
                  <div className="relative">
                    <select
                      value={sectorId}
                      onChange={e => setSectorId(e.target.value)}
                      className={SELECT_CLS}
                    >
                      <option value="">Todas las zonas</option>
                      {zonas.filter(z => z.activo).map(z => (
                        <option key={z.id} value={z.id}>{z.nombre}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                </div>

                {/* Router */}
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    Router
                  </label>
                  <div className="relative">
                    <select
                      value={routerId}
                      onChange={e => setRouterId(e.target.value)}
                      className={SELECT_CLS}
                    >
                      <option value="">Todos los routers</option>
                      {routers.map(r => (
                        <option key={r.id} value={r.id}>{r.nombre}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              {(sectorId || routerId) && (
                <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  Solo se enviarán mensajes a clientes activos con WhatsApp registrado en el segmento seleccionado.
                </p>
              )}
            </div>

            {/* Plantilla */}
            <div>
              <p className={LABEL_CLS}>Plantilla de Mensaje</p>
              <div className="relative">
                <select
                  value={templateId}
                  onChange={e => handleTemplate(e.target.value)}
                  className={SELECT_CLS}
                >
                  <option value="">Seleccionar plantilla...</option>
                  {plantillas.filter(p => p.activo).map(p => (
                    <option key={p.id ?? p.codigo} value={p.id ?? p.codigo}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              </div>

              {/* Preview de contenido */}
              {plantillaSeleccionada && (
                <div className="mt-2 px-3 py-2.5 rounded-lg bg-muted/50 border border-border text-sm text-foreground whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
                  {plantillaSeleccionada.contenido}
                </div>
              )}
            </div>

            {/* Variables dinámicas */}
            {varNames.length > 0 && (
              <div>
                <p className={LABEL_CLS}>Variables de la Plantilla</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {varNames.map(v => (
                    <div key={v}>
                      <label className="text-[11px] text-muted-foreground mb-1 block">
                        {'{' + v + '}'}
                      </label>
                      <input
                        type="text"
                        placeholder={`Valor para ${v}`}
                        value={variables[v] ?? ''}
                        onChange={e => setVariables(prev => ({ ...prev, [v]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Los valores vacíos serán reemplazados automáticamente con los datos del cliente (nombre, teléfono, etc.).
                </p>
              </div>
            )}

            {/* Botón enviar */}
            <button
              onClick={handleEnviar}
              disabled={iniciarMut.isPending || !templateId}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white font-bold text-sm transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {iniciarMut.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <MessageCircle className="w-4 h-4" />}
              {iniciarMut.isPending ? 'Encolando mensajes...' : 'Iniciar Campaña Masiva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
