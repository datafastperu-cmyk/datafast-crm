import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }  from '@nestjs/typeorm';
import { DataSource }        from 'typeorm';

// ── Mapeo de status de AutomatizadoVIP → nuestro enum ────────────
// Payload: { event: 'messages.update', data: { id, status } }
// Ack numérico (formato legacy Baileys): ack 2 = DELIVERY_ACK, 3 = READ
const STATUS_MAP: Record<string, string> = {
  DELIVERY_ACK: 'ENTREGADO',
  DELIVERED:    'ENTREGADO',
  READ:         'LEIDO',
  // ack numérico
  '2': 'ENTREGADO',
  '3': 'LEIDO',
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async handleWhatsAppStatus(payload: unknown): Promise<void> {
    const { messageId, newStatus } = this.parsePayload(payload);

    if (!messageId || !newStatus) {
      this.logger.debug(`Webhook ignorado — sin messageId/status extraíble`);
      return;
    }

    // UPDATE usando el índice idx_notif_logs_meta_msg_id
    // La condición extra evita escrituras redundantes (mismo estado ya guardado)
    const result = await this.db.query<{ rowCount: number }>(
      `UPDATE notificaciones_logs
          SET estado_entrega = $1
        WHERE meta_message_id = $2
          AND estado_entrega != $1
          AND estado_entrega != 'FALLIDO'`,
      [newStatus, messageId],
    );

    const affected = Array.isArray(result) ? 0 : (result as any).rowCount ?? 0;
    this.logger.log(
      `Webhook tracking: msgId=${messageId} → ${newStatus} (filas: ${affected})`,
    );
  }

  // ── Parser flexible para AutomatizadoVIP ─────────────────────
  // Soporta:
  //   { event: 'messages.update', data: { id, status } }          ← principal
  //   { event: 'message.ack',     data: { id: { _serialized }, ack } }
  //   { event: '...', data: { updates: [{ id, status }] } }
  private parsePayload(raw: unknown): {
    messageId: string | null;
    newStatus:  string | null;
  } {
    if (!raw || typeof raw !== 'object') return { messageId: null, newStatus: null };

    const p = raw as Record<string, any>;

    let messageId: string | null = null;
    let rawStatus: string | null = null;

    const data = p['data'] ?? {};

    // Formato 1: data.id directo + data.status
    if (typeof data['id'] === 'string') {
      messageId = data['id'];
      rawStatus = String(data['status'] ?? data['ack'] ?? '');
    }

    // Formato 2: data.id es objeto con _serialized (Baileys legacy)
    if (!messageId && typeof data['id']?.['_serialized'] === 'string') {
      messageId = data['id']['_serialized'];
      rawStatus = String(data['ack'] ?? data['status'] ?? '');
    }

    // Formato 3: data.updates es array
    if (!messageId && Array.isArray(data['updates']) && data['updates'].length > 0) {
      const upd = data['updates'][0] as Record<string, any>;
      messageId = typeof upd['id'] === 'string' ? upd['id'] : (upd['id']?.['_serialized'] ?? null);
      rawStatus = String(upd['status'] ?? upd['ack'] ?? '');
    }

    // Fallback: top-level id/status
    if (!messageId) messageId = typeof p['id'] === 'string' ? p['id'] : null;
    if (!rawStatus) rawStatus = String(p['status'] ?? p['ack'] ?? '');

    const newStatus = rawStatus ? (STATUS_MAP[rawStatus.toUpperCase()] ?? STATUS_MAP[rawStatus] ?? null) : null;

    return { messageId, newStatus };
  }
}
