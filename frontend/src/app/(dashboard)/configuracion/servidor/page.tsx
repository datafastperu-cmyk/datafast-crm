import type { Metadata } from 'next';
import { ServidorTab } from '@/components/configuracion/ServidorTab';
export const metadata: Metadata = { title: 'Servidor — Ajustes' };
export default function ServidorConfigPage() {
  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-lg font-semibold text-foreground mb-6">Servidor</h2>
      <div className="bg-card border border-border rounded-xl p-6"><ServidorTab /></div>
    </div>
  );
}
