'use client';

import { useState }              from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm }               from 'react-hook-form';
import { zodResolver }           from '@hookform/resolvers/zod';
import { z }                     from 'zod';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  AlertTriangle, CheckCircle2, X, Loader2, Wifi,
} from 'lucide-react';

import { monitoreoApi, TIPOS_NODO } from '@/lib/api/monitoreo';
import { useToast }   from '@/components/ui/toaster';
import { parseApiError, formatBps, cn } from '@/lib/utils';
import type { Nodo, Alerta, WsEventDashboard } from '@/types';

// ─────────────────────────────────────────────────────────────
// TraficoChart — Gráfico de tráfico total de la red en tiempo real
// ─────────────────────────────────────────────────────────────
interface TraficoPoint { hora: string; rx: number; tx: number; sesiones: number }

export function TraficoChart({
  nodos, wsStats,
}: { nodos: Nodo[]; wsStats: WsEventDashboard | null }) {
  const [nodoSel, setNodoSel] = useState<string>('');

  // Datos históricos del nodo seleccionado o resumen global
  const { data: mediciones = [] } = useQuery({
    queryKey: ['mediciones', nodoSel],
    queryFn:  () => nodoSel
      ? monitoreoApi.getMediciones(nodoSel, 24)
      : Promise.resolve([]),
    enabled:  !!nodoSel,
    refetchInterval: 5 * 60_000,
  });

  // Convertir mediciones a puntos del gráfico
  const chartData: TraficoPoint[] = nodoSel && mediciones.length > 0
    ? mediciones.slice(-48).map((m: any) => ({
        hora:     new Date(m.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
        rx:       Math.round((m.traficoRxBps ?? 0) / 1_000_000 * 100) / 100,
        tx:       Math.round((m.traficoTxBps ?? 0) / 1_000_000 * 100) / 100,
        sesiones: m.sesionesPppoe ?? 0,
      }))
    : Array.from({ length: 24 }, (_, i) => ({
        hora:     `${String(i).padStart(2, '0')}:00`,
        rx:       0, tx: 0, sesiones: 0,
      }));

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Tráfico de red</h3>
          <p className="text-xs text-muted-foreground">
            {nodoSel ? 'Historial del nodo · 24h' : 'Resumen global en tiempo real'}
          </p>
        </div>

        {/* Selector de nodo */}
        <select
          value={nodoSel}
          onChange={(e) => setNodoSel(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg border border-input bg-background
                     focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Vista global</option>
          {nodos.filter((n) => n.snmpHabilitado).map((n) => (
            <option key={n.id} value={n.id}>{n.nombre}</option>
          ))}
        </select>
      </div>

      {/* Métricas globales en tiempo real */}
      {!nodoSel && wsStats && (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-[10px] text-muted-foreground">Bajada total</p>
            <p className="text-sm font-bold text-primary">{formatBps(wsStats.totalRxBps)}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-[10px] text-muted-foreground">Subida total</p>
            <p className="text-sm font-bold text-green-600">{formatBps(wsStats.totalTxBps)}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-2.5">
            <p className="text-[10px] text-muted-foreground">Sesiones PPPoE</p>
            <p className="text-sm font-bold text-foreground">{wsStats.totalSesiones}</p>
          </div>
        </div>
      )}

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradRx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradTx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="hora" tick={{ fontSize: 10 }} stroke="transparent" interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} stroke="transparent"
                 tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}G` : `${v}M`} />
          <Tooltip
            formatter={(v: number, name: string) => [
              `${v.toFixed(2)} Mbps`, name === 'rx' ? 'Bajada' : 'Subida',
            ]}
            contentStyle={{
              background:   'hsl(var(--card))',
              border:       '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize:     '11px',
            }}
          />
          <Area type="monotone" dataKey="rx" stroke="#3b82f6" fill="url(#gradRx)"
                strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="tx" stroke="#10b981" fill="url(#gradTx)"
                strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AlertasBanner — Banner colapsable de alertas críticas activas
// ─────────────────────────────────────────────────────────────
export function AlertasBanner({ alertas }: { alertas: Alerta[] }) {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [expandida, setExpandida] = useState(true);

  const criticas = alertas.filter((a) => a.nivel === 'critical');
  const warnings = alertas.filter((a) => a.nivel === 'warning');

  const { mutate: resolver } = useMutation({
    mutationFn: (id: string) => monitoreoApi.resolverAlerta(id, 'Resuelto manualmente'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas-activas'] });
      toast('Alerta resuelta', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  if (!alertas.length) return null;

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpandida(!expandida)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
          <span className="text-sm font-semibold text-foreground">
            {alertas.length} alerta{alertas.length !== 1 ? 's' : ''} activa{alertas.length !== 1 ? 's' : ''}
          </span>
          {criticas.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-px rounded-full
                             bg-destructive text-destructive-foreground">
              {criticas.length} CRÍTICA{criticas.length !== 1 ? 'S' : ''}
            </span>
          )}
          {warnings.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-px rounded-full
                             bg-orange-500 text-white">
              {warnings.length} WARNING{warnings.length !== 1 ? 'S' : ''}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{expandida ? '▲ Ocultar' : '▼ Ver'}</span>
      </button>

      {/* Lista expandida */}
      {expandida && (
        <div className="divide-y divide-destructive/10 max-h-60 overflow-y-auto">
          {alertas.map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-3">
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-px rounded-full flex-shrink-0 mt-0.5',
                a.nivel === 'critical'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-orange-500 text-white',
              )}>
                {a.nivel.toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">{a.nodoNombre}</p>
                <p className="text-xs text-muted-foreground">{a.mensaje}</p>
              </div>
              <button
                onClick={() => resolver(a.id)}
                className="flex-shrink-0 p-1 rounded-lg text-muted-foreground
                           hover:text-foreground hover:bg-muted transition-colors"
                title="Marcar como resuelta"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NodoFormModal — Modal para agregar un nodo
// ─────────────────────────────────────────────────────────────
const nodoSchema = z.object({
  nombre:          z.string().min(2, 'Mínimo 2 caracteres'),
  tipo:            z.string().default('router'),
  ipMonitoreo:     z.string().ip('IP inválida'),
  snmpHabilitado:  z.boolean().default(false),
  snmpCommunity:   z.string().default('public'),
  snmpVersion:     z.coerce.number().default(2),
  snmpInterfaceIndex: z.coerce.number().optional(),
  pingHabilitado:  z.boolean().default(true),
  pingIntervaloSeg: z.coerce.number().min(10).max(3600).default(60),
  alertasHabilitadas: z.boolean().default(true),
  descripcion:     z.string().optional(),
});
type NodoForm = z.infer<typeof nodoSchema>;

export function NodoFormModal({
  onClose, onSuccess,
}: { onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const {
    register, handleSubmit, watch,
    formState: { errors },
  } = useForm<NodoForm>({
    resolver:      zodResolver(nodoSchema),
    defaultValues: {
      tipo: 'router', snmpHabilitado: false,
      snmpCommunity: 'public', snmpVersion: 2,
      pingHabilitado: true, pingIntervaloSeg: 60,
      alertasHabilitadas: true,
    },
  });

  const snmpHab = watch('snmpHabilitado');

  const { mutate: crear, isPending } = useMutation({
    mutationFn: (values: NodoForm) => monitoreoApi.createNodo(values),
    onSuccess: () => {
      toast('Nodo registrado', { type: 'success' });
      onSuccess();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg
                      max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" /> Agregar nodo
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit((v) => crear(v))} className="p-6 space-y-4">

          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre *" error={errors.nombre?.message}>
              <input {...register('nombre')} placeholder="Router Principal" className={inp(!!errors.nombre)} />
            </Field>
            <Field label="Tipo">
              <select {...register('tipo')} className={inp()}>
                {TIPOS_NODO.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="IP de monitoreo *" error={errors.ipMonitoreo?.message}>
            <input {...register('ipMonitoreo')} placeholder="192.168.100.1" className={cn(inp(!!errors.ipMonitoreo), 'font-mono')} />
          </Field>

          <Field label="Descripción">
            <input {...register('descripcion')} placeholder="Ubicación o descripción opcional" className={inp()} />
          </Field>

          {/* Ping */}
          <div className="p-4 rounded-xl bg-muted/30 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...register('pingHabilitado')} className="rounded" />
              <span className="text-sm font-medium text-foreground">Monitoreo por ping</span>
            </label>
            <Field label="Intervalo (seg)">
              <input type="number" {...register('pingIntervaloSeg')} min={10} max={3600} className={cn(inp(), 'w-32')} />
            </Field>
          </div>

          {/* SNMP */}
          <div className="p-4 rounded-xl bg-muted/30 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...register('snmpHabilitado')} className="rounded" />
              <span className="text-sm font-medium text-foreground">Polling SNMP (CPU, RAM, tráfico)</span>
            </label>
            {snmpHab && (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Community">
                  <input {...register('snmpCommunity')} placeholder="public" className={inp()} />
                </Field>
                <Field label="Versión">
                  <select {...register('snmpVersion')} className={inp()}>
                    <option value={1}>v1</option>
                    <option value={2}>v2c</option>
                  </select>
                </Field>
                <Field label="ifIndex WAN">
                  <input type="number" {...register('snmpInterfaceIndex')} placeholder="1" className={inp()} />
                </Field>
              </div>
            )}
          </div>

          {/* Alertas */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('alertasHabilitadas')} className="rounded" />
            <span className="text-sm text-foreground">Habilitar alertas para este nodo</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                         bg-primary text-primary-foreground font-medium
                         hover:bg-primary/90 disabled:opacity-60 transition-colors">
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Agregar nodo
            </button>
          </div>
        </form>
      </div>
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

function inp(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
