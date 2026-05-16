'use client';

import { useState } from 'react';
import { Zap, Search, RefreshCcw, Download, Filter } from 'lucide-react';
import { PageHeader }    from '@/components/shared/PageHeader';
import { cn, formatBps } from '@/lib/utils';
import { mockSesionesPppoe, mockDashboardStats } from '@/mock-data';

export default function PPPoEPage() {
  const [search, setSearch] = useState('');
  const [router, setRouter] = useState('todos');

  const routers = ['todos', 'DIST-SJL-01', 'DIST-CALLAO-01', 'DIST-ATE-01', 'DIST-VMT-01'];

  const sesiones = mockSesionesPppoe.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch = !q || s.usuario.includes(q) || s.ipAsignada.includes(q) || s.routerNombre.toLowerCase().includes(q);
    const matchRouter = router === 'todos' || s.routerNombre === router;
    return matchSearch && matchRouter;
  });

  const totalRx = sesiones.reduce((sum, s) => sum + s.rxMbps, 0);
  const totalTx = sesiones.reduce((sum, s) => sum + s.txMbps, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sesiones PPPoE"
        description="Sesiones activas en tiempo real en todos los routers"
        breadcrumbs={[{ label: 'Gestión de Red' }, { label: 'Sesiones PPPoE' }]}
        badge={{ label: `${mockDashboardStats.pppoe.sesionesActivas.toLocaleString()} sesiones`, color: 'green' }}
        actions={
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-colors">
            <RefreshCcw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Sesiones activas', value: sesiones.length.toString(), color:'bg-blue-500/10 text-blue-400' },
          { label:'Pico hoy',         value: mockDashboardStats.pppoe.pico24h.toLocaleString(), color:'bg-violet-500/10 text-violet-400' },
          { label:'Bajada total',     value: `${totalRx.toFixed(0)} Mbps`, color:'bg-emerald-500/10 text-emerald-400' },
          { label:'Subida total',     value: `${totalTx.toFixed(0)} Mbps`, color:'bg-amber-500/10 text-amber-400' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            <p className={cn('text-xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar usuario, IP, router..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select value={router} onChange={(e) => setRouter(e.target.value)}
            className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            {routers.map((r) => <option key={r} value={r}>{r === 'todos' ? 'Todos los routers' : r}</option>)}
          </select>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Download className="w-4 h-4" />
            Exportar
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Usuario PPPoE</th>
                <th>IP Asignada</th>
                <th>MAC Address</th>
                <th>Router</th>
                <th>Tiempo</th>
                <th>Bajada</th>
                <th>Subida</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {sesiones.map((s) => (
                <tr key={s.id} className="cursor-pointer">
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="status-dot-online" />
                      <span className="font-mono text-xs font-semibold text-foreground">{s.usuario}</span>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-primary">{s.ipAsignada}</td>
                  <td className="font-mono text-xs text-muted-foreground">{s.macAddress}</td>
                  <td className="text-xs text-muted-foreground">{s.routerNombre}</td>
                  <td className="text-xs text-muted-foreground font-mono">{s.tiempo}</td>
                  <td>
                    <span className={cn('text-xs font-semibold', s.rxMbps > 50 ? 'text-amber-400' : 'text-emerald-400')}>
                      {s.rxMbps} Mbps
                    </span>
                  </td>
                  <td className="text-xs text-blue-400 font-semibold">{s.txMbps} Mbps</td>
                  <td>
                    <span className="pill-online">{s.estado}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
          {sesiones.length} sesiones · Actualizado hace 30s
        </div>
      </div>
    </div>
  );
}
