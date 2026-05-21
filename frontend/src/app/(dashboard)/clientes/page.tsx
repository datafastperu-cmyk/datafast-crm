import type { Metadata } from 'next';
import { ClientesContent } from '@/components/clientes/ClientesContent';

export const metadata: Metadata = { title: 'Abonados' };

export default function ClientesPage() {
  return <ClientesContent />;
}
