import { MigrationInterface, QueryRunner } from 'typeorm';

// Solicitudes de cambio de plan hechas por el abonado desde el portal.
//
// Es una SOLICITUD, no un cambio. Un cambio de plan toca la cola/queue del MikroTik, el
// precio del contrato y el prorrateo de la factura en curso; aplicarlo desde un clic de
// quien no ve ese contexto es exactamente el patrón que este repositorio prohíbe (mutar
// hardware y facturación por acción de un actor sin contexto). El abonado pide, el
// operador aplica por el flujo de negocio existente.
//
// Por eso esta tabla NO tiene ninguna columna que ejecute nada: solo registra intención,
// veredicto y trazabilidad.
export class CreatePortalSolicitudPlan1791800000024 implements MigrationInterface {
  name = 'CreatePortalSolicitudPlan1791800000024';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS portal_solicitud_plan (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL REFERENCES empresas(id)  ON DELETE CASCADE,
        cliente_id  UUID NOT NULL REFERENCES clientes(id)  ON DELETE CASCADE,
        contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,

        -- Plan de origen y destino con su precio CONGELADO al momento de solicitar: si
        -- mañana cambia la lista de precios, el veredicto del operador debe poder leerse
        -- contra lo que el abonado realmente vio en pantalla.
        plan_origen_id     UUID           NOT NULL REFERENCES planes(id),
        plan_destino_id    UUID           NOT NULL REFERENCES planes(id),
        precio_origen      DECIMAL(10,2)  NOT NULL,
        precio_destino     DECIMAL(10,2)  NOT NULL,

        estado      VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        -- Nota del abonado al solicitar y motivo del operador al resolver.
        nota_cliente   TEXT,
        motivo_resolucion TEXT,
        resuelta_por   UUID REFERENCES usuarios(id),
        resuelta_en    TIMESTAMPTZ,

        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

        CONSTRAINT chk_portal_solicitud_plan_estado
          CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'aplicada', 'cancelada')),
        CONSTRAINT chk_portal_solicitud_plan_distinto
          CHECK (plan_destino_id <> plan_origen_id)
      )
    `);

    // Una sola solicitud en vuelo por contrato. Sin esto, un abonado impaciente genera
    // una cola de solicitudes contradictorias sobre el mismo servicio y el operador no
    // sabe cuál es la vigente.
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_solicitud_plan_pendiente
        ON portal_solicitud_plan (contrato_id)
        WHERE estado = 'pendiente'
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_portal_solicitud_plan_bandeja
        ON portal_solicitud_plan (empresa_id, estado, created_at DESC)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS portal_solicitud_plan`);
  }
}
