import { redirect } from 'next/navigation';

// Sites se absorbió en Planta Externa. Es la cabecera del grafo óptico —el origen de una
// troncal— así que tenerlo en otra sección obligaba a saltar de pantalla para documentar
// una sola cosa física. La ruta se conserva como redirección por marcadores y enlaces.
export default function SitesRedirect() {
  redirect('/red/planta-externa?tab=sites');
}
