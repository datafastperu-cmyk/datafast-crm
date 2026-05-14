import type { Metadata } from 'next';
import { AlertasHistorial } from '@/components/monitoreo/AlertasHistorial';
export const metadata: Metadata = { title: 'Alertas' };
export default function AlertasPage() { return <AlertasHistorial />; }
