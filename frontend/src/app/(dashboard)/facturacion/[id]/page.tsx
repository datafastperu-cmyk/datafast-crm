import type { Metadata } from 'next';
import { FacturaDetalle } from '@/components/facturacion/FacturaDetalle';
export const metadata: Metadata = { title: 'Factura' };
export default function FacturaPage({ params }: { params: { id: string } }) {
  return <FacturaDetalle id={params.id} />;
}
