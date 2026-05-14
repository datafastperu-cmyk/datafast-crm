import type { Metadata } from 'next';
import { ContratoDetalle } from '@/components/contratos/ContratoDetalle';
export const metadata: Metadata = { title: 'Detalle de Contrato' };
export default function ContratoDetallePage({ params }: { params: { id: string } }) {
  return <ContratoDetalle id={params.id} />;
}
