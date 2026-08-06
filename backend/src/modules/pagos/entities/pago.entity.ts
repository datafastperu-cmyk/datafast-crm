import { Entity, Column, Index } from 'typeorm';

// ─── Enums ────────────────────────────────────────────────────
export enum MetodoPago {
  EFECTIVO              = 'efectivo',
  YAPE                  = 'yape',
  PLIN                  = 'plin',
  TRANSFERENCIA_BANCARIA = 'transferencia_bancaria',
  DEPOSITO_BANCARIO     = 'deposito_bancario',
  MERCADOPAGO           = 'mercadopago',
  TARJETA_CREDITO       = 'tarjeta_credito',
  TARJETA_DEBITO        = 'tarjeta_debito',
  CHEQUE                = 'cheque',
  OTRO                  = 'otro',
}

export enum EstadoPago {
  PENDIENTE_VERIFICACION = 'pendiente_verificacion',
  VERIFICADO             = 'verificado',
  RECHAZADO              = 'rechazado',
  /** El dinero volvió al abonado por el mismo canal (devolución bancaria concreta). */
  DEVUELTO               = 'devuelto',
  /**
   * Anulado: el cobro deja de surtir efecto y su imputación se retira de los
   * comprobantes. La fila NO se borra — un pago registrado es un hecho histórico, y
   * borrarlo deja sin rastro dinero que alguien cobró. El motivo vive en `pago_extorno`.
   */
  EXTORNADO              = 'extornado',
}

/**
 * Por qué se anula un cobro. Tipificado, no texto libre: de esto depende si el dinero se
 * le devuelve al abonado y si cortarle el servicio es legítimo o es un error nuestro.
 */
export enum MotivoExtorno {
  /** Equivocación del cajero al registrar. El más frecuente — y culpa nuestra. */
  ERROR_REGISTRO     = 'error_registro',
  DEVOLUCION_CLIENTE = 'devolucion_cliente',
  CHEQUE_REBOTADO    = 'cheque_rebotado',
  CONTRACARGO        = 'contracargo',
  PAGO_DUPLICADO     = 'pago_duplicado',
  FRAUDE             = 'fraude',
}

// ─── Entidad Pago ─────────────────────────────────────────────
@Entity('pagos')
@Index(['empresaId', 'fechaPago'])
@Index(['empresaId', 'estado'])
@Index(['clienteId', 'fechaPago'])
@Index(['facturaId'])
// Unicidad del número de operación por empresa, SIN el método de pago: un mismo código no
// se repite aunque uno sea Yape y otro transferencia. La declaración incluía `metodoPago` y
// la base de datos no —la migración 035 lo quitó a propósito—, así que regenerar el esquema
// desde las entidades habría reinstalado una restricción MÁS DÉBIL que la vigente y abierto
// la puerta al duplicado que hoy está cerrado (deriva detectada en el diagnóstico F0).
@Index(['empresaId', 'numeroOperacion'], { unique: true, where: 'numero_operacion IS NOT NULL' })
export class Pago {
  @Column({ primary: true, generated: 'uuid' })
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ name: 'cliente_id' })
  clienteId: string;

  @Column({ name: 'factura_id', nullable: true })
  facturaId: string;

  @Column({ name: 'contrato_id', nullable: true })
  contratoId: string;

  // ── Monto ────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ length: 10, default: 'PEN' })
  moneda: string;

  // ── Método ───────────────────────────────────────────────
  @Column({ name: 'metodo_pago', length: 100 })
  metodoPago: string;

  @Column({ length: 100, nullable: true })
  banco: string;   // BCP, Interbank, BBVA, Scotiabank, BanBif...

  @Column({ name: 'numero_operacion', length: 100, nullable: true })
  numeroOperacion: string; // Número único de transacción (antiduplico)

  /**
   * Clave que el CLIENTE genera una vez por apertura del formulario y repite en cada
   * intento. Cierra el hueco del efectivo: un cobro en efectivo no tiene número de
   * operación, así que nada impedía que un doble clic creara dos filas de S/ 85.
   *
   * Un segundo envío con la misma clave devuelve el pago existente, no un error: repetir
   * el envío no es una equivocación del cajero, es la red o el ratón.
   */
  // `type` EXPLÍCITO: con SWC, un `string | null` sin él se emite como `Object` y TypeORM
  // tumba el arranque con "Data type Object is not supported by postgres". Es un fallo en
  // frío, así que no aparece hasta que el proceso se reinicia de verdad — y aquí no lo
  // hizo durante once horas por el bug del `update.sh`, que lo mantuvo oculto.
  @Column({ name: 'idempotency_key', type: 'varchar', length: 64, nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'numero_cuenta', length: 50, nullable: true })
  numeroCuenta: string;  // Últimos 4 dígitos de la cuenta destino

  // ── Los tres ejes del ingreso ────────────────────────────
  //
  // `metodoPago` y `banco` (arriba) son el modelo antiguo: dos columnas de texto libre que
  // mezclaban forma y canal y no decían dónde entró el dinero. Se CONSERVAN escritas —el
  // histórico se lee tal como se registró— pero el modelo vivo es este.

  /** El medio concreto: Yape, BCP, la oficina. La forma se deriva del canal. */
  @Column({ name: 'canal_pago_id', type: 'uuid', nullable: true })
  canalPagoId: string | null;

  /**
   * Dónde entró el dinero. Sin esto el ERP sabía que entraron S/ 85 por Yape y no sabía
   * en qué cuenta estaban: no había tesorería, solo un registro de cobros.
   */
  @Column({ name: 'cuenta_receptora_id', type: 'uuid', nullable: true })
  cuentaReceptoraId: string | null;

  /** Lo que retuvo el canal. Es GASTO, no un menor cobro. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0,
            transformer: { to: (v: number) => v, from: (v: string | null) => (v === null ? 0 : parseFloat(v)) } })
  comision: number;

  /**
   * `monto - comision`: lo que hay que buscar en el extracto bancario al conciliar.
   * `monto` sigue siendo el bruto y es lo único que salda la factura — el abonado pagó eso.
   */
  @Column({ name: 'monto_neto', type: 'numeric', precision: 12, scale: 2, nullable: true,
            transformer: { to: (v: number) => v, from: (v: string | null) => (v === null ? null : parseFloat(v)) } })
  montoNeto: number | null;

  // ── Estado y verificación ────────────────────────────────
  @Column({
    type: 'enum',
    enum: EstadoPago,
    default: EstadoPago.PENDIENTE_VERIFICACION,
  })
  estado: EstadoPago;

  @Column({ name: 'verificado_por', nullable: true })
  verificadoPor: string;

  @Column({ name: 'verificado_en', type: 'timestamptz', nullable: true })
  verificadoEn: Date;

  /**
   * Cuándo el pago llegó a SURTIR EFECTO (factura saldada + contrato reevaluado), que no es
   * lo mismo que quedar registrado. Un pago verificado con esto en NULL es trabajo pendiente:
   * significa que la aplicación falló a mitad y el abonado puede estar cortado habiendo
   * pagado. Lo recoge `reconciliarPagosNoAplicados`.
   */
  @Column({ name: 'aplicado_en', type: 'timestamptz', nullable: true })
  aplicadoEn: Date | null;

  @Column({ name: 'motivo_rechazo', type: 'text', nullable: true })
  motivoRechazo: string;

  // ── Comprobante ───────────────────────────────────────────
  @Column({ name: 'comprobante_url', length: 500, nullable: true })
  comprobanteUrl: string;

  // ── MercadoPago ───────────────────────────────────────────
  @Column({ name: 'mp_payment_id', length: 100, nullable: true })
  mpPaymentId: string;

  @Column({ name: 'mp_status', length: 50, nullable: true })
  mpStatus: string;

  @Column({ name: 'mp_preference_id', length: 100, nullable: true })
  mpPreferenceId: string;

  @Column({ name: 'mp_detail', type: 'jsonb', nullable: true })
  mpDetail: Record<string, any>; // Payload completo de MercadoPago

  // ── Fechas ────────────────────────────────────────────────
  @Column({ name: 'fecha_pago', type: 'date', default: () => 'CURRENT_DATE' })
  fechaPago: string;

  @Column({ name: 'registrado_en', type: 'timestamptz', default: () => 'NOW()' })
  registradoEn: Date;

  // ── Cajero que registró ───────────────────────────────────
  @Column({ name: 'cajero_id', nullable: true })
  cajeroId: string;

  @Column({ type: 'text', nullable: true })
  notas: string;

  /**
   * `false` = cobrar sin devolver el servicio.
   *
   * La decide el operador al registrar ("Solo registrar"), pero la reactivación puede
   * ocurrir mucho después —cuando alguien verifica un pago pendiente—, así que viaja en la
   * fila del pago: quien verifica días más tarde tiene que saber qué se decidió en el
   * mostrador. El caso típico es una baja voluntaria que salda su último comprobante.
   */
  @Column({ name: 'reactivar_servicio', type: 'boolean', default: true })
  reactivarServicio: boolean;

  // ── Conciliación bancaria ─────────────────────────────────
  @Column({ default: false })
  conciliado: boolean;

  @Column({ name: 'conciliado_en', type: 'timestamptz', nullable: true })
  conciliadoEn: Date;

  @Column({ name: 'conciliado_por', nullable: true })
  conciliadoPor: string;

  @Column({ name: 'extracto_banco_ref', length: 200, nullable: true })
  extractoBancoRef: string; // Referencia en el extracto bancario

  // ── Auditoría ─────────────────────────────────────────────
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;

  // ── Helpers ───────────────────────────────────────────────
  get estaVerificado(): boolean {
    return this.estado === EstadoPago.VERIFICADO;
  }

  get etiquetaMetodo(): string {
    const etiquetas: Record<MetodoPago, string> = {
      [MetodoPago.EFECTIVO]:               'Efectivo',
      [MetodoPago.YAPE]:                   'Yape',
      [MetodoPago.PLIN]:                   'Plin',
      [MetodoPago.TRANSFERENCIA_BANCARIA]: 'Transferencia',
      [MetodoPago.DEPOSITO_BANCARIO]:      'Depósito',
      [MetodoPago.MERCADOPAGO]:            'MercadoPago',
      [MetodoPago.TARJETA_CREDITO]:        'Tarjeta Crédito',
      [MetodoPago.TARJETA_DEBITO]:         'Tarjeta Débito',
      [MetodoPago.CHEQUE]:                 'Cheque',
      [MetodoPago.OTRO]:                   'Otro',
    };
    return etiquetas[this.metodoPago] || this.metodoPago;
  }
}

// ─── Cuenta Bancaria de la empresa ───────────────────────────
@Entity('cuentas_bancarias')
@Index(['empresaId', 'activa'])
export class CuentaBancaria {
  @Column({ primary: true, generated: 'uuid' })
  id: string;

  @Column({ name: 'empresa_id' })
  empresaId: string;

  @Column({ length: 100 })
  banco: string;

  @Column({ name: 'tipo_cuenta', length: 50, default: 'corriente' })
  tipoCuenta: string;

  /**
   * Dónde vive realmente el dinero. Una caja se ARQUEA (se cuenta a mano y se declara la
   * diferencia); una cuenta bancaria se CONCILIA contra el extracto. Son controles
   * distintos, y por eso el tipo es inmutable: cambiarlo reescribiría el significado de
   * los cierres que ya se hicieron sobre ella.
   */
  @Column({ type: 'varchar', length: 20, default: 'banco' })
  tipo: 'caja' | 'banco' | 'pasarela' | 'virtual';

  /** Rótulo operativo — "Caja Principal", "BCP Soles". Es lo que ve el cajero. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  nombre: string | null;

  /** Una caja con arqueo pertenece a UN responsable, o el faltante no tiene dueño. */
  @Column({ name: 'cajero_responsable_id', type: 'uuid', nullable: true })
  cajeroResponsableId: string | null;

  @Column({ name: 'requiere_arqueo', type: 'boolean', default: false })
  requiereArqueo: boolean;

  @Column({ name: 'numero_cuenta', length: 50 })
  numeroCuenta: string;

  @Column({ length: 50, nullable: true })
  cci: string;

  @Column({ length: 10, default: 'PEN' })
  moneda: string;

  @Column({ length: 200, nullable: true })
  titular: string;

  @Column({ default: true })
  activa: boolean;

  @Column({ name: 'es_principal', default: false })
  esPrincipal: boolean;

  @Column({ name: 'logo_banco', length: 200, nullable: true })
  logoBanco: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
