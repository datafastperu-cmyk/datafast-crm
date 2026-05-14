import type { Metadata } from 'next';
import { AprovisionarFtth } from '@/components/contratos/AprovisionarFtth';
export const metadata: Metadata = { title: 'Aprovisionamiento FTTH' };
export default function AprovisionarPage({ params }: { params: { id: string } }) {
  return <AprovisionarFtth contratoId={params.id} />;
}
