import type { Metadata } from 'next';
import { TiempoRealContent } from '@/components/monitoreo/TiempoRealContent';
export const metadata: Metadata = { title: 'Tiempo Real — Monitoreo' };
export default function MonitoreoPage() { return <TiempoRealContent />; }
