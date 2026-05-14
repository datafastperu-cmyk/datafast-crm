'use client';

import { useQuery }      from '@tanstack/react-query';
import { ArrowUpRight }  from 'lucide-react';
import { cn }            from '@/lib/utils';
import api               from '@/lib/api';
import { useMonitoreo }  from '@/hooks/useMonitoreo';
import type { Nodo, Alerta, Pago, WsEventAlerta } from '@/types';

// ─────────────────────────────────────────────────────────────
// StatCard
// ─────────────────────────────────────────────────────────────
type CardColor = 'blue' | 'green' | 'emerald' | 'red' | 'orange' | 'purple';

const COLOR_MAP: Record<CardColor, { bg: string; icon: string; text: string }> = {
  blue:    { bg: 'bg-blue-500/10',    icon: 'text-blue-500',    text: 'text-blue-600' },
  green:   { bg: 'bg-green-500/10',   icon: 'text-green-500',   text: 'text-green-600' },
  emerald: { bg: 'bg-emerald-500/10', icon: 'text-emerald-500', text: 'text-emerald-600' },
  red:     { bg: 'bg-red-500/10',     icon: 'text-red-500',     text: 'text-red-600' },
  orange:  { bg: 'bg-orange-500/10',  icon: 'text-orange-500',  text: 'text-orange-600' },
  purple:  { bg: 'bg-purple-500/10',  icon: 'text-purple-500',  text: 'text-purple-600' },
};

interface StatCardProps {
  label:   string;
  value:   string | number;
  sub?:    string;
  icon:    React.ElementType;
  color:   CardColor;
  loading?: boolean;
  live?:   boolean;
  trend?:  { valor: number; label: string; up: boolean };
}

export function StatCard({ label, value, sub, icon: Icon, color, loading, live, trend }: StatCardProps) {
  const c = COLOR_MAP[color];

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 space-y-3 animate-pulse">
        <div className="skeleton h-4 w-24 rounded" />
        <div className="skeleton h-8 w-16 rounded" />
        <div className="skeleton h-3 w-32 rounded" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className={cn('p-2.5 rounded-xl flex-shrink-0', c.bg)}>
          <Icon className={cn('w-5 h-5', c.icon)} />
        </div>
      </div>

      {(trend || live) && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border">
          {trend && (
            <span className={cn(
              'flex items-center gap-1 text-xs font-medium',
              trend.up ? 'text-green-600' : 'text-red-600',
            )}>
              <ArrowUpRight className={cn('w-3 h-3', !trend.up && 'rotate-90')} />
              +{trend.valor} {trend.label}
            </span>
          )}
          {live && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="status-dot-online" />
              En vivo
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NodoGridLive — Grid de nodos con estado en tiempo real
// ─────────────────────────────────────────────────────────────
const ESTADO_COLORS = {
  online:        { dot: 'status-dot-online',   badge: 'text-green-600  bg-green-50  dark:bg-green-950/30' },
  offline:       { dot: 'status-dot-offline',  badge: 'text-red-600    bg-red-50    dark:bg-red-950/30' },
  degradado:     { dot: 'status-dot-warning',  badge: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30' },
  mantenimiento: { dot: 'status-dot-warning',  badge: 'text-blue-600   bg-blue-50   dark:bg-blue-950/30' },
  desconocido:   { dot: 'status-dot-offline',  badge: 'text-gray-600   bg-gray-100  dark:bg-gray-800' },
};

export function NodoGridLive() {
  const { data: nodos = [], isLoading } = useQuery<Nodo[]>({
    queryKey: ['nodos-lista'],
    queryFn:  async () => {
      const res = await api.get('/monitoreo/nodos');
      return res.data.data;
    },
    refetchInterval: 60_000,
  });

  const { mediciones } = useMonitoreo();

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Estado de nodos</h3>
        <span className="text-xs text-muted-foreground">{nodos.length} equipos</span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
          {nodos.map((nodo) => {
            const live   = mediciones.get(nodo.id);
            const estado = (live?.estado ?? nodo.estado) as keyof typeof ESTADO_COLORS;
            const c      = ESTADO_COLORS[estado] ?? ESTADO_COLORS.desconocido;
            const latencia = live?.latenciaMs ?? nodo.latenciaMs;

            return (
              <div key={nodo.id}
                   className="flex flex-col gap-1.5 p-3 rounded-lg border border-border
                              hover:bg-muted/50 transition-colors cursor-default">
                <div className="flex items-center justify-between">
                  <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', c.badge)}>
                    {estado.toUpperCase()}
                  </span>
                  <span className={c.dot} />
                </div>
                <p className="text-xs font-medium text-foreground truncate">{nodo.nombre}</p>
                <p className="text-[10px] text-muted-foreground">
                  {nodo.ipMonitoreo}
                  {latencia != null && <span className="ml-1 text-primary">{latencia.toFixed(0)}ms</span>}
                </p>
              </div>
            );
          })}
          {nodos.length === 0 && (
            <div className="col-span-3 text-center py-8 text-sm text-muted-foreground">
              No hay nodos registrados
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AlertasFeed
// ─────────────────────────────────────────────────────────────
const NIVEL_STYLE = {
  critical: 'text-red-600 bg-red-50 dark:bg-red-950/30',
  warning:  'text-orange-600 bg-orange-50 dark:bg-orange-950/30',
  info:     'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
  recovery: 'text-green-600 bg-green-50 dark:bg-green-950/30',
};

export function AlertasFeed({ alertas }: { alertas: WsEventAlerta[] }) {
  const { data: alertasDb = [] } = useQuery<Alerta[]>({
    queryKey: ['alertas-activas'],
    queryFn:  async () => {
      const res = await api.get('/monitoreo/alertas');
      return res.data.data;
    },
    refetchInterval: 30_000,
  });

  // Combinar alertas del WS con las de la BD
  const todas = alertas.length ? alertas.map((a) => a.alerta) : alertasDb;

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Alertas activas</h3>
        {todas.length > 0 && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
            {todas.length}
          </span>
        )}
      </div>

      <div className="space-y-2 max-h-56 overflow-y-auto">
        {todas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center mb-2">
              <span className="text-lg">✓</span>
            </div>
            <p className="text-sm font-medium text-foreground">Sin alertas activas</p>
            <p className="text-xs text-muted-foreground mt-0.5">Todos los sistemas operando bien</p>
          </div>
        ) : (
          todas.map((alerta, i) => (
            <div key={alerta?.id ?? i}
                 className="flex items-start gap-2 p-2.5 rounded-lg border border-border text-xs">
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0',
                NIVEL_STYLE[alerta?.nivel as keyof typeof NIVEL_STYLE] ?? NIVEL_STYLE.info,
              )}>
                {alerta?.nivel}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{alerta?.nodoNombre}</p>
                <p className="text-muted-foreground line-clamp-2 mt-0.5">{alerta?.mensaje}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// UltimosPagos
// ─────────────────────────────────────────────────────────────
const METODO_BADGE: Record<string, string> = {
  yape:                    '🟣 Yape',
  plin:                    '🔵 Plin',
  efectivo:                '💵 Efectivo',
  transferencia_bancaria:  '🏦 Transferencia',
  deposito_bancario:       '🏦 Depósito',
  mercadopago:             '💳 MercadoPago',
  tarjeta_credito:         '💳 Crédito',
  tarjeta_debito:          '💳 Débito',
};

export function UltimosPagos() {
  const { data: pagos = [], isLoading } = useQuery<any[]>({
    queryKey: ['pagos-recientes'],
    queryFn:  async () => {
      const res = await api.get('/pagos?soloHoy=true&limit=10');
      return res.data.data;
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-full">
      <h3 className="text-sm font-semibold text-foreground mb-4">Pagos de hoy</h3>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {pagos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Sin pagos registrados hoy
            </p>
          ) : (
            pagos.map((p: any) => (
              <div key={p.id}
                   className="flex items-center justify-between gap-2 p-2.5 rounded-lg
                              border border-border hover:bg-muted/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {p.cliente_nombre || 'Cliente'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {METODO_BADGE[p.metodo_pago] || p.metodo_pago}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-foreground">
                    S/ {parseFloat(p.monto).toFixed(2)}
                  </p>
                  <span className={cn(
                    'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                    p.estado === 'verificado'
                      ? 'text-green-600 bg-green-50 dark:bg-green-950/30'
                      : 'text-orange-600 bg-orange-50 dark:bg-orange-950/30',
                  )}>
                    {p.estado === 'verificado' ? 'Verificado' : 'Pendiente'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
