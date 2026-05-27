import type { Metadata } from 'next';
import { TicketsContent } from '@/components/tickets/TicketsContent';
export const metadata: Metadata = { title: 'Tickets Cerrados — DataFast' };
export default function TicketsCerradosPage() {
  return <TicketsContent defaultEstado="cerrado" title="Tickets Cerrados" />;
}
