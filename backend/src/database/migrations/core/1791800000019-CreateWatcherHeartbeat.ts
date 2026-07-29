import { MigrationInterface, QueryRunner } from 'typeorm';

// Latido de los watchers del sistema.
//
// Origen (2026-07-28): al verificar que los ~10 watchers estaban vivos se descubrió que
// 8 de ellos son INDISTINGUIBLES DE MUERTOS. Están diseñados para no loguear cuando no
// encuentran nada —lo cual es correcto, si no inundarían la bitácora— pero el efecto
// secundario es que un watcher que deja de correr se ve exactamente igual que uno que no
// tiene trabajo. El único que se pudo verificar de forma directa fue la reconciliación
// VPN, y solo porque deja un efecto medible (`ultimo_handshake` avanza).
//
// Es la lección del día aplicada a nuestras propias herramientas: si no genera evidencia,
// no se puede afirmar que ocurrió. Se montó observabilidad para el sistema y los
// observadores quedaron ciegos.
//
// Con esta tabla la pregunta "¿el watcher de staleness sigue corriendo?" tiene respuesta.
export class CreateWatcherHeartbeat1791800000019 implements MigrationInterface {
  name = 'CreateWatcherHeartbeat1791800000019';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS watcher_heartbeat (
        nombre            VARCHAR(64) PRIMARY KEY,
        -- Cada cuánto DEBERÍA latir. Es lo que permite decidir si un watcher está
        -- rancio sin que quien consulta tenga que conocer el cron de cada uno.
        intervalo_esperado_seg INT NOT NULL,
        ultima_ejecucion  TIMESTAMPTZ NOT NULL,
        duracion_ms       INT,
        exito             BOOLEAN NOT NULL DEFAULT TRUE,
        -- Resumen de lo que hizo la última pasada (contadores propios de cada watcher).
        resultado         JSONB,
        ultimo_error      TEXT,
        -- Acumulados: distinguir "falla siempre" de "falló una vez" sin guardar historial.
        ejecuciones       BIGINT NOT NULL DEFAULT 0,
        fallos            BIGINT NOT NULL DEFAULT 0,
        creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Consulta típica: "¿cuáles llevan más tiempo del que deberían sin latir?"
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_watcher_hb_ultima
        ON watcher_heartbeat (ultima_ejecucion)
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS watcher_heartbeat`);
  }
}
