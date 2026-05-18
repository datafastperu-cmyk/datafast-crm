'use client';

import { useState, useMemo } from 'react';
import { Terminal, Search, Download, RefreshCcw, AlertCircle, Info, AlertTriangle, Bug } from 'lucide-react';
import { cn }       from '@/lib/utils';
import { mockLogs } from '@/mock-data';

const NIVEL_STYLE = {
  info:    { class: 'bg-blue-500/10 text-blue-400',   icon: Info,          dot: 'bg-blue-500' },
  warning: { class: 'bg-amber-500/10 text-amber-400', icon: AlertTriangle, dot: 'bg-amber-500' },
  error:   { class: 'bg-red-500/10 text-red-400',     icon: AlertCircle,   dot: 'bg-red-500' },
  debug:   { class: 'bg-muted text-muted-foreground', icon: Bug,           dot: 'bg-muted-foreground' },
};

const MODULOS = ['Todos', ...Array.from(new Set(mockLogs.map((l) => l.modulo))).sort()];

export function LogsTab() {
  const [search, setSearch] = useState('');
  const [nivel,  setNivel]  = useState('todos');
  const [modulo, setModulo] = useState('Todos');
  const [auto,   setAuto]   = useState(true);

  const stats = {
    total:    mockLogs.length,
    errors:   mockLogs.filter((l) => l.nivel === 'error').length,
    warnings: mockLogs.filter((l) => l.nivel === 'warning').length,
    infos:    mockLogs.filter((l) => l.nivel === 'info').length,
  };

  const filtered = useMemo(() => mockLogs.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.mensaje.toLowerCase().includes(q) || l.modulo.toLowerCase().includes(q) || (l.usuario ?? '').includes(q);
    const matchNivel  = nivel === 'todos' || l.nivel === nivel;
    const matchModulo = modulo === 'Todos' || l.modulo === modulo;
    return matchSearch && matchNivel && matchModulo;
  }), [search, nivel, modulo]);

  return (
    <div className="space-y-5">

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total eventos', value: stats.total,    color: 'text-foreground', bg: 'bg-muted/50' },
          { label: 'Errores',       value: stats.errors,   color: 'text-red-400',    bg: 'bg-red-500/8' },
          { label: 'Advertencias',  value: stats.warnings, color: 'text-amber-400',  bg: 'bg-amber-500/8' },
          { label: 'Informativos',  value: stats.infos,    color: 'text-blue-400',   bg: 'bg-blue-500/8' },
        ].map((s) => (
          <div key={s.label} className={cn('border border-border rounded-xl p-4', s.bg)}>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar en logs..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          {(['todos', 'info', 'warning', 'error', 'debug'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setNivel(v)}
              className={cn(
                'text-xs px-2.5 py-1.5 rounded-md capitalize transition-colors',
                nivel === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >{v}</button>
          ))}
        </div>
        <select
          value={modulo}
          onChange={(e) => setModulo(e.target.value)}
          className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {MODULOS.map((m) => <option key={m}>{m}</option>)}
        </select>
        <button
          onClick={() => setAuto((a) => !a)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            auto
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-muted text-muted-foreground border border-border',
          )}
        >
          <RefreshCcw className={cn('w-3.5 h-3.5', auto && 'animate-spin')} style={auto ? { animationDuration: '3s' } : {}} />
          {auto ? 'Auto' : 'Pausado'}
        </button>
        <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <Download className="w-3.5 h-3.5" />
          Exportar
        </button>
      </div>

      {/* Log viewer */}
      <div className="bg-muted/20 border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Terminal className="w-3.5 h-3.5" />
            <span>system.log</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{filtered.length} entradas</span>
          </div>
          {auto && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="status-dot-online" />
              En vivo
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-muted/20">
              <tr>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-4 py-2.5 w-44">Timestamp</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-4 py-2.5 w-20">Nivel</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-4 py-2.5 w-28">Módulo</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-4 py-2.5">Mensaje</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-4 py-2.5 w-28">Usuario</th>
                <th className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-4 py-2.5 w-32">IP</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {filtered.map((log) => {
                const ns = (NIVEL_STYLE as any)[log.nivel] ?? NIVEL_STYLE.info;
                return (
                  <tr
                    key={log.id}
                    className={cn(
                      'border-b border-border/40 hover:bg-muted/20 transition-colors',
                      log.nivel === 'error'   && 'bg-red-500/5',
                      log.nivel === 'warning' && 'hover:bg-amber-500/5',
                    )}
                  >
                    <td className="px-4 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('es-PE', {
                        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded uppercase', ns.class)}>
                        {log.nivel}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{log.modulo}</td>
                    <td className="px-4 py-2">
                      <p className="text-[12px] text-foreground">{log.mensaje}</p>
                      {log.detalles && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{log.detalles}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{log.usuario ?? '—'}</td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{log.ip ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No hay logs que coincidan con los filtros
          </div>
        )}
      </div>
    </div>
  );
}
