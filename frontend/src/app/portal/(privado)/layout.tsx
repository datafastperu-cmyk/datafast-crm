import { PortalShell } from '@/components/portal/PortalShell';

// Todo lo que vive aquí exige sesión de abonado. El middleware ya redirige al login sin
// cookie; el shell además reacciona si el token vence con el portal abierto.
export default function PortalPrivadoLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
