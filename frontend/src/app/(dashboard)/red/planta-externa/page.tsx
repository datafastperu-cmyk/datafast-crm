import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlantaExternaContent } from '@/components/planta-externa/PlantaExternaContent';

export const metadata: Metadata = { title: 'Planta Externa — Gestión de Red' };

export default function PlantaExternaPage() {
  // `useSearchParams` (la pestaña vive en la URL) exige un límite de Suspense para que
  // Next pueda prerenderizar la ruta.
  return (
    <Suspense fallback={null}>
      <PlantaExternaContent />
    </Suspense>
  );
}
