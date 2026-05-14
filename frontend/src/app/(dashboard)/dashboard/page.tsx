import type { Metadata } from 'next';
import { DashboardContent } from '@/components/dashboard/DashboardContent';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return <DashboardContent />;
}
