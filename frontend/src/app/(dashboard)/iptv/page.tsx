'use client';

import { useState }   from 'react';
import { Tv, Plus, PlayCircle, Users, Radio } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn }         from '@/lib/utils';
import { mockCanalesIptv, mockClientesIptv } from '@/mock-data';

export default function IPTVPage() {
  const [tab, setTab] = useState<'clientes' | 'canales'>('clientes');

  const stats = {
    clientesActivos: mockClientesIptv.filter(c => c.estado === 'activo').length,
    canalesActivos:  mockCanalesIptv.filter(c => c.activo).length,
    canalesHD:       mockCanalesIptv.filter(c => c.hd).length,
    categorias:      [...new Set(mockCanalesIptv.map(c => c.categoria))].length,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="IPTV / Streaming"
        description="Gestión de abonados y canales del servicio de IPTV"
        breadcrumbs={[{ label:'Servicios' }, { label:'IPTV' }]}
        badge={{ label:'TRAPEMN', color:'purple' }}
        actions={
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="w-3.5 h-3.5" />
            Nuevo abonado
          </button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Abonados activos', value:stats.clientesActivos, icon:Users,       color:'text-blue-400',   bg:'bg-blue-500/10' },
          { label:'Canales activos',  value:stats.canalesActivos,  icon:Tv,          color:'text-emerald-400',bg:'bg-emerald-500/10' },
          { label:'Canales HD',       value:stats.canalesHD,       icon:PlayCircle,  color:'text-violet-400', bg:'bg-violet-500/10' },
          { label:'Categorías',       value:stats.categorias,      icon:Radio,       color:'text-amber-400',  bg:'bg-amber-500/10' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className={cn('p-2.5 rounded-xl flex-shrink-0', s.bg)}>
              <s.icon className={cn('w-5 h-5', s.color)} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
              <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-0.5 w-fit">
        {(['clientes','canales'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('text-sm px-4 py-1.5 rounded-md capitalize transition-colors',
              tab === t ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}>{t === 'clientes' ? 'Abonados' : 'Canales'}</button>
        ))}
      </div>

      {tab === 'clientes' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Abonado</th>
                <th>Plan</th>
                <th>Dispositivos</th>
                <th>MAC STB</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {mockClientesIptv.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium text-foreground">{c.nombre}</td>
                  <td className="text-xs text-muted-foreground">{c.plan}</td>
                  <td className="text-center text-sm font-semibold text-foreground">{c.dispositivos}</td>
                  <td className="font-mono text-xs text-muted-foreground">{c.mac}</td>
                  <td className="text-xs text-muted-foreground">{c.fechaVencimiento}</td>
                  <td>
                    {c.estado === 'activo'
                      ? <span className="pill-online">Activo</span>
                      : <span className="pill-offline">Suspendido</span>
                    }
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="text-xs text-primary hover:underline">Gestionar</button>
                      {c.estado === 'activo'
                        ? <button className="text-xs text-amber-400 hover:underline">Suspender</button>
                        : <button className="text-xs text-emerald-400 hover:underline">Activar</button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'canales' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {mockCanalesIptv.map((ch) => (
            <div key={ch.id}
                 className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:border-border/80 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-xl flex-shrink-0">
                {ch.logo}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-foreground truncate">{ch.nombre}</p>
                  {ch.hd && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-blue-500/15 text-blue-400">HD</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-muted-foreground">CH {ch.numero}</span>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="text-xs text-muted-foreground">{ch.categoria}</span>
                </div>
              </div>
              <span className={ch.activo ? 'status-dot-online' : 'status-dot-offline'} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
