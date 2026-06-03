import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Gastos / Ingresos' };
export default function GastosPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Gastos / Ingresos</h2>
        <p className="text-sm text-muted-foreground">Control de egresos operativos y otros ingresos</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Módulo en construcción</p>
        <p className="text-xs text-muted-foreground">API disponible en <code className="font-mono bg-muted px-1 rounded">GET /finanzas/opex</code></p>
      </div>
    </div>
  );
}
