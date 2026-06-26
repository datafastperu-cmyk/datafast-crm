import type { Metadata } from 'next';
import { PagosContent } from '@/components/pagos/PagosContent';
export const metadata: Metadata = { title: 'Pagos' };
export default function PagosPage() { return <PagosContent />; }
