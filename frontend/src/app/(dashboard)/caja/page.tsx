'use client';

import { HardDrive, TrendingUp, TrendingDown, DollarSign, Plus, Printer } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn, formatPEN } from '@/lib/utils';
import { mockMovimientosCaja } from '@/mock-data';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

export default function CajaPage() {
  const ingresos = mockMovimientosCaja.filter(m => m.tipo === 'ingreso');
  const egresos  = mockMovimientosCaja.filter(m => m.tipo === 'egreso');
  const totalIn  = ingresos.reduce((s, m) => s + m.monto, 0);
  const totalOut = egresos.reduce((s, m) => s + m.monto, 0);
  const saldo    = totalIn - totalOut;

  // Agrupar por categoría
  const porCategoria = Object.entries(
    ingresos.reduce((acc: Record<string, number>, m) => {
      acc[m.categoria] = (acc[m.categoria] ?? 0) + m.monto;
      return acc;
    }, {})
  ).map(([cat, monto]) => ({ cat, monto }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Caja del Día"
        description={`Movimientos de ${new Date().toLocaleDateString('es-PE', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}`}
        breadcrumbs={[{ label:'Finanzas' }, { label:'Caja del Día' }]}
        badge={{ label: saldo >= 0 ? 'Positivo' : 'Negativo', color: saldo >= 0 ? 'green' : 'red' }}
        actions={
          <div className="flex gap-2">
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Printer className="w-3.5 h-3.5" />
              Imprimir cierre
            </button>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Nuevo movimiento
            </button>
          </div>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 border-l-4 border-l-emerald-500">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Total ingresos</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1.5">{formatPEN(totalIn)}</p>
              <p className="text-xs text-muted-foreground mt-1">{ingresos.length} movimientos</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 border-l-4 border-l-red-500">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Total egresos</p>
              <p className="text-2xl font-bold text-red-400 mt-1.5">{formatPEN(totalOut)}</p>
              <p className="text-xs text-muted-foreground mt-1">{egresos.length} movimientos</p>
            </div>
            <div className="p-2.5 rounded-xl bg-red-500/10">
              <TrendingDown className="w-5 h-5 text-red-400" />
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 border-l-4 border-l-blue-500">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Saldo del día</p>
              <p className={cn('text-2xl font-bold mt-1.5', saldo >= 0 ? 'text-blue-400' : 'text-red-400')}>{formatPEN(saldo)}</p>
              <p className="text-xs text-muted-foreground mt-1">Caja abierta</p>
            </div>
            <div className="p-2.5 rounded-xl bg-blue-500/10">
              <DollarSign className="w-5 h-5 text-blue-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Gráfico ingresos por categoría + Movimientos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Ingresos por categoría</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={porCategoria} margin={{ top:0, right:0, left:-20, bottom:0 }}>
              <XAxis dataKey="cat" tick={{ fontSize:10, fill:'hsl(var(--muted-foreground))' }} stroke="transparent" />
              <YAxis tick={{ fontSize:10, fill:'hsl(var(--muted-foreground))' }} stroke="transparent" />
              <Tooltip
                contentStyle={{ background:'hsl(var(--card))', border:'1px solid hsl(var(--border))', borderRadius:'8px', fontSize:'12px' }}
                formatter={(v: number) => [formatPEN(v)]}
              />
              <Bar dataKey="monto" radius={[4,4,0,0]}>
                {porCategoria.map((_, i) => (
                  <Cell key={i} fill={['#60a5fa','#34d399','#a78bfa','#fbbf24'][i % 4]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Movimientos del día</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Descripción</th>
                  <th>Categoría</th>
                  <th>Método</th>
                  <th>Operador</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {mockMovimientosCaja.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs text-muted-foreground">{m.hora}</td>
                    <td className="text-xs text-foreground max-w-[200px] truncate">{m.descripcion}</td>
                    <td className="text-xs text-muted-foreground">{m.categoria}</td>
                    <td className="text-xs text-muted-foreground">{m.metodo}</td>
                    <td className="text-xs text-muted-foreground">{m.operador}</td>
                    <td className={cn('text-sm font-semibold', m.tipo === 'ingreso' ? 'text-emerald-400' : 'text-red-400')}>
                      {m.tipo === 'ingreso' ? '+' : '-'}{formatPEN(m.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center px-5 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            <span>{mockMovimientosCaja.length} movimientos registrados</span>
            <span className="font-semibold text-foreground">Saldo: {formatPEN(saldo)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
