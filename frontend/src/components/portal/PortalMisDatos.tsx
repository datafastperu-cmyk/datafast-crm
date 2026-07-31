'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { useServicioActual } from './useServicioActual';

const DOCUMENTO: Record<string, string> = {
  dni: 'DNI', ruc: 'RUC', ce: 'Carné de extranjería', pasaporte: 'Pasaporte',
};

const soles = (n: number) =>
  `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fecha = (iso: string | null) => {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

export function PortalMisDatos() {
  const { perfil, servicio, cargando } = useServicioActual();

  if (cargando || !perfil || !servicio) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Bloque titulo="Titular del servicio">
        <Dato label="Nombre completo" valor={perfil.nombreCompleto} />
        <Dato
          label={DOCUMENTO[perfil.tipoDocumento] ?? 'Documento'}
          valor={perfil.numeroDocumento}
        />
        <Dato label="Teléfono / WhatsApp" valor={perfil.telefono ?? '—'} />
        <Dato label="Dirección del servicio" valor={servicio.direccion ?? '—'} />
      </Bloque>

      {/* El detalle del plan y sus fechas viven en «Mis servicios». Duplicarlos aquí
          garantizaba que ambas pantallas se contradijeran en cuanto una cambiara. */}
      <Bloque titulo="Saldo">
        <Dato label="Último pago registrado" valor={fecha(servicio.fechaUltimoPago)} />
        <Dato label="Deuda" valor={soles(servicio.deudaTotal)} />
      </Bloque>

      <Link
        href="/portal/servicios"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline px-1"
      >
        Ver el detalle de mi servicio
        <ArrowRight className="w-4 h-4" />
      </Link>

      {/* El abonado no edita sus datos: DNI y dirección afectan facturación e
          instalación. Se le dice a dónde ir en lugar de dejarle un formulario que
          nadie revisaría. */}
      <p className="text-xs text-muted-foreground px-1">
        ¿Algún dato no coincide? Escríbenos por soporte y lo corregimos.
      </p>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-3 border-b border-border">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {titulo}
        </p>
      </div>
      <dl className="divide-y divide-border">{children}</dl>
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="px-5 py-3 sm:flex sm:items-baseline sm:gap-4">
      <dt className="text-xs text-muted-foreground sm:w-52 sm:flex-shrink-0">{label}</dt>
      <dd className="text-sm text-foreground break-words">{valor}</dd>
    </div>
  );
}
