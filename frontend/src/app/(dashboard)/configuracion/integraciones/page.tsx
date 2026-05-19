import type { Metadata } from 'next';
import { Plug } from 'lucide-react';

export const metadata: Metadata = { title: 'Integraciones — Datafast CRM' };

export default function IntegracionesPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Plug className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Integraciones</h1>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Plug className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Próximamente</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Aquí podrás conectar servicios externos: pasarelas de pago, WhatsApp, SMS, TR-069 ACS, y más.
        </p>
      </div>
    </div>
  );
}
