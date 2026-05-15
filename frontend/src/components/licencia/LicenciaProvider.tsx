'use client';

import { useEffect, useState } from 'react';
import { LicenciaBloqueo } from './LicenciaBloqueo';

export function LicenciaProvider({ children }: { children: React.ReactNode }) {
  const [bloqueado, setBloqueado] = useState<{ razon: string } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { razon } = (e as CustomEvent).detail;
      setBloqueado({ razon });
    };
    window.addEventListener('licencia:bloqueada', handler);
    return () => window.removeEventListener('licencia:bloqueada', handler);
  }, []);

  return (
    <>
      {children}
      {bloqueado && (
        <LicenciaBloqueo
          razon={bloqueado.razon}
          onLicenciaActivada={() => setBloqueado(null)}
        />
      )}
    </>
  );
}
