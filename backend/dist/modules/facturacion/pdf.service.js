"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PdfService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const factura_entity_1 = require("../entities/factura.entity");
let PdfService = PdfService_1 = class PdfService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(PdfService_1.name);
        this.colors = {
            primary: '#1E3A5F',
            secondary: '#2563EB',
            accent: '#10B981',
            danger: '#EF4444',
            text: '#1F2937',
            textLight: '#6B7280',
            border: '#E5E7EB',
            bgHeader: '#F3F4F6',
            bgStripe: '#F9FAFB',
            white: '#FFFFFF',
        };
        this.uploadDir = config.get('app.uploadDir', '/app/uploads');
    }
    async generarFacturaPdf(factura, empresa, cliente) {
        const dir = path.join(this.uploadDir, 'facturas', factura.empresaId);
        const filename = `${factura.serie}-${String(factura.correlativo).padStart(8, '0')}.pdf`;
        const filepath = path.join(dir, filename);
        await fs.promises.mkdir(dir, { recursive: true });
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 40, bottom: 40, left: 40, right: 40 },
                info: {
                    Title: `${factura.tipoComprobante.toUpperCase()} ${factura.numeroCompleto}`,
                    Author: empresa.razonSocial,
                    Subject: 'Comprobante de pago — Servicio de internet',
                    Creator: 'FibraNet ISP ERP',
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
            }
            catch (err) {
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
    drawHeader(doc, factura, empresa) {
        const pageW = doc.page.width;
        const m = 40;
        doc.rect(0, 0, pageW, 8).fill(this.colors.primary);
        doc.y = 28;
        doc.x = m;
        if (empresa.logoUrl && fs.existsSync(empresa.logoUrl)) {
            try {
                doc.image(empresa.logoUrl, m, 20, { width: 80, height: 50, fit: [80, 50] });
                doc.x = m + 95;
                doc.y = 20;
            }
            catch { }
        }
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
        const boxX = pageW - 200;
        const boxY = 18;
        const boxW = 165;
        const boxH = 90;
        doc.rect(boxX, boxY, boxW, boxH)
            .fillAndStroke(this.colors.bgHeader, this.colors.primary);
        const tipoLabel = this.getTipoLabel(factura.tipoComprobante);
        doc.fontSize(11)
            .fillColor(this.colors.primary)
            .font('Helvetica-Bold')
            .text(tipoLabel, boxX, boxY + 12, { width: boxW, align: 'center' });
        doc.fontSize(14)
            .fillColor(this.colors.primary)
            .font('Helvetica-Bold')
            .text(factura.numeroCompleto || `${factura.serie}-${String(factura.correlativo).padStart(8, '0')}`, boxX, boxY + 32, { width: boxW, align: 'center' });
        doc.rect(boxX + 15, boxY + 55, boxW - 30, 0.5)
            .fillColor(this.colors.border);
        doc.fontSize(8)
            .fillColor(this.colors.textLight)
            .font('Helvetica')
            .text(`RUC: ${empresa.ruc}`, boxX, boxY + 62, { width: boxW, align: 'center' });
        doc.y = 125;
        doc.rect(m, doc.y, pageW - m * 2, 1).fill(this.colors.border);
        doc.y += 12;
    }
    drawBadgeEstado(doc, factura) {
        const badgeColors = {
            pagada: '#10B981',
            anulada: '#EF4444',
            vencida: '#F59E0B',
            pagada_parcial: '#3B82F6',
            en_cobranza: '#8B5CF6',
        };
        const color = badgeColors[factura.estado];
        if (!color)
            return;
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
    drawDatosCliente(doc, factura, cliente) {
        const m = 40;
        const pageW = doc.page.width;
        const colW = (pageW - m * 2 - 10) / 2;
        const startY = doc.y;
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
    drawTablaItems(doc, factura) {
        const m = 40;
        const pageW = doc.page.width;
        const tableW = pageW - m * 2;
        const cols = {
            num: 30,
            desc: tableW - 30 - 50 - 70 - 70 - 70,
            cant: 50,
            pu: 70,
            desc2: 70,
            total: 70,
        };
        const headerY = doc.y;
        const headerH = 22;
        doc.rect(m, headerY, tableW, headerH).fill(this.colors.primary);
        const headers = [
            { text: '#', x: m, w: cols.num, align: 'center' },
            { text: 'DESCRIPCIÓN', x: m + cols.num, w: cols.desc, align: 'left' },
            { text: 'CANT', x: m + cols.num + cols.desc, w: cols.cant, align: 'center' },
            { text: 'P.UNIT', x: m + cols.num + cols.desc + cols.cant, w: cols.pu, align: 'right' },
            { text: 'DSCTO', x: m + cols.num + cols.desc + cols.cant + cols.pu, w: cols.desc2, align: 'right' },
            { text: 'TOTAL', x: m + cols.num + cols.desc + cols.cant + cols.pu + cols.desc2, w: cols.total, align: 'right' },
        ];
        for (const h of headers) {
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor(this.colors.white)
                .text(h.text, h.x + 4, headerY + 7, { width: h.w - 8, align: h.align });
        }
        doc.y = headerY + headerH;
        const items = factura.items?.length
            ? factura.items
            : [{ descripcion: factura.descripcion, cantidad: 1, precioUnitario: Number(factura.subtotal), descuento: 0, subtotal: Number(factura.subtotal) }];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const rowH = 20;
            const rowY = doc.y;
            const bgColor = i % 2 === 0 ? this.colors.white : this.colors.bgStripe;
            doc.rect(m, rowY, tableW, rowH).fill(bgColor);
            doc.rect(m, rowY + rowH - 0.5, tableW, 0.5).fill(this.colors.border);
            const rowData = [
                { text: String(i + 1), x: m, w: cols.num, align: 'center' },
                { text: item.descripcion, x: m + cols.num, w: cols.desc, align: 'left' },
                { text: String(item.cantidad), x: m + cols.num + cols.desc, w: cols.cant, align: 'center' },
                { text: this.formatMoney(item.precioUnitario), x: m + cols.num + cols.desc + cols.cant, w: cols.pu, align: 'right' },
                { text: this.formatMoney(item.descuento || 0), x: m + cols.num + cols.desc + cols.cant + cols.pu, w: cols.desc2, align: 'right' },
                { text: this.formatMoney(item.subtotal), x: m + cols.num + cols.desc + cols.cant + cols.pu + cols.desc2, w: cols.total, align: 'right' },
            ];
            for (const cell of rowData) {
                doc.fontSize(7.5).font('Helvetica').fillColor(this.colors.text)
                    .text(cell.text, cell.x + 4, rowY + 6, { width: cell.w - 8, align: cell.align, lineBreak: false });
            }
            doc.y = rowY + rowH;
        }
        doc.rect(m, doc.y, tableW, 1).fill(this.colors.primary);
        doc.y += 14;
    }
    drawTotales(doc, factura) {
        const m = 40;
        const pageW = doc.page.width;
        const boxW = 200;
        const boxX = pageW - m - boxW;
        let rowY = doc.y;
        const rowH = 18;
        const labelW = 110;
        const valueW = boxW - labelW;
        const rows = [
            { label: 'Subtotal:', value: this.formatMoney(factura.subtotal) },
        ];
        if (Number(factura.descuento) > 0) {
            rows.push({ label: 'Descuento:', value: `– ${this.formatMoney(factura.descuento)}`, color: this.colors.danger });
        }
        if (Number(factura.igv) > 0) {
            rows.push({ label: 'Op. Gravadas:', value: this.formatMoney(Number(factura.subtotal) - Number(factura.descuento)) });
            rows.push({ label: 'IGV (18%):', value: this.formatMoney(factura.igv) });
        }
        else {
            rows.push({ label: 'Exonerado:', value: this.formatMoney(factura.total) });
        }
        rows.push({
            label: 'TOTAL A PAGAR:',
            value: `${factura.moneda || 'S/'} ${this.formatMoney(factura.total)}`,
            bold: true,
        });
        if (Number(factura.montoPagado) > 0 && factura.estado !== factura_entity_1.EstadoFactura.PAGADA) {
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
    drawPieDocumento(doc, factura, empresa) {
        const m = 40;
        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const montoLetras = this.montoALetras(Number(factura.total));
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(this.colors.textLight)
            .text('SON: ', m, doc.y, { continued: true })
            .font('Helvetica')
            .text(montoLetras.toUpperCase() + ` ${factura.moneda || 'SOLES'}`, { width: pageW - m * 2 - 120 });
        doc.y += 10;
        doc.fontSize(7).fillColor(this.colors.textLight)
            .text(`Vence el: ${this.formatDate(factura.fechaVencimiento)} · Forma de pago: Transferencia / Yape / Plin`, m);
        doc.y += 8;
        doc.rect(m, doc.y, pageW - m * 2, 0.5).fill(this.colors.border);
        doc.y += 8;
        const footerY = pageH - 45;
        doc.rect(0, footerY - 5, pageW, 1).fill(this.colors.primary);
        doc.fontSize(6.5).fillColor(this.colors.textLight).font('Helvetica')
            .text(`${empresa.razonSocial} · RUC ${empresa.ruc} · ${empresa.direccionFiscal || ''} · ${empresa.email || ''} · ${empresa.telefono || ''}`, m, footerY + 2, { width: pageW - m * 2, align: 'center' });
        doc.fontSize(6).fillColor(this.colors.textLight)
            .text('Representación impresa del Comprobante de Pago Electrónico · Generado por FibraNet ISP ERP', m, footerY + 14, { width: pageW - m * 2, align: 'center' });
        doc.fontSize(6.5).fillColor(this.colors.textLight)
            .text(`Página 1 de 1`, m, footerY + 26, { width: pageW - m * 2, align: 'right' });
    }
    drawQr(doc, factura) {
        const qrData = `${factura.serie}|${factura.correlativo}|${factura.igv}|${factura.total}`;
        const pageW = doc.page.width;
        const m = 40;
        const qrSize = 60;
        const qrX = pageW - m - qrSize;
        doc.rect(qrX, doc.y - 90, qrSize, qrSize).fillAndStroke(this.colors.bgStripe, this.colors.border);
        doc.fontSize(5).fillColor(this.colors.textLight)
            .text('Código QR\nSUNAT', qrX, doc.y - 70, { width: qrSize, align: 'center' });
    }
    drawWatermark(doc, factura) {
        if (factura.estado !== factura_entity_1.EstadoFactura.ANULADA)
            return;
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
    getTipoLabel(tipo) {
        const labels = {
            [factura_entity_1.TipoComprobante.BOLETA]: 'BOLETA DE VENTA ELECTRÓNICA',
            [factura_entity_1.TipoComprobante.FACTURA]: 'FACTURA ELECTRÓNICA',
            [factura_entity_1.TipoComprobante.NOTA_CREDITO]: 'NOTA DE CRÉDITO ELECTRÓNICA',
            [factura_entity_1.TipoComprobante.NOTA_DEBITO]: 'NOTA DE DÉBITO ELECTRÓNICA',
            [factura_entity_1.TipoComprobante.RECIBO_INTERNO]: 'RECIBO INTERNO',
        };
        return labels[tipo] || tipo.toUpperCase();
    }
    formatDate(dateStr) {
        if (!dateStr)
            return '—';
        try {
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('es-PE', {
                day: '2-digit', month: '2-digit', year: 'numeric',
            });
        }
        catch {
            return dateStr;
        }
    }
    formatMoney(amount) {
        const n = Number(amount || 0);
        return n.toLocaleString('es-PE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }
    montoALetras(monto) {
        const entero = Math.floor(monto);
        const centavos = Math.round((monto - entero) * 100);
        const centStr = centavos > 0 ? ` CON ${String(centavos).padStart(2, '0')}/100` : ' CON 00/100';
        return `${this.numeroALetras(entero)}${centStr}`;
    }
    numeroALetras(n) {
        if (n === 0)
            return 'CERO';
        const unidades = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
            'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE',
            'DIECIOCHO', 'DIECINUEVE'];
        const decenas = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
        const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
            'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
        if (n === 100)
            return 'CIEN';
        if (n < 20)
            return unidades[n];
        if (n < 100)
            return decenas[Math.floor(n / 10)] + (n % 10 ? ' Y ' + unidades[n % 10] : '');
        if (n < 1000)
            return centenas[Math.floor(n / 100)] + (n % 100 ? ' ' + this.numeroALetras(n % 100) : '');
        if (n < 2000)
            return 'MIL' + (n % 1000 ? ' ' + this.numeroALetras(n % 1000) : '');
        if (n < 1000000)
            return this.numeroALetras(Math.floor(n / 1000)) + ' MIL' + (n % 1000 ? ' ' + this.numeroALetras(n % 1000) : '');
        return String(n);
    }
};
exports.PdfService = PdfService;
exports.PdfService = PdfService = PdfService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PdfService);
//# sourceMappingURL=pdf.service.js.map