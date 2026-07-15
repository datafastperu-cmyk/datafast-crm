'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, AlertOctagon, AlertTriangle, Info, ChevronDown, ChevronRight } from 'lucide-react';

import { sistemaApi, EventoSistema } from '@/lib/api/sistema';
import { cn } from '@/lib/utils';

const NIVELES = [
  { value: '',         label: 'Todos' },
  { value: 'critical', label: 'Crítico' },
  { value: 'error',    label: 'Error' },
  { value: 'warn',     label: 'Aviso' },
];

const ORIGENES = [
  { value: '',            label: 'Todos' },
  { value: 'api',         label: 'API' },
  { value: 'db',          label: 'Base de datos' },
  { value: 'olt',         label: 'OLT' },
  { value: 'mikrotik',    label: 'MikroTik' },
  { value: 'whatsapp',    label: 'WhatsApp' },
  { value: 'scheduler',   label: 'Scheduler' },
  { value: 'vpn',         label: 'VPN' },
  { value: 'update',      label: 'Actualizaciones' },
  { value: 'integracion', label: 'Integraciones' },
];

const LIMIT = 25;

function NivelBadge({ nivel }: { nivel: EventoSistema['nivel'] }) {
  const map = {
    critical: { icon: AlertOctagon,  cls: 'bg-red-500/10 text-red-400',     label: 'Crítico' },
    error:    { icon: AlertTriangle, cls: 'bg-amber-500/10 text-amber-400', label: 'Error' },
    warn:     { icon: Info,          cls: 'bg-blue-500/10 text-blue-400',   label: 'Aviso' },
  }[nivel] ?? { icon: Info, cls: 'bg-muted text-muted-foreground', label: nivel };
  const Icon = map.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full', map.cls)}>
      <Icon className="w-3 h-3" />
      {map.label}
    </span>
  );
}

export function EventosSistemaTab() {
  const [nivel, setNivel]       = useState('');
  const [origen, setOrigen]     = useState('');
  const [page, setPage]         = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['sistema-eventos', nivel, origen, page],
    queryFn:  () => sistemaApi.getEventos({
      nivel: nivel || undefined,
      origen: origen || undefined,
      page,
      limit: LIMIT,
    }),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIMIT));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <select
            value={nivel}
            onChange={(e) => { setNivel(e.target.value); setPage(1); }}
            className="text-xs bg-card border border-border rounded-lg px-2.5 py-1.5 text-foreground"
          >
            {NIVELES.map(n => <option key={n.value} value={n.value}>Nivel: {n.label}</option>)}
          </select>
          <select
            value={origen}
            onChange={(e) => { setOrigen(e.target.value); setPage(1); }}
            className="text-xs bg-card border border-border rounded-lg px-2.5 py-1.5 text-foreground"
          >
            {ORIGENES.map(o => <option key={o.value} value={o.value}>Origen: {o.label}</option>)}
          </select>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          Sin eventos registrados{nivel || origen ? ' con esos filtros' : ''}. Buena señal.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left px-4 py-2 font-medium w-8"></th>
                <th className="text-left px-4 py-2 font-medium">Fecha</th>
                <th className="text-left px-4 py-2 font-medium">Nivel</th>
                <th className="text-left px-4 py-2 font-medium">Origen</th>
                <th className="text-left px-4 py-2 font-medium">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((ev) => (
                <Fragment key={ev.id}>
                  <tr
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                    className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/40"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {expanded === ev.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(ev.createdAt).toLocaleString('es-PE')}
                    </td>
                    <td className="px-4 py-2.5"><NivelBadge nivel={ev.nivel} /></td>
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{ev.origen}</td>
                    <td className="px-4 py-2.5 text-xs text-foreground max-w-md truncate">{ev.mensaje}</td>
                  </tr>
                  {expanded === ev.id && (
                    <tr className="border-b border-border/50 last:border-0">
                      <td colSpan={5} className="px-4 py-3 bg-black/20">
                        <div className="space-y-2">
                          {ev.codigo && (
                            <p className="text-xs text-muted-foreground">
                              Código: <span className="font-mono text-foreground">{ev.codigo}</span>
                            </p>
                          )}
                          <p className="text-xs text-foreground whitespace-pre-wrap break-all">{ev.mensaje}</p>
                          {ev.contexto && (
                            <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">
                              {JSON.stringify(ev.contexto, null, 2)}
                            </pre>
                          )}
                          {ev.stack && (
                            <pre className="p-2 rounded-lg bg-black/40 border border-border text-xs text-red-300 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
                              {ev.stack}
                            </pre>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{data?.total ?? 0} eventos</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-2.5 py-1 rounded-lg border border-border disabled:opacity-40 hover:text-foreground"
            >
              Anterior
            </button>
            <span>{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-2.5 py-1 rounded-lg border border-border disabled:opacity-40 hover:text-foreground"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
