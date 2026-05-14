import type { Metadata } from 'next';
import { ClientesContent } from '@/components/clientes/ClientesContent';

export const metadata: Metadata = { title: 'Clientes' };

export default function ClientesPage() {
  return <ClientesContent />;
}
