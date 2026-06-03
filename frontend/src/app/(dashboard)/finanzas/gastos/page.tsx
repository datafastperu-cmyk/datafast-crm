import type { Metadata } from 'next';
import { GastosContent } from '@/components/finanzas/GastosContent';

export const metadata: Metadata = { title: 'Gastos / Ingresos' };

export default function GastosPage() {
  return <GastosContent />;
}
