import type { Metadata } from 'next';
import { PersonalContent } from '@/components/configuracion/PersonalContent';
export const metadata: Metadata = { title: 'Gestión de Personal — Ajustes' };
export default function PersonalPage() {
  return (
    <div className="p-6">
      <PersonalContent />
    </div>
  );
}
