import type { Metadata } from 'next';
import { PlantillasEditor } from '@/components/configuracion/PlantillasEditor';

export const metadata: Metadata = { title: 'Editar Plantillas — Ajustes' };

export default function PlantillasPage() {
  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Editar Plantillas</h2>
        <p className="text-sm text-muted-foreground">
          Personaliza los mensajes, documentos y correos que se envían a tus clientes. Usa variables para insertar datos dinámicos.
        </p>
      </div>
      <PlantillasEditor />
    </div>
  );
}
