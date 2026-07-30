import type { Metadata } from 'next';
import { PortalPlanes } from '@/components/portal/PortalPlanes';

export const metadata: Metadata = { title: 'Planes — Portal del Cliente' };

export default function PlanesPage() {
  return <PortalPlanes />;
}
