import type { Metadata } from 'next';
import { Megaphone } from 'lucide-react';

export const metadata: Metadata = { title: 'Campañas — Datafast CRM' };

export default function CampanasPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Megaphone className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Campañas</h1>
      </div>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Megaphone className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Próximamente</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Crea y gestiona campañas masivas de SMS, WhatsApp y correo electrónico.
        </p>
      </div>
    </div>
  );
}
