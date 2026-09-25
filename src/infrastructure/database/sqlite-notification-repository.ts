import type { DatabaseSync } from "node:sqlite";
import type { NotificationDelivery, NotificationRepository } from "../../modules/notifications/index.js";
import type { RegionId } from "../../shared/types/identifiers.js";

export class SqliteNotificationRepository implements NotificationRepository {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}
  async save(value: NotificationDelivery): Promise<void> {
    this.database.prepare(`INSERT INTO notification_deliveries(region_id, tenant_id, appointment_id, id, kind,
      channel, destination_masked, status, provider_message_id, error_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(region_id, tenant_id, id) DO UPDATE SET status=excluded.status,
      provider_message_id=excluded.provider_message_id, error_code=excluded.error_code, updated_at=excluded.updated_at`)
      .run(this.region, value.tenantId, value.appointmentId, value.id, value.kind, value.channel,
        value.destinationMasked, value.status, value.providerMessageId ?? null, value.errorCode ?? null,
        value.createdAt, value.updatedAt);
  }
  async list(tenantId: string, appointmentId: string): Promise<NotificationDelivery[]> {
    return this.database.prepare(`SELECT id, kind, channel, destination_masked, status, provider_message_id,
      error_code, created_at, updated_at FROM notification_deliveries WHERE region_id = ? AND tenant_id = ?
      AND appointment_id = ? ORDER BY created_at`).all(this.region, tenantId, appointmentId).map((row) => {
        const value = row as Record<string, string | null>;
        return { id: value.id!, tenantId, appointmentId, kind: value.kind as NotificationDelivery["kind"], channel: "EMAIL" as const,
          destinationMasked: value.destination_masked!, status: value.status as NotificationDelivery["status"],
          ...(value.provider_message_id ? { providerMessageId: value.provider_message_id } : {}),
          ...(value.error_code ? { errorCode: value.error_code } : {}), createdAt: value.created_at!, updatedAt: value.updated_at! };
      });
  }
}
