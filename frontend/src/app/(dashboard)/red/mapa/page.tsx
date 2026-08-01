import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Mapa de Red' };

// MapLibre toca `window` al construirse, así que no puede prerenderizarse en el servidor.
// `ssr: false` lo carga sólo en el navegador; además evita meter la librería en el bundle
// inicial de todo el dashboard, que la usa una sola pantalla.
const MapaRedContent = dynamic(
  () => import('@/components/planta-externa/MapaRedContent').then((m) => m.MapaRedContent),
  { ssr: false },
);

export default function MapaRedPage() {
  return <MapaRedContent />;
}
