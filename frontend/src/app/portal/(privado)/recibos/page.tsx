import type { Metadata } from 'next';
import { PortalFacturacion } from '@/components/portal/PortalFacturacion';

export const metadata: Metadata = { title: 'Recibos — Portal del Cliente' };

export default function RecibosPage() {
  return <PortalFacturacion />;
}
