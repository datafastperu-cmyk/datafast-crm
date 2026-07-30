import type { Metadata } from 'next';
import { PortalDispositivos } from '@/components/portal/PortalDispositivos';

export const metadata: Metadata = { title: 'Dispositivos — Portal del Cliente' };

export default function DispositivosPage() {
  return <PortalDispositivos />;
}
