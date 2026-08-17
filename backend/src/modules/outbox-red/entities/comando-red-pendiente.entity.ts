import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * El outbox de red: la intención de mutar el hardware, escrita dentro de la transacción de
 * negocio que la decide.
 *
 * Es la tabla más crítica del plano de coordinación. Si una suspensión se pierde aquí, el
 * ERP dice «cortado» y el abonado sigue navegando; si se ejecuta dos veces, se martillea al
 * MA5800 (1.788 reintentos en cuatro días, ADR-003).
 *
 * **Se declara como entidad para que el compilador la vigile** (R7 / desviación B-2). Hasta
 * ahora solo existía como SQL crudo en `outbox-red.service.ts`: un nombre de columna mal
 * escrito dentro de un literal de plantilla es invisible para `tsc` — así se colaron
 * `em.serie_boleta` y compañía, que rompieron facturación EN SILENCIO.
 *
 * **El acceso sigue siendo por SQL crudo, a propósito.** El reclamo atómico
 * (`UPDATE … SET estado='EN_PROCESO' … RETURNING`) es una sola sentencia deliberada: es lo
 * que impide que dos procesos PM2 tomen el mismo comando, y el `FOR UPDATE SKIP LOCKED` que
 * lo precedió protegía la selección pero no la ejecución (ADR-002). Reescribirlo con el
 * repositorio reintroduciría la carrera. La entidad es aquí un **contrato de tipos**, no un
 * cambio de camino de acceso.
 *
 * Excepción de propiedad registrada en PA-12: los módulos de negocio ENCOLAN aquí para que
 * la intención viaje en su propia transacción; `outbox-red` reclama, ejecuta y actualiza.
 */
@Entity('comandos_red_pendientes')
@Index(['estado', 'creadoEn'])
export class ComandoRedPendiente {
  /** `SERIAL`, no UUID: el orden de inserción es el orden de ejecución. */
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  /** El Servicio Contratado (tabla `servicios`), nunca el acuerdo — Ola 2, entregable 3. */
  @Column({ name: 'servicio_id', type: 'uuid' })
  servicioId: string;

  /**
   * Nulable desde `1791400000000`: hay comandos que no van contra un router concreto
   * (FTTH resuelve su destino al ejecutarse).
   */
  @Column({ name: 'router_id', type: 'uuid', nullable: true })
  routerId: string | null;

  @Column({ name: 'accion', type: 'varchar', length: 50 })
  accion: string;

  @Column({ name: 'payload', type: 'jsonb', default: () => `'{}'` })
  payload: Record<string, unknown>;

  @Column({ name: 'intentos', type: 'int', default: 0 })
  intentos: number;

  @Column({ name: 'max_intentos', type: 'int', default: 12 })
  maxIntentos: number;

  /** `PENDIENTE` → `EN_PROCESO` → `EJECUTADO` | `FALLIDO`. */
  @Column({ name: 'estado', type: 'varchar', length: 20, default: 'PENDIENTE' })
  estado: string;

  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;

  @Column({ name: 'creado_en', type: 'timestamptz', default: () => 'NOW()' })
  creadoEn: Date;

  @Column({ name: 'ejecutado_en', type: 'timestamptz', nullable: true })
  ejecutadoEn: Date | null;

  // ── Reclamo atómico (ADR-002) ──────────────────────────────────────────────
  // Quién tomó el comando y hasta cuándo. Sin dueño y sin TTL, un proceso que muere a
  // mitad deja el comando en EN_PROCESO para siempre y nadie lo recupera.

  @Column({ name: 'reclamado_por', type: 'varchar', length: 80, nullable: true })
  reclamadoPor: string | null;

  @Column({ name: 'reclamado_en', type: 'timestamptz', nullable: true })
  reclamadoEn: Date | null;

  @Column({ name: 'claim_expira_en', type: 'timestamptz', nullable: true })
  claimExpiraEn: Date | null;
}
