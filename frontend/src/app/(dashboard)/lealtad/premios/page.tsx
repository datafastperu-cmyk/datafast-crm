import type { Metadata } from 'next';
import { Trophy } from 'lucide-react';

export const metadata: Metadata = { title: 'Premios — Datafast CRM' };

export default function PremiosPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Trophy className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Premios</h1>
      </div>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Trophy className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold text-foreground">Próximamente</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Gestión de premios y recompensas para el programa de lealtad.
        </p>
      </div>
    </div>
  );
}
