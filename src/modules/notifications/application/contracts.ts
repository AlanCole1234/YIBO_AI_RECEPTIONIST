import type { Appointment } from "../../appointments/index.js";

export type NotificationKind = "CONFIRMATION" | "RESCHEDULE" | "CANCELLATION" | "REMINDER";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";
export interface NotificationDelivery { id: string; tenantId: string; appointmentId: string; kind: NotificationKind;
  channel: "EMAIL"; destinationMasked: string; status: NotificationStatus; providerMessageId?: string;
  errorCode?: string; createdAt: string; updatedAt: string }
export interface NotificationRepository { save(value: NotificationDelivery): Promise<void>;
  list(tenantId: string, appointmentId: string): Promise<NotificationDelivery[]> }
export interface EmailMessage { to: string; subject: string; text: string }
export interface EmailSender { send(message: EmailMessage): Promise<{ ok: true; messageId: string } | { ok: false; code: string }> }
export interface AppointmentNotificationService {
  appointmentChanged(kind: Exclude<NotificationKind, "REMINDER">, appointment: Appointment): Promise<void>;
  list(tenantId: string, appointmentId: string): Promise<NotificationDelivery[]>;
}
