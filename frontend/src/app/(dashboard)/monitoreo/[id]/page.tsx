import type { Metadata } from 'next';
import { NodoDetalle } from '@/components/monitoreo/NodoDetalle';
export const metadata: Metadata = { title: 'Detalle de Nodo' };
export default function NodoDetallePage({ params }: { params: { id: string } }) {
  return <NodoDetalle id={params.id} />;
}
