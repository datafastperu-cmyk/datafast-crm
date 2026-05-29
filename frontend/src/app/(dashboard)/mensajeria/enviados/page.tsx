'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare, Loader2, RefreshCw,
  ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, Clock,
} from 'lucide-react';
import { sistemaApi, type NotifLog } from '@/lib/api/sistema';
import { cn } from '@/lib/utils';

const LIMIT = 20;

const TIPOS = [
  'pago_vence_hoy', 'pago_vencido', 'servicio_suspendido',
  'servicio_reactivado', 'servicio_activado', 'factura_emitida',
  'pago_recibido', 'prorroga_concedida', 'bienvenida',
  'onu_offline', 'mantenimiento',
];

const INPUT = [
  'w-full px-3 py-2 text-sm rounded-lg border border-input',
  'bg-background text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring transition-colors',
].join(' ');

function EstadoBadge({ estado, error }: { estado: NotifLog['estado_entrega']; error?: string | null }) {
  const map = {
    ENCOLADO:     { cls: 'bg-amber-500/10 text-amber-500',     icon: <Clock        className="w-3 h-3" />, label: 'Encolado' },
    ENVIADO_META: { cls: 'bg-emerald-500/10 text-emerald-500', icon: <CheckCircle2 className="w-3 h-3" />, label: 'Enviado'  },
    FALLIDO:      { cls: 'bg-rose-500/10 text-rose-500',       icon: <AlertCircle  className="w-3 h-3" />, label: 'Fallido'  },
  } as const;

  const cfg = map[estado];

  if (estado === 'FALLIDO' && error) {
    return (
      <span className="relative group inline-flex">
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-help', cfg.cls)}>
          {cfg.icon} {cfg.label}
        </span>
        <span className={cn(
          'pointer-events-none absolute bottom-full left-0 mb-1.5 z-50',
          'w-64 rounded-lg border border-border bg-popover p-2.5 shadow-lg',
          'text-xs text-popover-foreground leading-relaxed',
          'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
        )}>
          <span className="font-semibold text-rose-400 block mb-1">Detalle del error</span>
          {error}
        </span>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.cls)}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

export default function MensajesEnviadosPage() {
  const [page,   setPage]   = useState(1);
  const [estado, setEstado] = useState('');
  const [tipo,   setTipo]   = useState('');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['notif-logs', page, estado, tipo],
    queryFn:  () => sistemaApi.getNotifLogs({ page, limit: LIMIT, estado: estado || undefined, tipo: tipo || undefined }),
    staleTime: 30_000,
  });

  const items      = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const handleFilter = (field: 'estado' | 'tipo', val: string) => {
    if (field === 'estado') setEstado(val);
    else                    setTipo(val);
    setPage(1);
  };

  const formatFecha = (iso: string) =>
    new Date(iso).toLocaleString('es-PE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          Mensajes Enviados
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Historial de notificaciones automáticas enviadas a los abonados.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Header + filtros */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Historial de notificaciones</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {total > 0 ? `${total} registros en total` : 'Sin registros aún'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={estado}
              onChange={e => handleFilter('estado', e.target.value)}
              className={cn(INPUT, 'w-36 py-1.5 text-xs')}
            >
              <option value="">Todos los estados</option>
              <option value="ENCOLADO">Encolado</option>
              <option value="ENVIADO_META">Enviado</option>
              <option value="FALLIDO">Fallido</option>
            </select>
            <select
              value={tipo}
              onChange={e => handleFilter('tipo', e.target.value)}
              className={cn(INPUT, 'w-44 py-1.5 text-xs')}
            >
              <option value="">Todos los tipos</option>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
              title="Actualizar"
            >
              <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', isFetching && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Contenido */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="w-10 h-10 text-muted-foreground opacity-20 mb-3" />
            <p className="text-sm font-medium text-foreground">Sin registros</p>
            <p className="text-xs text-muted-foreground mt-1">
              Los logs aparecerán aquí en cuanto se encolen notificaciones.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-[1fr_130px_160px_140px_110px] gap-3 px-6 py-2.5 border-b border-border text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              <span>Cliente / Contrato</span>
              <span>Teléfono</span>
              <span>Tipo de alerta</span>
              <span>Fecha de envío</span>
              <span>Estado</span>
            </div>
            <div className="divide-y divide-border">
              {items.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-1 md:grid-cols-[1fr_130px_160px_140px_110px] gap-x-3 gap-y-1 px-6 py-3 hover:bg-muted/30 transition-colors items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {log.cliente_nombre ?? <span className="text-muted-foreground italic">Sin cliente</span>}
                    </p>
                    {log.numero_contrato && (
                      <p className="text-xs text-muted-foreground font-mono">{log.numero_contrato}</p>
                    )}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">{log.telefono}</p>
                  <p className="text-xs text-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded inline-block">
                    {log.tipo_template}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">{formatFecha(log.created_at)}</p>
                  <div>
                    <EstadoBadge estado={log.estado_entrega} error={log.error_detalle} />
                  </div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Página {page} de {totalPages} · {total} registros
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || isFetching}
                    className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || isFetching}
                    className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
