import type { Metadata } from 'next';
import { PortalConsumo } from '@/components/portal/PortalConsumo';

export const metadata: Metadata = { title: 'Consumo — Portal del Cliente' };

export default function ConsumoPage() {
  return <PortalConsumo />;
}
