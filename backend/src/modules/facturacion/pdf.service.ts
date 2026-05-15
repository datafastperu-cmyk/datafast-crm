import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as PDFDocument from 'pdfkit';
import { Factura, TipoComprobante, EstadoFactura } from './entities/factura.entity';

// ─── Datos de la empresa para el PDF ─────────────────────────
export interface EmpresaPdfData {
  razonSocial:      string;
  ruc:              string;
  direccionFiscal?: string;
  telefono?:        string;
  email?:           string;
  logoUrl?:         string;
}

// ─── Datos del cliente para el PDF ───────────────────────────
export interface ClientePdfData {
  nombreCompleto:  string;
  tipoDocumento:   string;
  numeroDocumento: string;
  direccion?:      string;
  email?:          string;
  telefono?:       string;
  esEmpresa?:      boolean;
  rucEmpresa?:     string;
  razonSocial?:    string;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly uploadDir: string;

  // ── Paleta de colores del documento ──────────────────────
  private readonly colors = {
    primary:      '#1E3A5F',   // Azul marino corporativo
    secondary:    '#2563EB',   // Azul acción
    accent:       '#10B981',   // Verde éxito (pagada)
    danger:       '#EF4444',   // Rojo (anulada/vencida)
    text:         '#1F2937',   // Texto principal
    textLight:    '#6B7280',   // Texto secundario
    border:       '#E5E7EB',   // Bordes
    bgHeader:     '#F3F4F6',   // Fondo header de tabla
    bgStripe:     '#F9FAFB',   // Fondo filas alternadas
    white:        '#FFFFFF',
  };

  constructor(private readonly config: ConfigService) {
    this.uploadDir = config.get<string>('app.uploadDir', '/app/uploads');
  }

  // ── Generar PDF de factura ────────────────────────────────
  async generarFacturaPdf(
    factura: Factura,
    empresa: EmpresaPdfData,
    cliente: ClientePdfData,
  ): Promise<string> {
    const dir      = path.join(this.uploadDir, 'facturas', factura.empresaId);
    const filename = `${factura.serie}-${String(factura.correlativo).padStart(8, '0')}.pdf`;
    const filepath = path.join(dir, filename);

    // Crear directorio si no existe
    await fs.promises.mkdir(dir, { recursive: true });

    return new Promise<string>((resolve, reject) => {
      const doc = new PDFDocument({
        size:    'A4',
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
        info: {
          Title:    `${factura.tipoComprobante.toUpperCase()} ${factura.numeroCompleto}`,
          Author:   empresa.razonSocial,
          Subject:  'Comprobante de pago — Servicio de internet',
          Creator:  'CRM ISP DATAFAST',
        },
      });

      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      try {
        this.drawHeader(doc, factura, empresa);
        this.drawBadgeEstado(doc, factura);
        this.drawDatosCliente(doc, factura, cliente);
        this.drawTablaItems(doc, factura);
        this.drawTotales(doc, factura);
        this.drawPieDocumento(doc, factura, empresa);
        this.drawQr(doc, factura);
        this.drawWatermark(doc, factura);
      } catch (err) {
        reject(err);
        return;
      }

      doc.end();

      stream.on('finish', () => {
        const urlPath = `/uploads/facturas/${factura.empresaId}/${filename}`;
        this.logger.log(`PDF generado: ${urlPath}`);
        resolve(urlPath);
      });

      stream.on('error', reject);
    });
  }

  // ── HEADER ───────────────────────────────────────────────
  private drawHeader(doc: PDFKit.PDFDocument, factura: Factura, empresa: EmpresaPdfData) {
    const pageW = doc.page.width;
    const m     = 40;

    // Franja de color superior
    doc.rect(0, 0, pageW, 8).fill(this.colors.primary);

    // ── Logo / Nombre empresa (izquierda) ─────────────────
    doc.y = 28;
    doc.x = m;

    if (empresa.logoUrl && fs.existsSync(empresa.logoUrl)) {
      try {
        doc.image(empresa.logoUrl, m, 20, { width: 80, height: 50, fit: [80, 50] });
        doc.x = m + 95;
        doc.y = 20;
      } catch { /* si el logo falla, continuar sin él */ }
    }

    // Nombre empresa
    doc.fontSize(15)
      .fillColor(this.colors.primary)
      .font('Helvetica-Bold')
      .text(empresa.razonSocial, { continued: false });

    doc.fontSize(8)
      .fillColor(this.colors.textLight)
      .font('Helvetica')
      .text(`RUC: ${empresa.ruc}`)
      .text(empresa.direccionFiscal || '')
      .text([empresa.telefono, empresa.email].filter(Boolean).join('  |  '));

    // ── Cuadro comprobante (derecha) ─────────────────────
    const boxX = pageW - 200;
    const boxY = 18;
    const boxW = 165;
    const boxH = 90;

    doc.rect(boxX, boxY, boxW, boxH)
      .fillAndStroke(this.colors.bgHeader, this.colors.primary);

    // Tipo de comprobante
    const tipoLabel = this.getTipoLabel(factura.tipoComprobante);
    doc.fontSize(11)
      .fillColor(this.colors.primary)
      .font('Helvetica-Bold')
      .text(tipoLabel, boxX, boxY + 12, { width: boxW, align: 'center' });

    // Número
    doc.fontSize(14)
      .fillColor(this.colors.primary)
      .font('Helvetica-Bold')
      .text(factura.numeroCompleto || `${factura.serie}-${String(factura.correlativo).padStart(8, '0')}`,
        boxX, boxY + 32, { width: boxW, align: 'center' });

    // Línea divisora
    doc.rect(boxX + 15, boxY + 55, boxW - 30, 0.5)
      .fillColor(this.colors.border);

    // RUC empresa
    doc.fontSize(8)
      .fillColor(this.colors.textLight)
      .font('Helvetica')
      .text(`RUC: ${empresa.ruc}`, boxX, boxY + 62, { width: boxW, align: 'center' });

    // Línea separadora horizontal
    doc.y = 125;
    doc.rect(m, doc.y, pageW - m * 2, 1).fill(this.colors.border);
    doc.y += 12;
  }

  // ── BADGE DE ESTADO ───────────────────────────────────────
  private drawBadgeEstado(doc: PDFKit.PDFDocument, factura: Factura) {
    const badgeColors: Record<string, string> = {
      pagada:         '#10B981',
      anulada:        '#EF4444',
      vencida:        '#F59E0B',
      pagada_parcial: '#3B82F6',
      en_cobranza:    '#8B5CF6',
    };
    const color = badgeColors[factura.estado];
    if (!color) return;

    const label = factura.estado.replace('_', ' ').toUpperCase();
    const pageW = doc.page.width;
    const bW = 90, bH = 20;
    const bX = pageW - 40 - bW;
    const bY = doc.y - 8;

    doc.rect(bX, bY, bW, bH).fill(color);
    doc.fontSize(8)
      .fillColor(this.colors.white)
      .font('Helvetica-Bold')
      .text(label, bX, bY + 5, { width: bW, align: 'center' });
  }

  // ── DATOS DEL CLIENTE ─────────────────────────────────────
  private drawDatosCliente(
    doc: PDFKit.PDFDocument,
    factura: Factura,
    cliente: ClientePdfData,
  ) {
    const m     = 40;
    const pageW = doc.page.width;
    const colW  = (pageW - m * 2 - 10) / 2;
    const startY = doc.y;

    // ── Columna izquierda: Datos cliente ─────────────────
    doc.fontSize(8).font('Helvetica-Bold').fillColor(this.colors.textLight)
      .text('CLIENTE / RECEPTOR', m, startY);
    doc.y += 4;

    const docLabel = cliente.tipoDocumento?.toUpperCase() === 'RUC' ? 'RUC' : 'DNI';

    const clienteRows = [
      ['Razón Social / Nombre:', cliente.esEmpresa ? (cliente.razonSocial || cliente.nombreCompleto) : cliente.nombreCompleto],
      [`${docLabel}:`, cliente.esEmpresa ? (cliente.rucEmpresa || '') : cliente.numeroDocumento],
      ['Dirección:', cliente.direccion || '—'],
      ['Teléfono:', cliente.telefono || '—'],
    ];

    for (const [label, value] of clienteRows) {
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(this.colors.textLight)
        .text(label, m, doc.y, { continued: true, width: 90 });
      doc.font('Helvetica').fillColor(this.colors.text)
        .text(` ${value}`, { width: colW - 90 });
    }

    // ── Columna derecha: Datos del documento ─────────────
    const rightX = m + colW + 10;
    doc.y = startY;

    doc.fontSize(8).font('Helvetica-Bold').fillColor(this.colors.textLight)
      .text('DATOS DEL COMPROBANTE', rightX, startY);
    doc.y += 4;

    const docRows = [
      ['Fecha de emisión:', this.formatDate(factura.fechaEmision)],
      ['Fecha de vencimiento:', this.formatDate(factura.fechaVencimiento)],
      ['Periodo:', `${this.formatDate(factura.periodoInicio)} al ${this.formatDate(factura.periodoFin)}`],
      ['Moneda:', factura.moneda || 'PEN'],
    ];

    for (const [label, value] of docRows) {
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(this.colors.textLight)
        .text(label, rightX, doc.y, { continued: true, width: 90 });
      doc.font('Helvetica').fillColor(this.colors.text)
        .text(` ${value}`, { width: colW - 90 });
    }

    doc.y += 16;
    doc.rect(m, doc.y, pageW - m * 2, 1).fill(this.colors.border);
    doc.y += 12;
  }

  // ── TABLA DE ITEMS ────────────────────────────────────────
  private drawTablaItems(doc: PDFKit.PDFDocument, factura: Factura) {
    const m     = 40;
    const pageW = doc.page.width;
    const tableW = pageW - m * 2;

    // Anchos de columnas
    const cols = {
      num:   30,
      desc:  tableW - 30 - 50 - 70 - 70 - 70,
      cant:  50,
      pu:    70,
      desc2: 70,
      total: 70,
    };

    const headerY = doc.y;
    const headerH = 22;

    // Fondo del header
    doc.rect(m, headerY, tableW, headerH).fill(this.colors.primary);

    // Headers
    const headers = [
      { text: '#',      x: m,                              w: cols.num,  align: 'center' },
      { text: 'DESCRIPCIÓN', x: m + cols.num,              w: cols.desc, align: 'left' },
      { text: 'CANT',   x: m + cols.num + cols.desc,       w: cols.cant, align: 'center' },
      { text: 'P.UNIT', x: m + cols.num + cols.desc + cols.cant, w: cols.pu, align: 'right' },
      { text: 'DSCTO',  x: m + cols.num + cols.desc + cols.cant + cols.pu, w: cols.desc2, align: 'right' },
      { text: 'TOTAL',  x: m + cols.num + cols.desc + cols.cant + cols.pu + cols.desc2, w: cols.total, align: 'right' },
    ];

    for (const h of headers) {
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(this.colors.white)
        .text(h.text, h.x + 4, headerY + 7, { width: h.w - 8, align: h.align as any });
    }

    doc.y = headerY + headerH;

    // Items
    const items = factura.items?.length
      ? factura.items
      : [{ descripcion: factura.descripcion, cantidad: 1, precioUnitario: Number(factura.subtotal), descuento: 0, subtotal: Number(factura.subtotal) }];

    for (let i = 0; i < items.length; i++) {
      const item    = items[i];
      const rowH    = 20;
      const rowY    = doc.y;
      const bgColor = i % 2 === 0 ? this.colors.white : this.colors.bgStripe;

      doc.rect(m, rowY, tableW, rowH).fill(bgColor);

      // Borde inferior de la fila
      doc.rect(m, rowY + rowH - 0.5, tableW, 0.5).fill(this.colors.border);

      const rowData = [
        { text: String(i + 1),                               x: m,                              w: cols.num,  align: 'center' },
        { text: item.descripcion,                            x: m + cols.num,                   w: cols.desc, align: 'left' },
        { text: String(item.cantidad),                       x: m + cols.num + cols.desc,       w: cols.cant, align: 'center' },
        { text: this.formatMoney(item.precioUnitario),       x: m + cols.num + cols.desc + cols.cant, w: cols.pu, align: 'right' },
        { text: this.formatMoney(item.descuento || 0),       x: m + cols.num + cols.desc + cols.cant + cols.pu, w: cols.desc2, align: 'right' },
        { text: this.formatMoney(item.subtotal),             x: m + cols.num + cols.desc + cols.cant + cols.pu + cols.desc2, w: cols.total, align: 'right' },
      ];

      for (const cell of rowData) {
        doc.fontSize(7.5).font('Helvetica').fillColor(this.colors.text)
          .text(cell.text, cell.x + 4, rowY + 6, { width: cell.w - 8, align: cell.align as any, lineBreak: false });
      }

      doc.y = rowY + rowH;
    }

    // Borde inferior de la tabla
    doc.rect(m, doc.y, tableW, 1).fill(this.colors.primary);
    doc.y += 14;
  }

  // ── TOTALES ───────────────────────────────────────────────
  private drawTotales(doc: PDFKit.PDFDocument, factura: Factura) {
    const m      = 40;
    const pageW  = doc.page.width;
    const boxW   = 200;
    const boxX   = pageW - m - boxW;
    let   rowY   = doc.y;
    const rowH   = 18;
    const labelW = 110;
    const valueW = boxW - labelW;

    const rows: Array<{ label: string; value: string; bold?: boolean; color?: string }> = [
      { label: 'Subtotal:',       value: this.formatMoney(factura.subtotal) },
    ];

    if (Number(factura.descuento) > 0) {
      rows.push({ label: 'Descuento:', value: `– ${this.formatMoney(factura.descuento)}`, color: this.colors.danger });
    }

    if (Number(factura.igv) > 0) {
      rows.push({ label: 'Op. Gravadas:', value: this.formatMoney(Number(factura.subtotal) - Number(factura.descuento)) });
      rows.push({ label: 'IGV (18%):', value: this.formatMoney(factura.igv) });
    } else {
      rows.push({ label: 'Exonerado:', value: this.formatMoney(factura.total) });
    }

    rows.push({
      label: 'TOTAL A PAGAR:',
      value: `${factura.moneda || 'S/'} ${this.formatMoney(factura.total)}`,
      bold: true,
    });

    if (Number(factura.montoPagado) > 0 && factura.estado !== EstadoFactura.PAGADA) {
      rows.push({ label: 'Abono recibido:', value: this.formatMoney(factura.montoPagado), color: this.colors.accent });
      rows.push({ label: 'SALDO PENDIENTE:', value: this.formatMoney(Number(factura.total) - Number(factura.montoPagado)), bold: true, color: this.colors.danger });
    }

    for (const row of rows) {
      const isTotalRow = row.label === 'TOTAL A PAGAR:';
      const bg = isTotalRow ? this.colors.primary : (rowY % 2 === 0 ? this.colors.bgStripe : this.colors.white);

      doc.rect(boxX, rowY, boxW, rowH).fill(bg);

      const textColor = isTotalRow ? this.colors.white : (row.color || this.colors.text);
      const font = (isTotalRow || row.bold) ? 'Helvetica-Bold' : 'Helvetica';

      doc.fontSize(8).font(font).fillColor(textColor)
        .text(row.label, boxX + 6, rowY + 5, { width: labelW - 6, align: 'left' });
      doc.fontSize(8).font(font).fillColor(isTotalRow ? this.colors.white : (row.color || this.colors.text))
        .text(row.value, boxX + labelW, rowY + 5, { width: valueW - 6, align: 'right' });

      rowY += rowH;
    }

    doc.y = rowY + 14;
  }

  // ── PIE DEL DOCUMENTO ─────────────────────────────────────
  private drawPieDocumento(
    doc: PDFKit.PDFDocument,
    factura: Factura,
    empresa: EmpresaPdfData,
  ) {
    const m     = 40;
    const pageW = doc.page.width;
    const pageH = doc.page.height;

    // Leyenda son de cálculo
    const montoLetras = this.montoALetras(Number(factura.total));
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(this.colors.textLight)
      .text('SON: ', m, doc.y, { continued: true })
      .font('Helvetica')
      .text(montoLetras.toUpperCase() + ` ${factura.moneda || 'SOLES'}`, { width: pageW - m * 2 - 120 });

    doc.y += 10;

    // Condiciones de pago
    doc.fontSize(7).fillColor(this.colors.textLight)
      .text(`Vence el: ${this.formatDate(factura.fechaVencimiento)} · Forma de pago: Transferencia / Yape / Plin`, m);

    // Línea divisora
    doc.y += 8;
    doc.rect(m, doc.y, pageW - m * 2, 0.5).fill(this.colors.border);
    doc.y += 8;

    // Pie: info empresa
    const footerY = pageH - 45;
    doc.rect(0, footerY - 5, pageW, 1).fill(this.colors.primary);

    doc.fontSize(6.5).fillColor(this.colors.textLight).font('Helvetica')
      .text(
        `${empresa.razonSocial} · RUC ${empresa.ruc} · ${empresa.direccionFiscal || ''} · ${empresa.email || ''} · ${empresa.telefono || ''}`,
        m, footerY + 2,
        { width: pageW - m * 2, align: 'center' },
      );

    doc.fontSize(6).fillColor(this.colors.textLight)
      .text(
        'Representación impresa del Comprobante de Pago Electrónico · Generado por CRM ISP DATAFAST',
        m, footerY + 14,
        { width: pageW - m * 2, align: 'center' },
      );

    // Número de página
    doc.fontSize(6.5).fillColor(this.colors.textLight)
      .text(`Página 1 de 1`, m, footerY + 26, { width: pageW - m * 2, align: 'right' });
  }

  // ── QR CODE (placeholder — integrar con qrcode lib) ───────
  private drawQr(doc: PDFKit.PDFDocument, factura: Factura) {
    // Placeholder de QR: en producción usar la lib 'qrcode'
    // El QR debe contener el hash SUNAT del comprobante
    const qrData = `${factura.serie}|${factura.correlativo}|${factura.igv}|${factura.total}`;
    const pageW  = doc.page.width;
    const m      = 40;
    const qrSize = 60;
    const qrX    = pageW - m - qrSize;

    // Cuadro QR (gris claro como placeholder)
    doc.rect(qrX, doc.y - 90, qrSize, qrSize).fillAndStroke(this.colors.bgStripe, this.colors.border);
    doc.fontSize(5).fillColor(this.colors.textLight)
      .text('Código QR\nSUNAT', qrX, doc.y - 70, { width: qrSize, align: 'center' });
  }

  // ── WATERMARK para documentos anulados ────────────────────
  private drawWatermark(doc: PDFKit.PDFDocument, factura: Factura) {
    if (factura.estado !== EstadoFactura.ANULADA) return;

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    doc.save();
    doc.opacity(0.08);
    doc.fontSize(72)
      .font('Helvetica-Bold')
      .fillColor(this.colors.danger)
      .rotate(-45, { origin: [pageW / 2, pageH / 2] })
      .text('ANULADO', 0, pageH / 2 - 40, { width: pageW, align: 'center' });
    doc.restore();
  }

  // ── UTILS ─────────────────────────────────────────────────
  private getTipoLabel(tipo: TipoComprobante): string {
    const labels: Record<TipoComprobante, string> = {
      [TipoComprobante.BOLETA]:         'BOLETA DE VENTA ELECTRÓNICA',
      [TipoComprobante.FACTURA]:        'FACTURA ELECTRÓNICA',
      [TipoComprobante.NOTA_CREDITO]:   'NOTA DE CRÉDITO ELECTRÓNICA',
      [TipoComprobante.NOTA_DEBITO]:    'NOTA DE DÉBITO ELECTRÓNICA',
      [TipoComprobante.RECIBO_INTERNO]: 'RECIBO INTERNO',
    };
    return labels[tipo] || tipo.toUpperCase();
  }

  private formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch { return dateStr; }
  }

  private formatMoney(amount: number | string | null | undefined): string {
    const n = Number(amount || 0);
    return n.toLocaleString('es-PE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // Conversión básica de monto a letras (en español)
  private montoALetras(monto: number): string {
    const entero   = Math.floor(monto);
    const centavos = Math.round((monto - entero) * 100);
    const centStr  = centavos > 0 ? ` CON ${String(centavos).padStart(2, '0')}/100` : ' CON 00/100';
    return `${this.numeroALetras(entero)}${centStr}`;
  }

  private numeroALetras(n: number): string {
    if (n === 0) return 'CERO';
    const unidades = ['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE',
                      'DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE',
                      'DIECIOCHO','DIECINUEVE'];
    const decenas  = ['','','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
    const centenas = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS',
                      'SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
    if (n === 100) return 'CIEN';
    if (n < 20)    return unidades[n];
    if (n < 100)   return decenas[Math.floor(n/10)] + (n%10 ? ' Y ' + unidades[n%10] : '');
    if (n < 1000)  return centenas[Math.floor(n/100)] + (n%100 ? ' ' + this.numeroALetras(n%100) : '');
    if (n < 2000)  return 'MIL' + (n%1000 ? ' ' + this.numeroALetras(n%1000) : '');
    if (n < 1000000) return this.numeroALetras(Math.floor(n/1000)) + ' MIL' + (n%1000 ? ' ' + this.numeroALetras(n%1000) : '');
    return String(n);
  }
}
