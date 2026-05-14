import type { Metadata } from 'next';
import { FacturacionContent } from '@/components/facturacion/FacturacionContent';
export const metadata: Metadata = { title: 'Facturación' };
export default function FacturacionPage() { return <FacturacionContent />; }
