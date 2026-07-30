import type { Metadata } from 'next';
import { PortalSoporte } from '@/components/portal/PortalSoporte';

export const metadata: Metadata = { title: 'Soporte — Portal del Cliente' };

export default function SoportePage() {
  return <PortalSoporte />;
}
