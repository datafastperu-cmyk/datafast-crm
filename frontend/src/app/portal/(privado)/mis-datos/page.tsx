import type { Metadata } from 'next';
import { PortalMisDatos } from '@/components/portal/PortalMisDatos';

export const metadata: Metadata = { title: 'Mis datos — Portal del Cliente' };

export default function MisDatosPage() {
  return <PortalMisDatos />;
}
