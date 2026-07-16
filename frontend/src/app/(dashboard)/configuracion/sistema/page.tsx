import type { Metadata } from 'next';
import { VersionSistemaCard } from '@/components/configuracion/VersionSistemaCard';
import { EventosSistemaTab }  from '@/components/configuracion/EventosSistemaTab';

export const metadata: Metadata = { title: 'Sistema — Ajustes' };

export default function SistemaPage() {
  return (
    <div className="p-6 max-w-5xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Sistema</h2>
        <p className="text-sm text-muted-foreground">
          Versión del ERP Datafast, actualizaciones y registro de eventos de producción.
          Los recursos de la VPS se gestionan en Ajustes → Servidor.
        </p>
      </div>

      <VersionSistemaCard />

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Registro de Eventos</h3>
        <div className="bg-card border border-border rounded-xl p-6">
          <EventosSistemaTab />
        </div>
      </div>
    </div>
  );
}
