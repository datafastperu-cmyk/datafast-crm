import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center gap-4">
      <p className="text-6xl font-bold text-muted-foreground/30">404</p>
      <p className="font-semibold text-foreground">Página no encontrada</p>
      <p className="text-sm text-muted-foreground">La ruta solicitada no existe en el sistema.</p>
      <Link
        href="/"
        className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
