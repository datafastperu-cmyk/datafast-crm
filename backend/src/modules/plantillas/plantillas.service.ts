import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlantillaMensaje, TipoPlantilla } from './entities/plantilla-mensaje.entity';
import { PlantillaAbonado, FacturacionConfig, NotificacionesConfig } from './entities/plantilla-abonado.entity';

// ─── Defaults por tipo ────────────────────────────────────────
const DEFAULTS: Record<TipoPlantilla, Record<string, { nombre: string; contenido: string }>> = {
  whatsapp: {
    aviso_pago_01: {
      nombre: 'Aviso de Pago #1',
      contenido:
        'Hola {{nombre_completo}} 👋, le recordamos que su factura N° {{numero_factura}} por S/ {{monto_factura}} vencerá el {{fecha_pago}}. Por favor realice su pago a tiempo para evitar interrupciones en su servicio {{plan_contratado}}. Gracias, {{empresa}}.',
    },
    aviso_pago_02: {
      nombre: 'Aviso de Pago #2',
      contenido:
        '{{nombre_completo}}, quedan {{dias_vencimiento}} día(s) para el vencimiento de su factura N° {{numero_factura}} por S/ {{monto_factura}}. Fecha límite: {{fecha_pago}}. Evite el corte de su servicio. Consultas: {{telefono_empresa}}.',
    },
    aviso_pago_03: {
      nombre: 'Aviso de Pago #3 (Último aviso)',
      contenido:
        '⚠️ ÚLTIMO AVISO — {{nombre_completo}}, su factura N° {{numero_factura}} por S/ {{monto_factura}} VENCE HOY {{fecha_pago}}. Sin pago, su servicio {{plan_contratado}} será SUSPENDIDO. Comuníquese al {{telefono_empresa}}.',
    },
    nueva_factura: {
      nombre: 'Nueva Factura Generada',
      contenido:
        '{{nombre_completo}}, se ha generado su factura N° {{numero_factura}} por S/ {{monto_factura}} (Plan: {{plan_contratado}}). Fecha de vencimiento: {{fecha_pago}}. {{empresa}} — {{telefono_empresa}}.',
    },
    corte_servicio: {
      nombre: 'Corte de Servicio',
      contenido:
        '{{nombre_completo}}, su servicio {{plan_contratado}} ha sido SUSPENDIDO por falta de pago. Deuda: S/ {{monto_factura}}. Para reactivar, realice el pago y contáctenos al {{telefono_empresa}}. {{empresa}}.',
    },
    bienvenida: {
      nombre: 'Bienvenida',
      contenido:
        '🎉 ¡Bienvenido a {{empresa}}, {{nombre_completo}}! Su servicio {{plan_contratado}} ha sido ACTIVADO. Usuario: {{usuario_pppoe}} | IP: {{ip_asignada}}. Soporte: {{telefono_empresa}}. ¡Que lo disfrute!',
    },
    emisor_caido: {
      nombre: 'Emisor Caído',
      contenido:
        '⚠️ ALERTA {{empresa}}: El nodo {{nodo_nombre}} ha perdido conectividad. Estamos trabajando para restablecer el servicio. Disculpe los inconvenientes. Reportes: {{telefono_empresa}}.',
    },
    emisor_conectado: {
      nombre: 'Emisor Conectado',
      contenido:
        '✅ {{empresa}}: El nodo {{nodo_nombre}} ha sido RESTAURADO exitosamente. El servicio está operativo. Gracias por su paciencia.',
    },
    router_caido: {
      nombre: 'Router Caído',
      contenido:
        '⚠️ ALERTA {{empresa}}: El router {{router_nombre}} está CAÍDO. Se está atendiendo la incidencia. Consultas: {{telefono_empresa}}.',
    },
    router_conectado: {
      nombre: 'Router Conectado',
      contenido:
        '✅ {{empresa}}: El router {{router_nombre}} ha sido RECONECTADO exitosamente. Todo funciona con normalidad.',
    },
    confirmacion_pago: {
      nombre: 'Confirmación de Pago',
      contenido:
        '✅ {{nombre_completo}}, hemos recibido su pago de S/ {{monto_factura}} para la factura N° {{numero_factura}}. ¡Gracias por su puntualidad! Su servicio {{plan_contratado}} continúa activo. {{empresa}}.',
    },
  },

  email: {
    aviso_pago_01: {
      nombre: 'Aviso de Pago #1',
      contenido:
        '<h2>Recordatorio de Pago</h2><p>Estimado/a <strong>{{nombre_completo}}</strong>,</p><p>Le recordamos que su factura N° <strong>{{numero_factura}}</strong> por el monto de <strong>S/ {{monto_factura}}</strong> vencerá el <strong>{{fecha_pago}}</strong>.</p><p>Por favor realice su pago a tiempo para evitar interrupciones en su servicio <strong>{{plan_contratado}}</strong>.</p><p>Gracias por su preferencia,<br><strong>{{empresa}}</strong><br>{{telefono_empresa}}</p>',
    },
    aviso_pago_02: {
      nombre: 'Aviso de Pago #2',
      contenido:
        '<h2>Pago próximo a vencer</h2><p>Estimado/a <strong>{{nombre_completo}}</strong>,</p><p>Le informamos que quedan <strong>{{dias_vencimiento}} día(s)</strong> para el vencimiento de su factura N° {{numero_factura}} por <strong>S/ {{monto_factura}}</strong>.</p><p>Fecha límite: <strong>{{fecha_pago}}</strong>.</p><p>Evite el corte de su servicio realizando el pago antes de la fecha indicada.</p><p>Atentamente,<br><strong>{{empresa}}</strong><br>{{telefono_empresa}}</p>',
    },
    aviso_pago_03: {
      nombre: 'Aviso de Pago #3 (Último aviso)',
      contenido:
        '<h2 style="color:#dc2626;">⚠️ Último Aviso de Pago</h2><p>Estimado/a <strong>{{nombre_completo}}</strong>,</p><p>Su factura N° <strong>{{numero_factura}}</strong> por <strong>S/ {{monto_factura}}</strong> <strong style="color:#dc2626;">VENCE HOY {{fecha_pago}}</strong>.</p><p>De no realizar el pago, su servicio <strong>{{plan_contratado}}</strong> será <strong>SUSPENDIDO</strong>.</p><p>Para evitar el corte, comuníquese con nosotros al <strong>{{telefono_empresa}}</strong>.</p><p><strong>{{empresa}}</strong></p>',
    },
    nueva_factura: {
      nombre: 'Nueva Factura Generada',
      contenido:
        '<h2>Nueva Factura Generada</h2><p>Estimado/a <strong>{{nombre_completo}}</strong>,</p><p>Se ha generado su factura N° <strong>{{numero_factura}}</strong>:</p><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%"><tr><th>Plan</th><th>Monto</th><th>Vencimiento</th></tr><tr><td>{{plan_contratado}}</td><td>S/ {{monto_factura}}</td><td>{{fecha_pago}}</td></tr></table><p>Atentamente,<br><strong>{{empresa}}</strong><br>{{telefono_empresa}}</p>',
    },
    corte_servicio: {
      nombre: 'Corte de Servicio',
      contenido:
        '<h2 style="color:#dc2626;">Servicio Suspendido</h2><p>Estimado/a <strong>{{nombre_completo}}</strong>,</p><p>Lamentamos informarle que su servicio <strong>{{plan_contratado}}</strong> ha sido <strong>SUSPENDIDO</strong> por falta de pago.</p><p>Deuda pendiente: <strong>S/ {{monto_factura}}</strong>.</p><p>Para reactivar su servicio, por favor realice el pago y contáctenos al <strong>{{telefono_empresa}}</strong>.</p><p><strong>{{empresa}}</strong></p>',
    },
    bienvenida: {
      nombre: 'Bienvenida',
      contenido:
        '<h2>🎉 ¡Bienvenido a {{empresa}}!</h2><p>Estimado/a <strong>{{nombre_completo}}</strong>,</p><p>Su servicio <strong>{{plan_contratado}}</strong> ha sido <strong>ACTIVADO</strong> exitosamente.</p><table border="1" cellpadding="8" style="border-collapse:collapse"><tr><th>Usuario PPPoE</th><td>{{usuario_pppoe}}</td></tr><tr><th>IP Asignada</th><td>{{ip_asignada}}</td></tr></table><p>Para soporte técnico llame al <strong>{{telefono_empresa}}</strong>.</p><p>¡Que lo disfrute!<br><strong>{{empresa}}</strong></p>',
    },
    emisor_caido: {
      nombre: 'Emisor Caído',
      contenido:
        '<h2>⚠️ Alerta de Red</h2><p>El nodo <strong>{{nodo_nombre}}</strong> ha perdido conectividad. Estamos trabajando para restablecer el servicio.</p><p><strong>{{empresa}}</strong> — {{telefono_empresa}}</p>',
    },
    emisor_conectado: {
      nombre: 'Emisor Conectado',
      contenido:
        '<h2>✅ Servicio Restaurado</h2><p>El nodo <strong>{{nodo_nombre}}</strong> ha sido restaurado exitosamente. El servicio está operativo.</p><p><strong>{{empresa}}</strong></p>',
    },
    router_caido: {
      nombre: 'Router Caído',
      contenido:
        '<h2>⚠️ Alerta de Router</h2><p>El router <strong>{{router_nombre}}</strong> está fuera de línea. Se está atendiendo la incidencia.</p><p><strong>{{empresa}}</strong> — {{telefono_empresa}}</p>',
    },
    router_conectado: {
      nombre: 'Router Conectado',
      contenido:
        '<h2>✅ Router Restaurado</h2><p>El router <strong>{{router_nombre}}</strong> ha sido reconectado exitosamente. Todo funciona con normalidad.</p><p><strong>{{empresa}}</strong></p>',
    },
    confirmacion_pago: {
      nombre: 'Confirmación de Pago',
      contenido:
        '<h2>✅ Pago Recibido</h2><p>Estimado/a <strong>{{nombre_completo}}</strong>,</p><p>Hemos recibido su pago de <strong>S/ {{monto_factura}}</strong> para la factura N° <strong>{{numero_factura}}</strong>.</p><p>¡Gracias por su puntualidad! Su servicio <strong>{{plan_contratado}}</strong> continúa activo.</p><p>Atentamente,<br><strong>{{empresa}}</strong></p>',
    },
  },

  documento: {
    factura: {
      nombre: 'Factura / Comprobante',
      contenido:
        '<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px">\n  <div style="display:flex;justify-content:space-between;margin-bottom:20px">\n    <div><h1 style="margin:0">{{empresa}}</h1><p style="margin:4px 0">RUC: {{empresa_ruc}}</p><p style="margin:4px 0">{{empresa_direccion}}</p><p style="margin:4px 0">Tel: {{telefono_empresa}}</p></div>\n    <div style="text-align:right"><h2 style="margin:0">FACTURA</h2><p style="margin:4px 0">N° {{numero_factura}}</p><p style="margin:4px 0">Fecha: {{fecha_emision}}</p><p style="margin:4px 0">Vence: {{fecha_pago}}</p></div>\n  </div>\n  <div style="border:1px solid #ddd;padding:12px;margin-bottom:16px">\n    <p style="margin:4px 0"><strong>Cliente:</strong> {{nombre_completo}}</p>\n    <p style="margin:4px 0"><strong>DNI/RUC:</strong> {{numero_documento}}</p>\n    <p style="margin:4px 0"><strong>Dirección:</strong> {{direccion_cliente}}</p>\n  </div>\n  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">\n    <thead><tr style="background:#f3f4f6"><th style="padding:8px;border:1px solid #ddd;text-align:left">Descripción</th><th style="padding:8px;border:1px solid #ddd">Cantidad</th><th style="padding:8px;border:1px solid #ddd">Precio Unit.</th><th style="padding:8px;border:1px solid #ddd">Total</th></tr></thead>\n    <tbody><tr><td style="padding:8px;border:1px solid #ddd">Servicio Internet — {{plan_contratado}} ({{velocidad_bajada}}/{{velocidad_subida}} Mbps)</td><td style="padding:8px;border:1px solid #ddd;text-align:center">1</td><td style="padding:8px;border:1px solid #ddd;text-align:right">S/ {{subtotal}}</td><td style="padding:8px;border:1px solid #ddd;text-align:right">S/ {{subtotal}}</td></tr></tbody>\n  </table>\n  <div style="text-align:right">\n    <p>Subtotal: S/ {{subtotal}}</p>\n    <p>IGV ({{igv_porcentaje}}%): S/ {{igv_monto}}</p>\n    <p><strong>TOTAL: S/ {{monto_factura}}</strong></p>\n  </div>\n</div>',
    },
    recibo: {
      nombre: 'Recibo de Pago',
      contenido:
        '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;border:2px solid #333">\n  <h2 style="text-align:center;margin-bottom:4px">{{empresa}}</h2>\n  <p style="text-align:center;margin:0">RUC: {{empresa_ruc}}</p>\n  <hr>\n  <h3 style="text-align:center">RECIBO DE PAGO N° {{numero_factura}}</h3>\n  <table style="width:100%">\n    <tr><td><strong>Cliente:</strong></td><td>{{nombre_completo}}</td></tr>\n    <tr><td><strong>DNI/RUC:</strong></td><td>{{numero_documento}}</td></tr>\n    <tr><td><strong>Plan:</strong></td><td>{{plan_contratado}}</td></tr>\n    <tr><td><strong>Período:</strong></td><td>{{fecha_activacion}} al {{fecha_pago}}</td></tr>\n    <tr><td><strong>Monto Pagado:</strong></td><td><strong>S/ {{monto_factura}}</strong></td></tr>\n    <tr><td><strong>Fecha de Pago:</strong></td><td>{{fecha_emision}}</td></tr>\n  </table>\n  <hr>\n  <p style="text-align:center;font-size:12px">Gracias por su pago puntual</p>\n</div>',
    },
    ticket_impresion: {
      nombre: 'Ticket de Impresión (80mm)',
      contenido:
        '<div style="font-family:monospace;width:300px;padding:8px;font-size:12px">\n  <div style="text-align:center;font-weight:bold">{{empresa}}</div>\n  <div style="text-align:center">RUC: {{empresa_ruc}}</div>\n  <div style="text-align:center">{{telefono_empresa}}</div>\n  <div style="border-top:1px dashed #000;margin:6px 0"></div>\n  <div>RECIBO N°: {{numero_factura}}</div>\n  <div>Fecha: {{fecha_emision}}</div>\n  <div style="border-top:1px dashed #000;margin:6px 0"></div>\n  <div>Cliente: {{nombre_completo}}</div>\n  <div>Plan: {{plan_contratado}}</div>\n  <div style="border-top:1px dashed #000;margin:6px 0"></div>\n  <div style="display:flex;justify-content:space-between"><span>Servicio:</span><span>S/ {{subtotal}}</span></div>\n  <div style="display:flex;justify-content:space-between"><span>IGV:</span><span>S/ {{igv_monto}}</span></div>\n  <div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTAL:</span><span>S/ {{monto_factura}}</span></div>\n  <div style="border-top:1px dashed #000;margin:6px 0"></div>\n  <div style="text-align:center">¡Gracias por su preferencia!</div>\n</div>',
    },
    hoja_instalacion: {
      nombre: 'Hoja de Instalación',
      contenido:
        '<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px">\n  <div style="display:flex;justify-content:space-between;margin-bottom:20px">\n    <div><h2 style="margin:0">{{empresa}}</h2><p style="margin:4px 0">{{telefono_empresa}}</p></div>\n    <div style="text-align:right"><h3 style="margin:0">HOJA DE INSTALACIÓN</h3><p style="margin:4px 0">Fecha: {{fecha_instalacion}}</p></div>\n  </div>\n  <h4>DATOS DEL CLIENTE</h4>\n  <table style="width:100%;border-collapse:collapse">\n    <tr><td style="padding:6px;border:1px solid #ddd"><strong>Nombre:</strong></td><td style="padding:6px;border:1px solid #ddd">{{nombre_completo}}</td><td style="padding:6px;border:1px solid #ddd"><strong>DNI:</strong></td><td style="padding:6px;border:1px solid #ddd">{{numero_documento}}</td></tr>\n    <tr><td style="padding:6px;border:1px solid #ddd"><strong>Dirección:</strong></td><td colspan="3" style="padding:6px;border:1px solid #ddd">{{direccion_cliente}}</td></tr>\n    <tr><td style="padding:6px;border:1px solid #ddd"><strong>Teléfono:</strong></td><td style="padding:6px;border:1px solid #ddd">{{telefono_cliente}}</td><td style="padding:6px;border:1px solid #ddd"><strong>Plan:</strong></td><td style="padding:6px;border:1px solid #ddd">{{plan_contratado}}</td></tr>\n  </table>\n  <h4>DATOS TÉCNICOS</h4>\n  <table style="width:100%;border-collapse:collapse">\n    <tr><td style="padding:6px;border:1px solid #ddd"><strong>Usuario PPPoE:</strong></td><td style="padding:6px;border:1px solid #ddd">{{usuario_pppoe}}</td><td style="padding:6px;border:1px solid #ddd"><strong>IP Asignada:</strong></td><td style="padding:6px;border:1px solid #ddd">{{ip_asignada}}</td></tr>\n    <tr><td style="padding:6px;border:1px solid #ddd"><strong>Nodo:</strong></td><td style="padding:6px;border:1px solid #ddd">{{nodo_nombre}}</td><td style="padding:6px;border:1px solid #ddd"><strong>Router:</strong></td><td style="padding:6px;border:1px solid #ddd">{{router_nombre}}</td></tr>\n    <tr><td style="padding:6px;border:1px solid #ddd"><strong>Velocidad:</strong></td><td style="padding:6px;border:1px solid #ddd">{{velocidad_bajada}}/{{velocidad_subida}} Mbps</td><td style="padding:6px;border:1px solid #ddd"><strong>Equipo:</strong></td><td style="padding:6px;border:1px solid #ddd">{{equipo_entregado}}</td></tr>\n    <tr><td style="padding:6px;border:1px solid #ddd"><strong>N° Serie:</strong></td><td style="padding:6px;border:1px solid #ddd">{{numero_serie}}</td><td style="padding:6px;border:1px solid #ddd"><strong>Técnico:</strong></td><td style="padding:6px;border:1px solid #ddd">{{tecnico_nombre}}</td></tr>\n  </table>\n  <h4>CONFORMIDAD DEL CLIENTE</h4>\n  <div style="display:flex;gap:40px;margin-top:40px">\n    <div style="flex:1;text-align:center"><div style="border-top:1px solid #000;padding-top:4px">Firma del Cliente<br>{{nombre_completo}}</div></div>\n    <div style="flex:1;text-align:center"><div style="border-top:1px solid #000;padding-top:4px">Firma del Técnico<br>{{tecnico_nombre}}</div></div>\n  </div>\n</div>',
    },
    contrato: {
      nombre: 'Contrato de Servicio',
      contenido:
        '<div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px">\n  <h2 style="text-align:center">CONTRATO DE PRESTACIÓN DE SERVICIOS DE INTERNET</h2>\n  <p style="text-align:center">{{empresa}} — RUC: {{empresa_ruc}}</p>\n  <hr>\n  <p>Conste por el presente documento el contrato de prestación de servicios de Internet que celebran de una parte <strong>{{empresa}}</strong>, con RUC N° {{empresa_ruc}}, domiciliado en {{empresa_direccion}} (en adelante EL PROVEEDOR); y de la otra parte <strong>{{nombre_completo}}</strong>, con DNI/RUC N° {{numero_documento}}, domiciliado en {{direccion_cliente}} (en adelante EL CLIENTE).</p>\n  <h4>PRIMERA: OBJETO DEL CONTRATO</h4>\n  <p>EL PROVEEDOR se compromete a brindar al CLIENTE el servicio de acceso a Internet bajo la modalidad <strong>{{plan_contratado}}</strong>, con velocidades de <strong>{{velocidad_bajada}}/{{velocidad_subida}} Mbps</strong>.</p>\n  <h4>SEGUNDA: VIGENCIA</h4>\n  <p>El presente contrato entra en vigencia a partir del <strong>{{fecha_activacion}}</strong>.</p>\n  <h4>TERCERA: PRECIO Y FORMA DE PAGO</h4>\n  <p>El costo mensual del servicio es de <strong>S/ {{monto_factura}}</strong>. El pago se realizará hasta el día <strong>{{fecha_pago}}</strong> de cada mes.</p>\n  <h4>CUARTA: DATOS TÉCNICOS</h4>\n  <p>Usuario: {{usuario_pppoe}} | IP: {{ip_asignada}}</p>\n  <h4>QUINTA: SUSPENSIÓN DEL SERVICIO</h4>\n  <p>El incumplimiento en el pago faculta a EL PROVEEDOR a suspender el servicio sin previo aviso una vez vencida la fecha de pago.</p>\n  <div style="display:flex;gap:40px;margin-top:60px">\n    <div style="flex:1;text-align:center"><div style="border-top:1px solid #000;padding-top:4px">EL PROVEEDOR<br>{{empresa}}</div></div>\n    <div style="flex:1;text-align:center"><div style="border-top:1px solid #000;padding-top:4px">EL CLIENTE<br>{{nombre_completo}}</div></div>\n  </div>\n</div>',
    },
  },
};

export interface PlantillaDto {
  id?: string;
  tipo: TipoPlantilla;
  codigo: string;
  nombre: string;
  contenido: string;
  activo: boolean;
  esDefault: boolean;
}

@Injectable()
export class PlantillasService {
  constructor(
    @InjectRepository(PlantillaMensaje)
    private readonly repo: Repository<PlantillaMensaje>,
    @InjectRepository(PlantillaAbonado)
    private readonly abonadoRepo: Repository<PlantillaAbonado>,
  ) {}

  async listar(empresaId: string, tipo: TipoPlantilla): Promise<PlantillaDto[]> {
    const saved = await this.repo.find({ where: { empresaId, tipo } });
    const savedMap = new Map(saved.map((p) => [p.codigo, p]));
    const defaults = DEFAULTS[tipo] ?? {};

    return Object.entries(defaults).map(([codigo, def]) => {
      const db = savedMap.get(codigo);
      return {
        id: db?.id,
        tipo,
        codigo,
        nombre: db?.nombre ?? def.nombre,
        contenido: db?.contenido ?? def.contenido,
        activo: db?.activo ?? true,
        esDefault: !db,
      };
    });
  }

  async guardar(
    empresaId: string,
    tipo: TipoPlantilla,
    codigo: string,
    contenido: string,
  ): Promise<PlantillaDto> {
    const defaults = DEFAULTS[tipo] ?? {};
    const def = defaults[codigo];
    const nombre = def?.nombre ?? codigo;

    const existing = await this.repo.findOne({ where: { empresaId, tipo, codigo } });

    if (existing) {
      existing.contenido = contenido;
      await this.repo.save(existing);
      return { id: existing.id, tipo, codigo, nombre, contenido, activo: existing.activo, esDefault: false };
    }

    const nueva = this.repo.create({ empresaId, tipo, codigo, nombre, contenido, activo: true });
    await this.repo.save(nueva);
    return { id: nueva.id, tipo, codigo, nombre, contenido, activo: true, esDefault: false };
  }

  async restaurar(empresaId: string, tipo: TipoPlantilla, codigo: string): Promise<PlantillaDto> {
    const existing = await this.repo.findOne({ where: { empresaId, tipo, codigo } });
    if (existing) await this.repo.softDelete(existing.id);

    const def = DEFAULTS[tipo]?.[codigo];
    return {
      tipo,
      codigo,
      nombre: def?.nombre ?? codigo,
      contenido: def?.contenido ?? '',
      activo: true,
      esDefault: true,
    };
  }

  // ─── Plantillas Abonados ──────────────────────────────────────
  async listarAbonados(empresaId: string): Promise<PlantillaAbonado[]> {
    return this.abonadoRepo.find({ where: { empresaId }, order: { createdAt: 'ASC' } });
  }

  async crearAbonado(
    empresaId: string,
    nombre: string,
    facturacion: FacturacionConfig,
    notificaciones: NotificacionesConfig,
  ): Promise<PlantillaAbonado> {
    const nueva = this.abonadoRepo.create({ empresaId, nombre, facturacion, notificaciones });
    return this.abonadoRepo.save(nueva);
  }

  async actualizarAbonado(
    id: string,
    empresaId: string,
    nombre: string,
    facturacion: FacturacionConfig,
    notificaciones: NotificacionesConfig,
  ): Promise<PlantillaAbonado> {
    const plantilla = await this.abonadoRepo.findOne({ where: { id, empresaId } });
    if (!plantilla) throw new NotFoundException('Plantilla no encontrada');
    plantilla.nombre = nombre;
    plantilla.facturacion = facturacion;
    plantilla.notificaciones = notificaciones;
    return this.abonadoRepo.save(plantilla);
  }

  async eliminarAbonado(id: string, empresaId: string): Promise<void> {
    const plantilla = await this.abonadoRepo.findOne({ where: { id, empresaId } });
    if (!plantilla) throw new NotFoundException('Plantilla no encontrada');
    await this.abonadoRepo.softDelete(id);
  }
}
