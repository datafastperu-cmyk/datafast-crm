import type { Metadata } from 'next';
import { TicketsContent } from '@/components/tickets/TicketsContent';
export const metadata: Metadata = { title: 'Tickets Nuevos — DataFast' };
export default function TicketsNuevosPage() {
  return <TicketsContent defaultEstado="abierto" title="Tickets Nuevos" />;
}
