import { MigrationInterface, QueryRunner } from 'typeorm';

// Configuración del Portal del Cliente, editable desde /configuracion/portal-cliente.
// Una fila por empresa: el mismo binario sirve a varias instalaciones y cada una
// publica su portal con su marca, su URL y sus secciones habilitadas.
//
// Los `mostrar_*` son feature flags REALES: el backend deniega la sección deshabilitada,
// no solo se oculta el ítem del menú. Ocultar el botón dejando el endpoint vivo no es
// un control de acceso.
//
// Ausencias deliberadas (decisiones de negocio, no olvidos):
//   · No existe `permitir_autologin`. La autenticación por IP de red deja entrar a
//     cualquiera de la misma LAN —o del mismo CGNAT— a la cuenta ajena, con acceso a
//     datos personales, deuda y control del WiFi. No hay versión segura.
//   · No existe `permitir_cambiar_password`. El abonado no administra su clave; la
//     emite el operador desde Detalle del Cliente.
//   · No existe `permitir_actualizar_datos`. Cambiar DNI o dirección altera datos de
//     facturación e instalación: va por ticket `cambio_datos` con revisión humana.
// Columnas que no existen no se pueden encender por error.
export class CreatePortalConfig1791800000023 implements MigrationInterface {
  name = 'CreatePortalConfig1791800000023';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS portal_config (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id  UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,

        -- ── General ────────────────────────────────────────────
        -- URL pública que el ERP incluye en los avisos al cliente. NO configura nginx:
        -- el host que SIRVE el portal es PORTAL_DOMAIN del .env. Si divergen, el ERP
        -- enviaría enlaces que no resuelven; el panel valida la coincidencia.
        url_portal                 VARCHAR(255),
        titulo                     VARCHAR(100) NOT NULL DEFAULT 'Portal del Cliente',
        url_test_velocidad         VARCHAR(255),
        titulo_menu_personalizado  VARCHAR(100),
        -- TEXTO PLANO, nunca HTML. Este contenido se sirve a todo el parque de
        -- abonados: aceptar HTML libre sería XSS almacenado de distribución masiva.
        contenido_menu_personalizado TEXT,

        -- ── Secciones habilitadas ──────────────────────────────
        mostrar_comprobantes       BOOLEAN NOT NULL DEFAULT true,
        mostrar_soporte            BOOLEAN NOT NULL DEFAULT true,
        mostrar_informar_pago      BOOLEAN NOT NULL DEFAULT true,
        mostrar_test_velocidad     BOOLEAN NOT NULL DEFAULT true,
        mostrar_notificaciones     BOOLEAN NOT NULL DEFAULT true,
        mostrar_wifi               BOOLEAN NOT NULL DEFAULT true,
        mostrar_dispositivos       BOOLEAN NOT NULL DEFAULT true,
        mostrar_planes             BOOLEAN NOT NULL DEFAULT false,
        mostrar_banner             BOOLEAN NOT NULL DEFAULT false,
        mostrar_menu_personalizado BOOLEAN NOT NULL DEFAULT false,
        -- Arranca APAGADO a propósito: no hay colector de consumo todavía. Encenderlo
        -- sin datos medidos mostraría cifras que nadie puede sustentar ante un reclamo.
        mostrar_consumo            BOOLEAN NOT NULL DEFAULT false,

        -- ── Reporte de pago ────────────────────────────────────
        reporte_pago_destinatarios TEXT,
        reporte_pago_medios        TEXT,

        -- ── Diseño ─────────────────────────────────────────────
        logo_url        VARCHAR(255),
        color_primario  VARCHAR(9)  NOT NULL DEFAULT '#16A34A',
        tema            VARCHAR(10) NOT NULL DEFAULT 'claro',

        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

        CONSTRAINT chk_portal_config_tema CHECK (tema IN ('claro', 'oscuro', 'auto'))
      )
    `);

    // Banners promocionales del portal (pestaña Banners).
    await qr.query(`
      CREATE TABLE IF NOT EXISTS portal_banner (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

        titulo        VARCHAR(120),
        imagen_url    VARCHAR(255) NOT NULL,
        enlace_url    VARCHAR(255),
        orden         SMALLINT     NOT NULL DEFAULT 0,
        vigente_desde DATE,
        vigente_hasta DATE,
        activo        BOOLEAN      NOT NULL DEFAULT true,

        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

        -- Una vigencia invertida deja el banner permanentemente invisible sin que nadie
        -- entienda por qué. Se rechaza al guardar, no se descubre en producción.
        CONSTRAINT chk_portal_banner_vigencia
          CHECK (vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
      )
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_portal_banner_empresa_activo
        ON portal_banner (empresa_id, activo, orden)
    `);

    // Fila por defecto para cada empresa existente: el portal siempre encuentra
    // configuración, y el panel no arranca con un formulario vacío.
    await qr.query(`
      INSERT INTO portal_config (empresa_id)
      SELECT id FROM empresas
      ON CONFLICT (empresa_id) DO NOTHING
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS portal_banner`);
    await qr.query(`DROP TABLE IF EXISTS portal_config`);
  }
}
