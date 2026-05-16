import type { Metadata } from 'next';
import { RedesIpv4Tab } from '@/components/red/RedesIpv4Tab';
export const metadata: Metadata = { title: 'Redes IPv4' };
export default function RedesIpv4Page() {
  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Redes IPv4</h2>
        <p className="text-sm text-muted-foreground">Gestiona los segmentos de red y el pool de IPs disponibles.</p>
      </div>
      <RedesIpv4Tab />
    </div>
  );
}
