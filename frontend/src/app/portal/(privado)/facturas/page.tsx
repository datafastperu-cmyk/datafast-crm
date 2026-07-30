import type { Metadata } from 'next';
import { PortalFacturacion } from '@/components/portal/PortalFacturacion';

export const metadata: Metadata = { title: 'Facturas — Portal del Cliente' };

export default function FacturasPage() {
  return <PortalFacturacion />;
}
