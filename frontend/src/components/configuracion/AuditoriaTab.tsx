'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Download, RefreshCw, Filter,
  ShieldCheck, Clock, User, Globe, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { auditoriaApi, type AuditLog, type FiltrosAuditoria } from '@/lib/api/auditoria';
import { cn } from '@/lib/utils';

const ACCIONES = ['Todas', 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'];
const MODULOS  = ['Todos', 'clientes', 'contratos', 'facturacion', 'pagos', 'planes',
                  'usuarios', 'red', 'soporte', 'monitoreo', 'auth'];

const ACCION_STYLE: Record<string, string> = {
  CREATE: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  UPDATE: 'bg-blue-500/10    text-blue-600    dark:text-blue-400',
  DELETE: 'bg-red-500/10     text-red-600     dark:text-red-400',
  LOGIN:  'bg-violet-500/10  text-violet-600  dark:text-violet-400',
  LOGOUT: 'bg-muted          text-muted-foreground',
};

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function AuditoriaTab() {
  const [search,  setSearch]  = useState('');
  const [accion,  setAccion]  = useState('Todas');
  const [modulo,  setModulo]  = useState('Todos');
  const [page,    setPage]    = useState(1);
  const [expand,  setExpand]  = useState<number | null>(null);
  const LIMIT = 30;

  const filtros: FiltrosAuditoria = {
    page,
    limit: LIMIT,
    search:  search  || undefined,
    accion:  accion  !== 'Todas' ? accion  : undefined,
    modulo:  modulo  !== 'Todos' ? modulo  : undefined,
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['auditoria-logs', filtros],
    queryFn:  () => auditoriaApi.getLogs(filtros),
    staleTime: 10_000,
  });

  const logs       = data?.data       ?? [];
  const total      = data?.total      ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleFilter = () => setPage(1);

  return (
    <div className="space-y-5">

      {/* Stats rápidos */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total registros', value: total.toLocaleString(),  color: 'text-foreground'  },
          { label: 'Página',          value: `${page} / ${totalPages}`, color: 'text-primary'   },
          { label: 'Por página',      value: LIMIT,                   color: 'text-foreground'  },
          { label: 'Módulo',          value: modulo === 'Todos' ? 'Todos' : modulo, color: 'text-amber-500' },
        ].map(s => (
          <div key={s.label} className="border border-border rounded-xl p-3 bg-muted/20">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className={cn('text-xl font-bold mt-0.5 truncate', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar por descripción, usuario, ID..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-muted border border-border rounded-lg
                       text-foreground placeholder:text-muted-foreground
                       focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select value={accion} onChange={e => { setAccion(e.target.value); handleFilter(); }}
          className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground
                     focus:outline-none focus:ring-1 focus:ring-primary">
          {ACCIONES.map(a => <option key={a}>{a}</option>)}
        </select>
        <select value={modulo} onChange={e => { setModulo(e.target.value); handleFilter(); }}
          className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground
                     focus:outline-none focus:ring-1 focus:ring-primary">
          {MODULOS.map(m => <option key={m}>{m}</option>)}
        </select>
        <button onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border
                     text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      {/* Tabla */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                {['Fecha', 'Acción', 'Módulo', 'Descripción', 'Usuario', 'IP'].map(h => (
                  <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-widest
                                         text-muted-foreground px-4 py-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/40">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-3 bg-muted animate-pulse rounded w-20" />
                        </td>
                      ))}
                    </tr>
                  ))
                : logs.length === 0
                ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                      No hay registros con los filtros actuales
                    </td>
                  </tr>
                )
                : logs.map(log => (
                  <>
                    <tr
                      key={log.id}
                      onClick={() => setExpand(expand === log.id ? null : log.id)}
                      className={cn(
                        'border-b border-border/40 cursor-pointer transition-colors',
                        log.accion === 'DELETE' && 'bg-red-500/5',
                        expand === log.id ? 'bg-muted/30' : 'hover:bg-muted/20',
                      )}
                    >
                      <td className="px-4 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap font-mono">
                        {fmtFecha(log.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase',
                          ACCION_STYLE[log.accion] ?? 'bg-muted text-muted-foreground',
                        )}>
                          {log.accion}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-muted-foreground capitalize">
                        {log.modulo}
                      </td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <p className="text-[12px] text-foreground truncate">{log.descripcion}</p>
                        {log.entidad_id && (
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {log.entidad_id.slice(0, 8)}...
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
                        {log.usuario_email ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-muted-foreground font-mono">
                        {log.ip_address ?? '—'}
                      </td>
                    </tr>

                    {/* Detalle expandido */}
                    {expand === log.id && (
                      <tr key={`exp-${log.id}`} className="bg-muted/10">
                        <td colSpan={6} className="px-6 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            {log.datos_anteriores && (
                              <div>
                                <p className="font-semibold text-muted-foreground mb-1.5">Estado anterior</p>
                                <pre className="bg-muted/30 rounded-lg p-3 overflow-auto max-h-40 text-[11px]
                                                text-foreground font-mono leading-relaxed">
                                  {JSON.stringify(log.datos_anteriores, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.datos_nuevos && (
                              <div>
                                <p className="font-semibold text-muted-foreground mb-1.5">Estado nuevo</p>
                                <pre className="bg-muted/30 rounded-lg p-3 overflow-auto max-h-40 text-[11px]
                                                text-foreground font-mono leading-relaxed">
                                  {JSON.stringify(log.datos_nuevos, null, 2)}
                                </pre>
                              </div>
                            )}
                            <div className="flex items-center gap-4 text-muted-foreground col-span-full">
                              <span className="flex items-center gap-1">
                                <Globe  className="w-3 h-3" /> {log.metodo_http} {log.ruta}
                              </span>
                              <span className="flex items-center gap-1">
                                <User   className="w-3 h-3" /> {log.usuario_email}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock  className="w-3 h-3" /> {new Date(log.created_at).toLocaleString('es-PE')}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              }
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
            <p className="text-xs text-muted-foreground">
              {total.toLocaleString()} registros · página {page} de {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted
                           disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pg = page <= 3 ? i + 1 : page - 2 + i;
                if (pg < 1 || pg > totalPages) return null;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={cn(
                      'w-7 h-7 text-xs rounded-lg transition-colors',
                      pg === page
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}>
                    {pg}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted
                           disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
