import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Portal del Cliente',
  // Zona privada de abonados: no debe aparecer en buscadores.
  robots: { index: false, follow: false },
};

// Layout raíz del portal: deliberadamente vacío. El shell (cabecera, menú, selector de
// servicio) vive en el grupo (privado), porque el login NO puede renderizarse dentro de
// un shell que exige sesión.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
