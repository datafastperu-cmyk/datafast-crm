import type { Metadata } from 'next';
import { ClienteForm } from '@/components/clientes/ClienteForm';

export const metadata: Metadata = { title: 'Nuevo Cliente' };

export default function NuevoClientePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Nuevo Cliente</h2>
        <p className="text-sm text-muted-foreground">
          Registra un nuevo cliente. Puedes autocompletar los datos consultando el DNI en RENIEC.
        </p>
      </div>
      <ClienteForm />
    </div>
  );
}
