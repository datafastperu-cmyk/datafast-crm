import type { Metadata } from 'next';
import { DriftContent } from '@/components/red/DriftContent';
export const metadata: Metadata = { title: 'Panel de Drift — Gestión de Red' };
export default function DriftPage() { return <DriftContent />; }
