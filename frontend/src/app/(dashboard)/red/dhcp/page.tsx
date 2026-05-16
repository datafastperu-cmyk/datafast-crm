'use client';

import { useState } from 'react';
import { Layers, Search, RefreshCcw } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn }         from '@/lib/utils';
import { mockDhcpLeases } from '@/mock-data';

export default function DHCPPage() {
  const [search, setSearch] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'activo' | 'estatico' | 'expirado'>('todos');

  const leases = mockDhcpLeases.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.hostname.toLowerCase().includes(q) || l.ipAsignada.includes(q) || l.macAddress.toLowerCase().includes(q);
    const matchFiltro = filtro === 'todos' || l.estado === filtro;
    return matchSearch && matchFiltro;
  });

  const counts = {
    activo:   mockDhcpLeases.filter((l) => l.estado === 'activo').length,
    estatico: mockDhcpLeases.filter((l) => l.estado === 'estatico').length,
    expirado: mockDhcpLeases.filter((l) => l.estado === 'expirado').length,
  };

  const ESTADO_STYLE: Record<string, string> = {
    activo:   'pill-online',
    estatico: 'pill-info',
    expirado: 'pill-offline',
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="DHCP Leases"
        description="Asignaciones de IP activas y estáticas en la red"
        breadcrumbs={[{ label: 'Gestión de Red' }, { label: 'DHCP' }]}
        badge={{ label: `${leases.length} leases`, color: 'blue' }}
        actions={
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-sm font-medium text-foreground hover:bg-muted/80 transition-colors">
            <RefreshCcw className="w-3.5 h-3.5" />
            Sincronizar
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label:'Activos',   value: counts.activo,   color:'text-emerald-400', bg:'bg-emerald-500/8' },
          { label:'Estáticos', value: counts.estatico, color:'text-blue-400',    bg:'bg-blue-500/8' },
          { label:'Expirados', value: counts.expirado, color:'text-red-400',     bg:'bg-red-500/8' },
        ].map((s) => (
          <div key={s.label} className={cn('border border-border rounded-xl p-4', s.bg)}>
            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Pool utilization */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-foreground">Utilización de pools DHCP</p>
          <p className="text-xs text-muted-foreground">82% promedio</p>
        </div>
        {[
          { pool:'residencial-pool', rango:'192.168.0.0/20', usado:420, total:512, color:'bg-blue-500' },
          { pool:'empresarial-pool', rango:'10.10.0.0/24',   usado:24,  total:254, color:'bg-emerald-500' },
          { pool:'ftth-pool',        rango:'10.20.0.0/22',   usado:310, total:1024,color:'bg-violet-500' },
        ].map((p) => (
          <div key={p.pool} className="flex items-center gap-3 py-2">
            <p className="text-xs font-mono text-foreground w-40 flex-shrink-0">{p.pool}</p>
            <p className="text-[11px] text-muted-foreground w-36 flex-shrink-0">{p.rango}</p>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', p.color)}
                   style={{ width: `${Math.round((p.usado / p.total) * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground w-20 text-right flex-shrink-0">
              {p.usado}/{p.total} ({Math.round((p.usado/p.total)*100)}%)
            </p>
          </div>
        ))}
      </div>

      {/* Filtros + Tabla */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex gap-3 p-4 border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Hostname, IP, MAC..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {(['todos','activo','estatico','expirado'] as const).map((v) => (
              <button key={v} onClick={() => setFiltro(v)}
                className={cn('text-xs px-3 py-1.5 rounded-md capitalize transition-colors',
                  filtro === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}>{v}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th>IP Asignada</th>
                <th>MAC Address</th>
                <th>Cliente</th>
                <th>Servidor</th>
                <th>Expira</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {leases.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono text-xs font-medium text-foreground">{l.hostname}</td>
                  <td className="font-mono text-xs text-primary">{l.ipAsignada}</td>
                  <td className="font-mono text-xs text-muted-foreground">{l.macAddress}</td>
                  <td className="text-xs text-foreground">{l.clienteNombre ?? <span className="text-muted-foreground">Desconocido</span>}</td>
                  <td className="text-xs text-muted-foreground">{l.servidor}</td>
                  <td className="text-xs font-mono text-muted-foreground">{l.expira}</td>
                  <td><span className={ESTADO_STYLE[l.estado]}>{l.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
