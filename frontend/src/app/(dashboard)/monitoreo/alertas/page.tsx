import type { Metadata } from 'next';
import { AlertasSistemaContent } from '@/components/monitoreo/AlertasSistemaContent';
export const metadata: Metadata = { title: 'Alertas del Sistema' };
export default function AlertasPage() { return <AlertasSistemaContent />; }
