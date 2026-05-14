import type { Metadata } from 'next';
import { PagosPendientes } from '@/components/pagos/PagosPendientes';
export const metadata: Metadata = { title: 'Pagos Pendientes' };
export default function PagosPendientesPage() { return <PagosPendientes />; }
