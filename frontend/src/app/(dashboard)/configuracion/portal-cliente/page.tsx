import type { Metadata } from 'next';
import { PortalClienteTab } from '@/components/configuracion/PortalClienteTab';

export const metadata: Metadata = { title: 'Portal Cliente — Ajustes' };

export default function Page() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Portal Cliente</h2>
        <p className="text-sm text-muted-foreground">
          Qué ve el abonado cuando entra a su portal: secciones habilitadas, medios de pago,
          banners y marca.
        </p>
      </div>
      <PortalClienteTab />
    </div>
  );
}
