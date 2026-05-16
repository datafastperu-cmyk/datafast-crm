'use client';

import { useState }   from 'react';
import { MessageSquare, Send, CheckCheck, Clock, AlertCircle, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn }         from '@/lib/utils';
import { mockMensajesWhatsapp } from '@/mock-data';

const ESTADO_STYLE = {
  leido:     { icon: CheckCheck, class: 'text-blue-400',    label: 'Leído' },
  entregado: { icon: CheckCheck, class: 'text-muted-foreground', label: 'Entregado' },
  pendiente: { icon: Clock,      class: 'text-amber-400',   label: 'Pendiente' },
  error:     { icon: AlertCircle,class: 'text-red-400',     label: 'Error' },
};

const TIPO_BADGE: Record<string, string> = {
  factura:      'bg-blue-500/10 text-blue-400',
  corte:        'bg-red-500/10 text-red-400',
  recordatorio: 'bg-amber-500/10 text-amber-400',
  bienvenida:   'bg-emerald-500/10 text-emerald-400',
};

const PLANTILLAS = [
  { id:'p1', nombre:'Recordatorio de pago',  tipo:'recordatorio', variables:['nombre','monto','fecha'], activa:true },
  { id:'p2', nombre:'Aviso de corte',         tipo:'corte',        variables:['nombre','deuda'],          activa:true },
  { id:'p3', nombre:'Pago confirmado',        tipo:'factura',      variables:['nombre','monto'],          activa:true },
  { id:'p4', nombre:'Bienvenida nuevo cliente',tipo:'bienvenida',  variables:['nombre','plan'],           activa:true },
];

export default function WhatsAppPage() {
  const [tab, setTab] = useState<'mensajes' | 'plantillas' | 'config'>('mensajes');

  const stats = {
    enviados:  mockMensajesWhatsapp.length,
    leidos:    mockMensajesWhatsapp.filter(m => m.estado === 'leido').length,
    errores:   mockMensajesWhatsapp.filter(m => m.estado === 'error').length,
    entregados:mockMensajesWhatsapp.filter(m => m.estado === 'entregado').length,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="WhatsApp Bot"
        description="Automatización de mensajes y notificaciones a clientes"
        breadcrumbs={[{ label:'Mensajería' }, { label:'WhatsApp' }]}
        badge={{ label:'API conectada', color:'green' }}
        actions={
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
            <Send className="w-3.5 h-3.5" />
            Envío masivo
          </button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Enviados hoy',   value:stats.enviados,   color:'text-foreground' },
          { label:'Leídos',         value:stats.leidos,     color:'text-blue-400' },
          { label:'Entregados',     value:stats.entregados, color:'text-emerald-400' },
          { label:'Con error',      value:stats.errores,    color:'text-red-400' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-0.5 w-fit">
        {(['mensajes','plantillas','config'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('text-sm px-4 py-1.5 rounded-md capitalize transition-colors',
              tab === t ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}>{t}</button>
        ))}
      </div>

      {tab === 'mensajes' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contacto</th>
                <th>Teléfono</th>
                <th>Tipo</th>
                <th>Mensaje</th>
                <th>Enviado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {mockMensajesWhatsapp.map((m) => {
                const es = ESTADO_STYLE[m.estado];
                return (
                  <tr key={m.id}>
                    <td className="font-medium text-foreground">{m.nombre}</td>
                    <td className="font-mono text-xs text-muted-foreground">+51 {m.telefono}</td>
                    <td>
                      <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full capitalize', TIPO_BADGE[m.tipo])}>
                        {m.tipo}
                      </span>
                    </td>
                    <td className="max-w-[260px]">
                      <p className="text-xs text-muted-foreground line-clamp-2">{m.mensaje}</p>
                    </td>
                    <td className="text-xs text-muted-foreground font-mono">
                      {new Date(m.enviado).toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' })}
                    </td>
                    <td>
                      <span className={cn('flex items-center gap-1 text-[11px] font-medium', es.class)}>
                        <es.icon className="w-3.5 h-3.5" />
                        {es.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'plantillas' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PLANTILLAS.map((p) => (
            <div key={p.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{p.nombre}</p>
                  <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full capitalize mt-1 inline-block', TIPO_BADGE[p.tipo])}>
                    {p.tipo}
                  </span>
                </div>
                <span className={p.activa ? 'pill-online' : 'pill-offline'}>
                  {p.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">Variables: {p.variables.map(v => `{{${v}}}`).join(', ')}</p>
              <div className="flex gap-2">
                <button className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium">
                  Editar plantilla
                </button>
                <button className="text-xs px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  Probar
                </button>
              </div>
            </div>
          ))}
          <div className="bg-card border border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center gap-2 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group">
            <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
            <p className="text-sm text-muted-foreground group-hover:text-primary transition-colors">Nueva plantilla</p>
          </div>
        </div>
      )}

      {tab === 'config' && (
        <div className="max-w-xl bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Configuración de la API</h3>
          {[
            { label:'Proveedor',         value:'Waboxapp',       type:'select', options:['Waboxapp','WATI','UltraMsg','Meta Cloud API'] },
            { label:'API Key',           value:'wab_••••••••••••', type:'password' },
            { label:'Número de envío',   value:'+51 999 000 111', type:'text' },
            { label:'Delay entre envíos',value:'1500',           type:'number', suffix:'ms' },
          ].map((f) => (
            <div key={f.label}>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{f.label}</label>
              <div className="mt-1.5 flex gap-2">
                {f.type === 'select' ? (
                  <select className="flex-1 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                    {f.options?.map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type} defaultValue={f.value}
                    className="flex-1 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                )}
                {f.suffix && <span className="flex items-center text-xs text-muted-foreground px-2">{f.suffix}</span>}
              </div>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
              Guardar configuración
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-sm text-muted-foreground hover:text-foreground transition-colors">
              Probar conexión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
