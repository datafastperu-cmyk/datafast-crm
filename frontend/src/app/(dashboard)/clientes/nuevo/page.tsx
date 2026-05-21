import type { Metadata } from 'next';
import { ClienteWizard } from '@/components/clientes/ClienteWizard';

export const metadata: Metadata = { title: 'Nuevo Abonado' };

export default function NuevoClientePage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Nuevo Abonado</h2>
        <p className="text-sm text-muted-foreground">
          Registra un nuevo abonado en 3 pasos. Puedes autocompletar los datos consultando el DNI en RENIEC.
        </p>
      </div>
      <ClienteWizard />
    </div>
  );
}
