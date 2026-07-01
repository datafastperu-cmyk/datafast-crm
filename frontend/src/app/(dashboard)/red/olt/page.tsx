import type { Metadata } from 'next';
import { RedOltContent } from '@/components/red/RedOltContent';

export const metadata: Metadata = { title: 'OLT — DataFast' };

export default function OltPage() {
  return <RedOltContent />;
}
