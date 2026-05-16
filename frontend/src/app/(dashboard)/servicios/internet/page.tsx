import type { Metadata } from 'next';
import { PlanesTab }    from '@/components/configuracion/PlanesTab';

export const metadata: Metadata = { title: 'Planes de Internet' };

export default function PlanesInternetPage() {
  return (
    <div className="space-y-5 max-w-4xl p-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Planes de Internet</h2>
        <p className="text-sm text-muted-foreground">Gestiona los planes de servicio disponibles.</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-6">
        <PlanesTab />
      </div>
    </div>
  );
}
