import type { Metadata } from 'next';
import { ProyectosContent } from '@/components/finanzas/ProyectosContent';

export const metadata: Metadata = { title: 'Proyectos de Expansión' };

export default function ProyectosPage() {
  return <ProyectosContent />;
}
