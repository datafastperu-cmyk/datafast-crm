import type { Metadata } from 'next';
import { LogsTab } from '@/components/configuracion/LogsTab';

export const metadata: Metadata = { title: 'Log del Sistema — Ajustes' };

export default function LogPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Log del Sistema</h2>
        <p className="text-sm text-muted-foreground">Registro de eventos, errores y actividad del sistema.</p>
      </div>
      <LogsTab />
    </div>
  );
}
