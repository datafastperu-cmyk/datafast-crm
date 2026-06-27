'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[RouteError]', error);
    // Chunk obsoleto tras deploy → recargar una vez para obtener los nuevos hashes
    if (error.message?.includes('Loading chunk') || error.message?.includes('ChunkLoadError')) {
      const reloaded = sessionStorage.getItem('chunk-reload');
      if (!reloaded) {
        sessionStorage.setItem('chunk-reload', '1');
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center gap-4">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive text-xl font-bold">
        !
      </div>
      <div>
        <p className="font-semibold text-foreground">Ocurrió un error en esta sección</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {error.message || 'Error inesperado. Intenta recargar la página.'}
        </p>
      </div>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
      >
        Reintentar
      </button>
    </div>
  );
}
