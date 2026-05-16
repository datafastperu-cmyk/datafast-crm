'use client';

import { useState } from 'react';
import { UserCheck, Plus, Phone, MapPin, Briefcase, Star } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn }         from '@/lib/utils';
import { mockTecnicos } from '@/mock-data';

const ESTADO_STYLE = {
  disponible: { label:'Disponible',  class:'pill-online' },
  en_trabajo: { label:'En trabajo',  class:'pill-warning' },
  descanso:   { label:'Descanso',    class:'pill-info' },
  inactivo:   { label:'Inactivo',    class:'pill-offline' },
};

const ESTADO_COLORS = {
  disponible: 'border-l-emerald-500',
  en_trabajo: 'border-l-amber-500',
  descanso:   'border-l-blue-500',
  inactivo:   'border-l-red-500',
};

export default function TecnicosPage() {
  const [vista, setVista] = useState<'tarjetas' | 'tabla'>('tarjetas');

  const stats = {
    total:       mockTecnicos.length,
    disponibles: mockTecnicos.filter(t => t.estado === 'disponible').length,
    enTrabajo:   mockTecnicos.filter(t => t.estado === 'en_trabajo').length,
    trabajosHoy: mockTecnicos.reduce((s, t) => s + t.trabajosHoy, 0),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Técnicos de Campo"
        description="Gestión del personal técnico y asignación de trabajos"
        breadcrumbs={[{ label:'Clientes' }, { label:'Técnicos' }]}
        badge={{ label:`${stats.total} técnicos`, color:'blue' }}
        actions={
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="w-3.5 h-3.5" />
            Nuevo técnico
          </button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Total técnicos',    value:stats.total,       color:'text-foreground' },
          { label:'Disponibles',       value:stats.disponibles, color:'text-emerald-400' },
          { label:'En trabajo',        value:stats.enTrabajo,   color:'text-amber-400' },
          { label:'Trabajos hoy',      value:stats.trabajosHoy, color:'text-blue-400' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toggle vista */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-0.5 w-fit">
        {(['tarjetas','tabla'] as const).map((v) => (
          <button key={v} onClick={() => setVista(v)}
            className={cn('text-xs px-3 py-1.5 rounded-md capitalize transition-colors',
              vista === v ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}>{v}</button>
        ))}
      </div>

      {vista === 'tarjetas' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockTecnicos.map((t) => {
            const es = ESTADO_STYLE[t.estado];
            return (
              <div key={t.id}
                   className={cn('bg-card border border-border rounded-xl p-5 border-l-4 hover:shadow-card-hover transition-all duration-200 cursor-pointer group', ESTADO_COLORS[t.estado])}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-sm font-bold text-primary">
                      {t.nombre.split(' ').map(n => n[0]).join('').slice(0,2)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{t.nombre}</p>
                      <p className="text-xs text-muted-foreground">{t.especialidad}</p>
                    </div>
                  </div>
                  <span className={es.class}>{es.label}</span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{t.telefono}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{t.zona}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/60">
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{t.trabajosHoy}</p>
                    <p className="text-[10px] text-muted-foreground">hoy</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{t.trabajosMes}</p>
                    <p className="text-[10px] text-muted-foreground">este mes</p>
                  </div>
                  <button className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                    Ver agenda
                  </button>
                </div>
              </div>
            );
          })}

          {/* Nuevo técnico card */}
          <div className="bg-card border border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center gap-3 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 cursor-pointer group min-h-[200px]">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <p className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">Agregar técnico</p>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Técnico</th>
                <th>Especialidad</th>
                <th>Zona</th>
                <th>Teléfono</th>
                <th>Hoy</th>
                <th>Este mes</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mockTecnicos.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                        {t.nombre.split(' ').map(n => n[0]).join('').slice(0,2)}
                      </div>
                      <span className="text-sm font-medium text-foreground">{t.nombre}</span>
                    </div>
                  </td>
                  <td className="text-xs text-muted-foreground">{t.especialidad}</td>
                  <td className="text-xs text-muted-foreground">{t.zona}</td>
                  <td className="text-xs font-mono text-muted-foreground">{t.telefono}</td>
                  <td className="text-sm font-semibold text-foreground">{t.trabajosHoy}</td>
                  <td className="text-sm font-semibold text-foreground">{t.trabajosMes}</td>
                  <td><span className={ESTADO_STYLE[t.estado].class}>{ESTADO_STYLE[t.estado].label}</span></td>
                  <td>
                    <button className="text-xs text-primary hover:underline">Agenda</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
