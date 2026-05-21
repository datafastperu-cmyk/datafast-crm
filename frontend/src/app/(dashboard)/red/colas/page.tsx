'use client';

import { useState } from 'react';
import { List, Search, Plus, RefreshCcw, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn }         from '@/lib/utils';
import { mockColas }  from '@/mock-data';

function UsageBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground w-16 text-right font-mono">{value} Mbps</span>
    </div>
  );
}

export default function ColasPage() {
  const [search, setSearch] = useState('');

  const colas = mockColas.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.nombre.toLowerCase().includes(q) || c.objetivo.includes(q) || (c.clienteNombre ?? '').toLowerCase().includes(q);
  });

  const limiteBps = (s: string) => {
    if (s.endsWith('G')) return parseFloat(s) * 1000;
    if (s.endsWith('M')) return parseFloat(s);
    if (s.endsWith('k')) return parseFloat(s) / 1000;
    return parseFloat(s);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Colas / QoS"
        description="Simple Queues y PCQ configuradas en los routers"
        breadcrumbs={[{ label:'Gestión de Red' }, { label:'Colas' }]}
        badge={{ label: `${mockColas.filter(c=>c.estado==='activa').length} activas`, color:'green' }}
        actions={
          <div className="flex gap-2">
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-colors">
              <RefreshCcw className="w-3.5 h-3.5" />
            </button>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Nueva cola
            </button>
          </div>
        }
      />

      {/* Alerta throttling */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-400">Throttling activo</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            1 cliente con velocidad reducida por mora (crojas-MORA: limitado a 1M/512k). El servicio se restablecerá al registrar el pago.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Total colas',    value:mockColas.length,                                  color:'text-foreground' },
          { label:'Simple Queues',  value:mockColas.filter(c=>!c.nombre.startsWith('PCQ')).length, color:'text-blue-400' },
          { label:'PCQ Groups',     value:mockColas.filter(c=>c.nombre.startsWith('PCQ')).length,  color:'text-violet-400' },
          { label:'Throttling',     value:mockColas.filter(c=>c.limiteBajada==='1M').length,  color:'text-amber-400' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtro */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, IP, abonado..."
          className="w-full pl-9 pr-3 py-2.5 text-sm bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {/* Tabla */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Objetivo / IP</th>
                <th>Límite Bajada</th>
                <th>Uso Bajada</th>
                <th>Límite Subida</th>
                <th>Uso Subida</th>
                <th>Prioridad</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {colas.map((q) => {
                const maxBajada = limiteBps(q.limiteBajada);
                const maxSubida = limiteBps(q.limitSubida);
                const isThrottled = q.limiteBajada === '1M';
                return (
                  <tr key={q.id} className={cn(isThrottled && 'bg-amber-500/5')}>
                    <td>
                      <div>
                        <p className="font-mono text-xs font-semibold text-foreground">{q.nombre}</p>
                        {q.clienteNombre && <p className="text-[10px] text-muted-foreground mt-0.5">{q.clienteNombre}</p>}
                      </div>
                    </td>
                    <td className="font-mono text-xs text-primary">{q.objetivo}</td>
                    <td className="text-xs font-bold text-foreground">{q.limiteBajada}</td>
                    <td className="w-40">
                      <UsageBar value={q.usoBajada} max={maxBajada}
                        color={q.usoBajada / maxBajada > 0.85 ? 'bg-red-500' : q.usoBajada / maxBajada > 0.6 ? 'bg-amber-500' : 'bg-emerald-500'} />
                    </td>
                    <td className="text-xs font-bold text-foreground">{q.limitSubida}</td>
                    <td className="w-40">
                      <UsageBar value={q.usoSubida} max={maxSubida} color="bg-blue-500" />
                    </td>
                    <td>
                      <span className={cn('w-6 h-6 flex items-center justify-center rounded text-xs font-bold',
                        q.prioridad >= 7 ? 'bg-violet-500/15 text-violet-400' :
                        q.prioridad >= 5 ? 'bg-blue-500/15 text-blue-400' :
                        'bg-muted text-muted-foreground'
                      )}>{q.prioridad}</span>
                    </td>
                    <td>
                      {isThrottled
                        ? <span className="pill-warning text-amber-400">Throttled</span>
                        : <span className="pill-online">Activa</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
