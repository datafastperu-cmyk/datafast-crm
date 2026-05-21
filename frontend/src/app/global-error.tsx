'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          textAlign: 'center',
          gap: '1rem',
          fontFamily: 'system-ui, sans-serif',
          backgroundColor: '#0f0f14',
          color: '#e5e5e5',
        }}>
          <div style={{
            width: '3rem',
            height: '3rem',
            borderRadius: '50%',
            backgroundColor: 'rgba(239,68,68,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ef4444',
            fontSize: '1.25rem',
            fontWeight: 'bold',
          }}>!</div>
          <p style={{ fontWeight: 600, fontSize: '1.125rem' }}>Error crítico del sistema</p>
          <p style={{ color: '#888', fontSize: '0.875rem', maxWidth: '20rem' }}>
            {error.message || 'Fallo inesperado en la aplicación.'}
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid #333',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              backgroundColor: 'transparent',
              color: '#e5e5e5',
              fontSize: '0.875rem',
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
