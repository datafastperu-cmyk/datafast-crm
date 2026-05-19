import type { Metadata } from 'next';
import { History } from 'lucide-react';

export const metadata: Metadata = { title: 'Historial — Datafast CRM' };

export default function HistorialMensajeriaPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <History className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Historial</h1>
      </div>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <History className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Próximamente</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Registro completo de todos los mensajes enviados a los abonados.
        </p>
      </div>
    </div>
  );
}
