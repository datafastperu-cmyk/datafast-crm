import { Logger }      from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { IMensajeriaStrategy, EnvioResult } from './gateway-mensajeria.service';

// ─── Asuntos por tipo de notificación ────────────────────────
export const SMTP_ASUNTOS: Record<string, string> = {
  factura_emitida:     'Nueva factura generada',
  pago_vence_hoy:      'Recordatorio: su pago vence hoy',
  pago_vencido:        'Aviso de pago vencido',
  servicio_suspendido: 'Su servicio ha sido suspendido',
  servicio_reactivado: 'Su servicio ha sido reactivado',
  servicio_activado:   '¡Bienvenido! Su servicio está activo',
  bienvenida:          '¡Bienvenido a nuestro servicio!',
  pago_recibido:       'Confirmación de pago recibido',
  prorroga_concedida:  'Prórroga de pago concedida',
  alerta_egreso:       'Alerta: gasto recurrente próximo',
  emisor_caido:        'ALERTA: nodo sin conectividad',
  emisor_conectado:    'Nodo restaurado',
  router_caido:        'ALERTA: router fuera de línea',
  router_conectado:    'Router reconectado exitosamente',
  migracion_ftth:      'Su servicio fue migrado a Fibra Óptica',
};

// ─────────────────────────────────────────────────────────────
// SmtpStrategy — envío de email vía SMTP con nodemailer
//
// El parámetro `template` del contrato IMensajeriaStrategy
// se reutiliza como asunto del email.
// ─────────────────────────────────────────────────────────────
export class SmtpStrategy implements IMensajeriaStrategy {
  private readonly logger      = new Logger('SmtpStrategy');
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly host:      string,
    private readonly port:      number,
    private readonly secure:    boolean,
    private readonly user:      string,
    private readonly pass:      string,
    private readonly fromName:  string,
    private readonly fromEmail: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host:              this.host,
      port:              this.port,
      secure:            this.secure,
      auth:              { user: this.user, pass: this.pass },
      connectionTimeout: 15_000,
      socketTimeout:     15_000,
    });
  }

  async enviarMensaje(
    destination: string,  // dirección email del cliente
    texto:       string,  // cuerpo HTML
    template:    string,  // asunto del email (convenio con la interfaz)
  ): Promise<EnvioResult> {
    if (!destination || !destination.includes('@')) {
      return { enviado: false, error: `Email de destino inválido: '${destination}'` };
    }
    try {
      const info = await this.transporter.sendMail({
        from:    `"${this.fromName}" <${this.fromEmail}>`,
        to:      destination,
        subject: template,
        html:    texto,
      });
      this.logger.log(`SMTP → ${destination} | msgId=${info.messageId}`);
      return { enviado: true, messageId: info.messageId };
    } catch (err: any) {
      this.logger.error(`SMTP error → ${destination}: ${err.message}`);
      return { enviado: false, error: err.message };
    }
  }
}
