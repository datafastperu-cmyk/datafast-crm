import type { Metadata } from 'next';
import { PortalWifi } from '@/components/portal/PortalWifi';

export const metadata: Metadata = { title: 'Mi WiFi — Portal del Cliente' };

export default function WifiPage() {
  return <PortalWifi />;
}
