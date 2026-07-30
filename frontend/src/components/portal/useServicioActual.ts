'use client';

import { useQuery } from '@tanstack/react-query';
import { portalApi, type PortalPerfil, type PortalServicio } from '@/lib/api/portal';
import { usePortalStore } from '@/store/portal.store';

// Servicio que el abonado tiene seleccionado. Lee de la MISMA query que el shell
// (`portal-me`), así que no dispara una petición extra ni puede mostrar un servicio
// distinto al del selector.
export function useServicioActual(): {
  perfil: PortalPerfil | undefined;
  servicio: PortalServicio | undefined;
  cargando: boolean;
} {
  const { contratoId } = usePortalStore();
  const { data: perfil, isLoading } = useQuery({
    queryKey: ['portal-me'],
    queryFn:  portalApi.me,
  });

  const servicios = perfil?.servicios ?? [];
  const servicio = servicios.find((s) => s.contratoId === contratoId) ?? servicios[0];

  return { perfil, servicio, cargando: isLoading };
}
