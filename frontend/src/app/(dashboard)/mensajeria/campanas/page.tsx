import Link from 'next/link';
import {
  Megaphone, ChevronLeft, Users, ChevronDown, Send,
  Clock, CheckCircle2, XCircle, Construction,
} from 'lucide-react';

// Página estática — sin queries, mutations ni llamadas a API.
// Toda la lógica operativa está en git (branch main) lista para activarse.

export default function CampanasPage() {
  return (
    <div className="p-6 max-w-3xl space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link
          href="/mensajeria"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />Mensajería
        </Link>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs text-foreground font-medium">Campañas Masivas</span>
      </div>

      {/* Banner de próximamente */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400">
        <Construction className="w-4 h-4 flex-shrink-0" />
        <p className="text-xs font-medium">Módulo en preparación — disponible próximamente</p>
      </div>

      {/* Lanzador (maqueta visual, sin interacción) */}
      <div className="border border-border rounded-xl overflow-hidden opacity-60 pointer-events-none select-none">
        {/* Header azul */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-[#1a3a8f]/80">
          <Megaphone className="w-4 h-4 text-white" />
          <span className="text-sm font-bold text-white">Lanzador de Campañas Masivas</span>
        </div>

        <div className="p-5 space-y-4">
          {/* Cuota + Monitor (valores vacíos) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Cuota Hoy</span>
                <span className="text-xs font-bold text-muted-foreground">— / —</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full w-0 rounded-full bg-emerald-500" />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-muted-foreground">0% usado</span>
                <span className="text-[10px] text-muted-foreground">— restantes</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Monitor — Hoy</span>
              </div>
              <div className="flex gap-3 mb-2">
                {[
                  { label: 'Encolados', icon: Clock },
                  { label: 'Enviados',  icon: CheckCircle2 },
                  { label: 'Fallidos',  icon: XCircle },
                ].map(({ label, icon: Icon }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground">—</span>
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
              <div className="w-full py-1.5 rounded-lg border border-border text-center text-xs text-muted-foreground">
                Pausar campaña activa
              </div>
            </div>
          </div>

          {/* Segmentación */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Segmentación de destinatarios
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {['Sector / Zona', 'Router / MikroTik'].map((label) => (
                <div key={label}>
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    <Users className="w-3 h-3 inline mr-1" />{label}
                  </label>
                  <div className="relative">
                    <div className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-muted-foreground">
                      Todos
                    </div>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Plantilla */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Plantilla de mensaje
            </label>
            <div className="relative">
              <div className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-muted-foreground">
                Seleccionar plantilla...
              </div>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* Botón lanzar */}
          <div className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#25D366]/50 text-white font-bold text-sm cursor-not-allowed">
            <Send className="w-4 h-4" />
            Iniciar Campaña Masiva
          </div>
        </div>
      </div>
    </div>
  );
}
