import type { Metadata } from 'next';
import { OltContent } from '@/components/red/OltContent';

export const metadata: Metadata = { title: 'OLT — DataFast' };

export default function OltPage() {
  return <OltContent />;
}
