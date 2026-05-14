import type { Metadata } from 'next';
import { ClienteDetalle } from '@/components/clientes/ClienteDetalle';

export const metadata: Metadata = { title: 'Detalle de Cliente' };

export default function ClienteDetallePage({
  params,
}: {
  params: { id: string };
}) {
  return <ClienteDetalle id={params.id} />;
}
