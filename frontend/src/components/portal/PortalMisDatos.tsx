'use client';

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

      <Bloque titulo="Tu plan">
        <Dato label="Plan" valor={servicio.planNombre} />
        <Dato
          label="Velocidad"
          valor={`${servicio.velocidadBajada} Mbps de bajada · ${servicio.velocidadSubida} Mbps de subida`}
        />
        {servicio.planDescripcion && (
          <Dato label="Incluye" valor={servicio.planDescripcion} />
        )}
        {/* Precio del CONTRATO (con su descuento aplicado), nunca el de la lista de
            planes: mostrar el de lista le cobraría de más en pantalla a todo abonado
            con descuento. */}
        <Dato label="Pago mensual" valor={soles(servicio.precioMensual)} />
        <Dato label="Contrato" valor={servicio.numeroContrato} />
      </Bloque>

      <Bloque titulo="Fechas y saldo">
        <Dato
          label="Día de pago"
          valor={servicio.diaFacturacion ? `Cada día ${servicio.diaFacturacion}` : '—'}
        />
        <Dato label="Último pago registrado" valor={fecha(servicio.fechaUltimoPago)} />
        <Dato label="Próximo corte" valor={fecha(servicio.fechaCorte)} />
        {servicio.enProrroga && (
          <Dato label="Prórroga vigente hasta" valor={fecha(servicio.prorrogaHasta)} />
        )}
        <Dato label="Deuda" valor={soles(servicio.deudaTotal)} />
      </Bloque>

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
