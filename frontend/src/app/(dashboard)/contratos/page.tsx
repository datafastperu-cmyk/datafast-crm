import type { Metadata } from 'next';
import { ContratosContent } from '@/components/contratos/ContratosContent';
export const metadata: Metadata = { title: 'Contratos' };
export default function ContratosPage() { return <ContratosContent />; }
