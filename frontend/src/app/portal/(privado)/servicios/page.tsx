import type { Metadata } from 'next';
import { PortalMisServicios } from '@/components/portal/PortalMisServicios';

export const metadata: Metadata = { title: 'Mis servicios — Portal del Cliente' };

export default function MisServiciosPage() {
  return <PortalMisServicios />;
}
