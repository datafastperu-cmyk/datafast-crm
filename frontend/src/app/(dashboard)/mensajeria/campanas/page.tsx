'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Users, Send, FileText, History, ChevronDown,
  Smile, Paperclip, MessageCircle, Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const FILTROS = ['Activos', 'Suspendidos', 'Todos'] as const;
type Filtro = typeof FILTROS[number];

const VARIABLES = ['Nombre', 'DNI', 'Teléfono', 'Plan', 'Empresa', 'Dirección', 'IP'];

const FILTRO_STYLE: Record<Filtro, string> = {
  Activos:     'border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
  Suspendidos: 'border-red-400 text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400',
  Todos:       'border-violet-400 text-violet-600 bg-violet-50 dark:bg-violet-900/20 dark:text-violet-400',
};

const SELECT_CLS = 'flex-1 px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer';

export default function CampanasPage() {
  const [filtro,    setFiltro]    = useState<Filtro>('Activos');
  const [mensaje,   setMensaje]   = useState('');
  const [plantilla, setPlantilla] = useState('');
  const [fileName,  setFileName]  = useState('Ningún archivo seleccionado');

  const insertarVariable = (v: string) => {
    setMensaje(prev => prev + `{${v}}`);
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-[#25D366]" />
            <h1 className="text-lg font-bold text-foreground">Marketing WhatsApp</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Gestión avanzada de campañas y mensajes masivos</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/mensajeria/plantillas" className="flex items-center gap-1.5 text-primary hover:underline font-medium">
            <FileText className="w-4 h-4" /> Plantillas
          </Link>
          <Link href="/mensajeria/historial" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground font-medium">
            <History className="w-4 h-4" /> Historial
          </Link>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden gap-0">

        {/* ── Panel izquierdo: Destinatarios ─────────────── */}
        <div className="flex flex-col flex-1 border-r border-border overflow-hidden">

          {/* Header panel */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <span className="font-semibold text-foreground">Destinatarios</span>
            </div>
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-muted text-muted-foreground border border-border">
              0 seleccionados
            </span>
          </div>

          <div className="px-5 py-4 space-y-4 border-b border-border">
            {/* Selección rápida */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Selección Rápida
              </p>
              <div className="flex gap-2 flex-wrap">
                {FILTROS.map(f => (
                  <button
                    key={f}
                    onClick={() => setFiltro(f)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors',
                      filtro === f
                        ? FILTRO_STYLE[f]
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {f === 'Activos'     && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
                    {f === 'Suspendidos' && <span className="w-2 h-2 rounded-full bg-red-400" />}
                    {f === 'Todos'       && <Users className="w-3 h-3" />}
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtros */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Router', placeholder: 'Todos los Routers' },
                { label: 'Plan',   placeholder: 'Todos los Planes'  },
                { label: 'Zona',   placeholder: 'Todas las Zonas'   },
              ].map(({ label, placeholder }) => (
                <div key={label}>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{label}</label>
                  <div className="relative">
                    <select className={SELECT_CLS}>
                      <option>{placeholder}</option>
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50 border-b border-border">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" className="rounded" />
                  </th>
                  {['CLIENTE', 'CONTACTO', 'SERVICIO', 'ESTADO'].map(col => (
                    <th key={col} className="px-4 py-3 text-left font-semibold text-muted-foreground tracking-wider">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-muted-foreground text-sm">
                    Selecciona un filtro para cargar destinatarios
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Panel derecho: Nuevo Mensaje ────────────────── */}
        <div className="w-[380px] flex-shrink-0 flex flex-col">

          {/* Header panel */}
          <div className="flex items-center gap-2 px-5 py-4 bg-[#1a3a8f]">
            <Send className="w-4 h-4 text-white" />
            <span className="font-bold text-white text-sm">Nuevo Mensaje</span>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            {/* Cargar plantilla */}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Cargar Plantilla
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <select
                    className={cn(SELECT_CLS, 'text-muted-foreground')}
                    value={plantilla}
                    onChange={e => setPlantilla(e.target.value)}
                  >
                    <option value="">Seleccionar una plantilla...</option>
                    <option value="bienvenida">Bienvenida</option>
                    <option value="corte">Aviso de corte</option>
                    <option value="pago">Recordatorio de pago</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
                <button className="px-3 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">
                  <Upload className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Contenido */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Contenido
                </label>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {mensaje.length} CARACTERES
                </span>
              </div>
              <div className="relative">
                <textarea
                  rows={9}
                  value={mensaje}
                  onChange={e => setMensaje(e.target.value)}
                  placeholder="Escribe tu mensaje aquí..."
                  className="w-full px-3 py-2.5 text-sm border border-input rounded-lg bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button className="absolute bottom-2.5 right-2.5 text-yellow-400 hover:text-yellow-500 transition-colors">
                  <Smile className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Variables dinámicas */}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Variables Dinámicas
              </label>
              <div className="flex flex-wrap gap-1.5">
                {VARIABLES.map(v => (
                  <button
                    key={v}
                    onClick={() => insertarVariable(v)}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full border border-border text-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                  >
                    {v === 'Nombre'   && <Users className="w-3 h-3" />}
                    {v === 'DNI'      && <span className="text-[10px] font-bold">ID</span>}
                    {v === 'Teléfono' && <span className="text-[10px]">📞</span>}
                    {v === 'Plan'     && <span className="text-[10px]">📶</span>}
                    {v === 'Empresa'  && <span className="text-[10px]">🏢</span>}
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Adjuntar archivo */}
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Adjuntar Archivo
              </label>
              <div className="flex items-center gap-2 px-3 py-2 border border-input rounded-lg bg-background">
                <label className="text-xs font-semibold text-foreground cursor-pointer hover:text-primary transition-colors whitespace-nowrap">
                  Seleccionar archivo
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    className="hidden"
                    onChange={e => setFileName(e.target.files?.[0]?.name ?? 'Ningún archivo seleccionado')}
                  />
                </label>
                <span className="flex-1 text-xs text-muted-foreground truncate">{fileName}</span>
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Imágenes (JPG, PNG) y Documentos PDF.
              </p>
            </div>
          </div>

          {/* Botón enviar */}
          <div className="px-5 py-4 border-t border-border">
            <button className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                               bg-[#25D366] hover:bg-[#1ebe5d] text-white font-bold text-sm transition-colors shadow-sm">
              <MessageCircle className="w-4 h-4" />
              Enviar Campaña Masiva
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
