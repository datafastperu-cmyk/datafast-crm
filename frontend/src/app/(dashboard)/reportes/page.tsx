import type { Metadata } from 'next';
import { ReportesContent } from '@/components/reportes/ReportesContent';
export const metadata: Metadata = { title: 'Reportes' };
export default function ReportesPage() { return <ReportesContent />; }
