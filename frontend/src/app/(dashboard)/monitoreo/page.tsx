import type { Metadata } from 'next';
import { MonitoreoContent } from '@/components/monitoreo/MonitoreoContent';
export const metadata: Metadata = { title: 'Monitoreo en tiempo real' };
export default function MonitoreoPage() { return <MonitoreoContent />; }
