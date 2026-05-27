import type { Metadata } from 'next';
import { TicketsContent } from '@/components/tickets/TicketsContent';
export const metadata: Metadata = { title: 'Tickets en Progreso — DataFast' };
export default function TicketsContestadosPage() {
  return <TicketsContent defaultEstado="en_progreso" title="Tickets en Progreso" />;
}
