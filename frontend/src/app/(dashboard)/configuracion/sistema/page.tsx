import type { Metadata } from 'next';
import { EventosSistemaTab } from '@/components/configuracion/EventosSistemaTab';

export const metadata: Metadata = { title: 'Centro de Operaciones — Ajustes' };

export default function SistemaPage() {
  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Centro de Operaciones</h2>
        <p className="text-sm text-muted-foreground">
          Registro de eventos y errores de producción. El estado del servidor y las
          actualizaciones se gestionan en Ajustes → Servidor.
        </p>
      </div>
      <div className="bg-card border border-border rounded-xl p-6">
        <EventosSistemaTab />
      </div>
    </div>
  );
}
