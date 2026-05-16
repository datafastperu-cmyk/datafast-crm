import type { Metadata } from 'next';
import { VpnContent } from '@/components/red/VpnContent';
export const metadata: Metadata = { title: 'OpenVPN — Gestión de Red' };
export default function VpnPage() { return <VpnContent />; }
