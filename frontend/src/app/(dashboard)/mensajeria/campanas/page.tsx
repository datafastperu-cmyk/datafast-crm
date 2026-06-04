'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Megaphone, Loader2, Users, ChevronDown, Ban, Send,
  Clock, CheckCircle2, XCircle, ChevronLeft,
} from 'lucide-react';
import { mensajeriaApi } from '@/lib/api/mensajeria';
import { plantillasApi } from '@/lib/api/plantillas';
import { zonasApi }      from '@/lib/api/zonas';
import { mikrotikApi }   from '@/lib/api/mikrotik';
import { useToast }      from '@/components/ui/toaster';
import { cn }            from '@/lib/utils';

// ─── Constantes ──────────────────────────────────────────────────────────────
const INPUT = [
  'w-full px-3 py-2 text-sm rounded-lg border border-input',
  'bg-background text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring transition-colors',
].join(' ');

function extractVariables(contenido: string): string[] {
  return [...new Set([...contenido.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
}

// ─── Cuota diaria ─────────────────────────────────────────────────────────────
function CuotaMeter() {
  const { data, isLoading } = useQuery({
    queryKey: ['mensajeria', 'cuota'],
    queryFn:  mensajeriaApi.cuota,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-center h-[72px]">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pct   = data.limiteDiario > 0 ? Math.min((data.usado / data.limiteDiario) * 100, 100) : 0;
  const color = pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const text  = pct >= 100 ? 'text-destructive' : pct >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Cuota Hoy</span>
        <span className={cn('text-xs font-bold', text)}>{data.usado} / {data.limiteDiario}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">{pct.toFixed(1)}% usado</span>
        <span className="text-[10px] text-muted-foreground">{data.restante} restantes</span>
      </div>
    </div>
  );
}

// ─── Monitor en tiempo real ───────────────────────────────────────────────────
function MonitorStats({ onPausar, pausando }: { onPausar: () => void; pausando: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['mensajeria', 'monitor'],
    queryFn:  mensajeriaApi.monitor,
    refetchInterval: 10_000,
  });

  const stats = [
    { label: 'Encolados', value: data?.encolados ?? 0, cls: 'text-muted-foreground',                   icon: Clock        },
    { label: 'Enviados',  value: data?.enviados   ?? 0, cls: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
    { label: 'Fallidos',  value: data?.fallidos   ?? 0, cls: 'text-destructive',                        icon: XCircle      },
  ];

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Monitor — Hoy</span>
        {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex gap-3 mb-2">
        {stats.map(({ label, value, cls, icon: Icon }) => (
          <div key={label} className="flex items-center gap-1.5">
            <Icon className={cn('w-3.5 h-3.5', cls)} />
            <span className="text-xs font-semibold text-foreground">{value}</span>
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onPausar}
        disabled={pausando}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-destructive/50 text-destructive text-xs font-semibold hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
      >
        {pausando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
        Pausar campaña activa
      </button>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function CampanasPage() {
  const qc        = useQueryClient();
  const { toast } = useToast();
  const [sectorId,   setSectorId]   = useState('');
  const [routerId,   setRouterId]   = useState('');
  const [templateId, setTemplateId] = useState('');
  const [variables,  setVariables]  = useState<Record<string, string>>({});

  const { data: zonas      = [] } = useQuery({ queryKey: ['zonas'],   queryFn: zonasApi.list });
  const { data: routers    = [] } = useQuery({ queryKey: ['routers'], queryFn: mikrotikApi.listar });
  const { data: plantillas = [] } = useQuery({
    queryKey: ['plantillas', 'whatsapp'],
    queryFn:  () => plantillasApi.listar('whatsapp'),
  });

  const plantillaActiva = useMemo(
    () => plantillas.find(p => p.id === templateId || p.codigo === templateId),
    [plantillas, templateId],
  );
  const varNames = useMemo(
    () => plantillaActiva ? extractVariables(plantillaActiva.contenido) : [],
    [plantillaActiva],
  );

  const iniciarMut = useMutation({
    mutationFn: mensajeriaApi.iniciarCampana,
    onSuccess: (res) => {
      toast(`${res.encolados} mensajes encolados — cuota restante: ${res.cuotaRestante}`, { type: 'success' });
      qc.invalidateQueries({ queryKey: ['mensajeria'] });
    },
    onError: (err: Error) => {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? err.message;
      toast(msg || 'Error al iniciar campaña', { type: 'error' });
    },
  });

  const pausarMut = useMutation({
    mutationFn: mensajeriaApi.vaciarCola,
    onSuccess: (res) => {
      toast(`Campaña pausada — ${res.eliminados} jobs eliminados`, { type: 'success' });
      qc.invalidateQueries({ queryKey: ['mensajeria'] });
    },
  });

  const SELECT_CLS = cn(INPUT, 'cursor-pointer appearance-none');

  return (
    <div className="p-6 max-w-3xl space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link
          href="/mensajeria"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />Mensajería
        </Link>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs text-foreground font-medium">Campañas Masivas</span>
      </div>

      {/* Lanzador */}
      <div className="border border-border rounded-xl overflow-hidden">
        {/* Header azul */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-[#1a3a8f]/80">
          <Megaphone className="w-4 h-4 text-white" />
          <span className="text-sm font-bold text-white">Lanzador de Campañas Masivas</span>
        </div>

        <div className="p-5 space-y-4">
          {/* Cuota + Monitor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CuotaMeter />
            <MonitorStats onPausar={() => pausarMut.mutate()} pausando={pausarMut.isPending} />
          </div>

          {/* Segmentación */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Segmentación de destinatarios
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  <Users className="w-3 h-3 inline mr-1" />Sector / Zona
                </label>
                <div className="relative">
                  <select value={sectorId} onChange={e => setSectorId(e.target.value)} className={SELECT_CLS}>
                    <option value="">Todas las zonas</option>
                    {zonas.filter(z => z.activo).map(z => (
                      <option key={z.id} value={z.id}>{z.nombre}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">Router / MikroTik</label>
                <div className="relative">
                  <select value={routerId} onChange={e => setRouterId(e.target.value)} className={SELECT_CLS}>
                    <option value="">Todos los routers</option>
                    {routers.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Plantilla */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Plantilla de mensaje
            </label>
            <div className="relative">
              <select
                value={templateId}
                onChange={e => { setTemplateId(e.target.value); setVariables({}); }}
                className={SELECT_CLS}
              >
                <option value="">Seleccionar plantilla...</option>
                {plantillas.filter(p => p.activo).map(p => (
                  <option key={p.id ?? p.codigo} value={p.id ?? p.codigo}>{p.nombre}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
            {plantillaActiva && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-muted/40 border border-border text-xs text-foreground whitespace-pre-wrap max-h-28 overflow-y-auto leading-relaxed">
                {plantillaActiva.contenido}
              </div>
            )}
          </div>

          {/* Variables dinámicas */}
          {varNames.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {varNames.map(v => (
                <div key={v}>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{'{' + v + '}'}</label>
                  <input
                    type="text"
                    placeholder={`Valor para ${v}`}
                    value={variables[v] ?? ''}
                    onChange={e => setVariables(prev => ({ ...prev, [v]: e.target.value }))}
                    className={INPUT}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Botón lanzar */}
          <button
            onClick={() => {
              if (!templateId) { toast('Selecciona una plantilla', { type: 'warning' }); return; }
              iniciarMut.mutate({
                tipo:       'CAMPANA_MASIVA',
                templateId: templateId || undefined,
                sectorId:   sectorId   || undefined,
                routerId:   routerId   || undefined,
                variables:  Object.keys(variables).length > 0 ? variables : undefined,
              });
            }}
            disabled={iniciarMut.isPending || !templateId}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {iniciarMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Encolando mensajes...</>
              : <><Send className="w-4 h-4" /> Iniciar Campaña Masiva</>}
          </button>
        </div>
      </div>
    </div>
  );
}
