'use client';

import { useState }   from 'react';
import { Zap, Play, Pause, Settings, AlertTriangle, Users, Clock, CheckCircle } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn, formatPEN } from '@/lib/utils';
import { mockClientes } from '@/mock-data';

// Clientes suspendidos aptos para corte
const clientesMorosos = mockClientes.filter(c => c.estado === 'suspendido');

const HISTORIAL_CORTES = [
  { id:'h1', fecha:'2025-05-15 06:00', tipo:'automatico', afectados:23, restaurados:18, pendientes:5, estado:'completado' },
  { id:'h2', fecha:'2025-05-14 06:00', tipo:'automatico', afectados:19, restaurados:14, pendientes:5, estado:'completado' },
  { id:'h3', fecha:'2025-05-13 06:00', tipo:'automatico', afectados:21, restaurados:16, pendientes:5, estado:'completado' },
  { id:'h4', fecha:'2025-05-12 14:30', tipo:'manual',     afectados:3,  restaurados:2,  pendientes:1, estado:'completado' },
];

export default function CortesPage() {
  const [sistemaActivo, setSistemaActivo] = useState(true);
  const [diasGracia, setDiasGracia] = useState('3');
  const [horaCorte,  setHoraCorte]  = useState('06:00');
  const [throttling, setThrottling] = useState(true);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cortes Automáticos"
        description="Sistema de suspensión automática por mora y throttling de velocidad"
        breadcrumbs={[{ label:'Finanzas' }, { label:'Cortes Automáticos' }]}
        badge={{ label: sistemaActivo ? 'Sistema activo' : 'Sistema pausado', color: sistemaActivo ? 'green' : 'yellow' }}
      />

      {/* Status banner */}
      <div className={cn(
        'flex items-start gap-3 p-4 rounded-xl border',
        sistemaActivo
          ? 'bg-emerald-500/8 border-emerald-500/20'
          : 'bg-amber-500/8 border-amber-500/20',
      )}>
        {sistemaActivo
          ? <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
          : <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
        }
        <div className="flex-1">
          <p className={cn('text-sm font-medium', sistemaActivo ? 'text-emerald-400' : 'text-amber-400')}>
            {sistemaActivo ? 'Sistema de cortes automáticos activo' : 'Sistema de cortes pausado manualmente'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Próxima ejecución: hoy a las {horaCorte} · {clientesMorosos.length} clientes aptos para corte
          </p>
        </div>
        <button
          onClick={() => setSistemaActivo(a => !a)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0',
            sistemaActivo
              ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
              : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
          )}>
          {sistemaActivo ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {sistemaActivo ? 'Pausar' : 'Activar'}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Morosos actuales', value:clientesMorosos.length, color:'text-red-400' },
          { label:'Deuda total',       value:formatPEN(clientesMorosos.reduce((s, c) => s + c.deuda, 0)), color:'text-amber-400' },
          { label:'Con throttling',    value:mockClientes.filter(c => c.estado === 'suspendido').length, color:'text-orange-400' },
          { label:'Cortados hoy',      value:'23',  color:'text-muted-foreground' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Configuración + Tabla */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Config */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Configuración</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Días de gracia</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input type="number" value={diasGracia} onChange={(e) => setDiasGracia(e.target.value)} min="0" max="30"
                  className="w-20 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring" />
                <span className="text-xs text-muted-foreground">días después del vencimiento</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hora de ejecución</label>
              <input type="time" value={horaCorte} onChange={(e) => setHoraCorte(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex items-center justify-between py-2 border-t border-border">
              <div>
                <p className="text-sm font-medium text-foreground">Throttling por mora</p>
                <p className="text-xs text-muted-foreground mt-0.5">Reducir velocidad a 1Mbps en vez de corte total</p>
              </div>
              <button
                onClick={() => setThrottling(t => !t)}
                className={cn(
                  'w-10 h-5.5 rounded-full transition-colors relative',
                  throttling ? 'bg-primary' : 'bg-muted',
                )}>
                <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  throttling ? 'left-5.5 translate-x-0' : 'left-0.5',
                )} />
              </button>
            </div>
            <button className="w-full py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
              Guardar configuración
            </button>
          </div>
        </div>

        {/* Clientes aptos para corte */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Clientes aptos para corte</h3>
            <div className="flex gap-2">
              <button className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                Cortar todos
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Plan</th>
                  <th>Deuda</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {clientesMorosos.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-red-500/15 flex items-center justify-center text-xs font-bold text-red-400 flex-shrink-0">
                          {c.nombreCompleto[0]}
                        </div>
                        <span className="text-sm font-medium text-foreground">{c.nombreCompleto}</span>
                      </div>
                    </td>
                    <td className="text-xs text-muted-foreground">{c.plan}</td>
                    <td className="text-sm font-semibold text-red-400">{formatPEN(c.deuda)}</td>
                    <td>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                        {c.estado}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button className="text-xs text-amber-400 hover:underline">Throttle</button>
                        <button className="text-xs text-red-400 hover:underline">Cortar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Historial */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Historial de ejecuciones</h3>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Fecha / Hora</th>
              <th>Tipo</th>
              <th>Afectados</th>
              <th>Restaurados</th>
              <th>Pendientes</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {HISTORIAL_CORTES.map((h) => (
              <tr key={h.id}>
                <td className="font-mono text-xs text-muted-foreground">{h.fecha}</td>
                <td>
                  <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full',
                    h.tipo === 'automatico' ? 'bg-blue-500/10 text-blue-400' : 'bg-violet-500/10 text-violet-400'
                  )}>
                    {h.tipo}
                  </span>
                </td>
                <td className="text-sm font-semibold text-foreground">{h.afectados}</td>
                <td className="text-sm font-semibold text-emerald-400">{h.restaurados}</td>
                <td className="text-sm font-semibold text-amber-400">{h.pendientes}</td>
                <td><span className="pill-online">{h.estado}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
