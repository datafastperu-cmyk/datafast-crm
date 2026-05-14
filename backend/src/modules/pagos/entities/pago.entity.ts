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
  DEVUELTO               = 'devuelto',
}

// ─── Entidad Pago ─────────────────────────────────────────────
@Entity('pagos')
@Index(['empresaId', 'fechaPago'])
@Index(['empresaId', 'estado'])
@Index(['clienteId', 'fechaPago'])
@Index(['facturaId'])
@Index(['empresaId', 'metodo_pago', 'numero_operacion'], { unique: true, where: 'numero_operacion IS NOT NULL' })
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
  @Column({
    name: 'metodo_pago',
    type: 'enum',
    enum: MetodoPago,
  })
  metodoPago: MetodoPago;

  @Column({ length: 100, nullable: true })
  banco: string;   // BCP, Interbank, BBVA, Scotiabank, BanBif...

  @Column({ name: 'numero_operacion', length: 100, nullable: true })
  numeroOperacion: string; // Número único de transacción (antiduplico)

  @Column({ name: 'numero_cuenta', length: 50, nullable: true })
  numeroCuenta: string;  // Últimos 4 dígitos de la cuenta destino

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
