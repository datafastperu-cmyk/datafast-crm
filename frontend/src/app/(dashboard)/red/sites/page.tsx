import type { Metadata } from 'next';
import { SitesContent } from '@/components/red/SitesContent';

export const metadata: Metadata = { title: 'Sites — Gestión de Red' };
export default function SitesPage() { return <SitesContent />; }
