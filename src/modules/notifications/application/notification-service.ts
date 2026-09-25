import type { BusinessDirectory } from "../../business/index.js";
import type { CustomerRepository } from "../../customers/index.js";
import type { Appointment } from "../../appointments/index.js";
import type { AppointmentNotificationService, EmailSender, NotificationDelivery, NotificationKind, NotificationRepository } from "./contracts.js";

export class NotificationService implements AppointmentNotificationService {
  constructor(private readonly repository: NotificationRepository, private readonly customers: CustomerRepository,
    private readonly business: BusinessDirectory, private readonly sender: EmailSender | undefined,
    private readonly createId: () => string, private readonly now: () => Date = () => new Date()) {}

  async appointmentChanged(kind: Exclude<NotificationKind, "REMINDER">, appointment: Appointment): Promise<void> {
    const customer = await this.customers.findById(appointment.tenantId, appointment.customerId);
    const context = await this.business.getLocation(appointment.tenantId, appointment.locationId);
    if (!customer?.email || customer.emailOptIn === false || !context.ok
      || context.value.location.aiCapabilities?.sendAppointmentEmails === false) {
      await this.save(kind, appointment, customer?.email, "SKIPPED"); return;
    }
    const pending = await this.save(kind, appointment, customer.email, this.sender ? "PENDING" : "SKIPPED");
    if (!this.sender) return;
    const when = new Intl.DateTimeFormat(customer.preferredLanguage ?? context.value.location.locale, {
      timeZone: context.value.location.timezone, dateStyle: "full", timeStyle: "short",
    }).format(new Date(appointment.startAt));
    const action = kind === "CONFIRMATION" ? "confirmed" : kind === "RESCHEDULE" ? "rescheduled" : "cancelled";
    const sent = await this.sender.send({ to: customer.email, subject: `${context.value.business.name}: appointment ${action}`,
      text: `${customer.name ? `Hello ${customer.name},\n\n` : ""}Your ${appointment.serviceNameSnapshot} appointment at ${context.value.location.name} is ${action}.\nDate and time: ${when}\nReference: ${appointment.id}\n` });
    await this.repository.save({ ...pending, status: sent.ok ? "SENT" : "FAILED", updatedAt: this.now().toISOString(),
      ...(sent.ok ? { providerMessageId: sent.messageId } : { errorCode: sent.code }) });
  }

  list(tenantId: string, appointmentId: string) { return this.repository.list(tenantId, appointmentId); }

  private async save(kind: NotificationKind, appointment: Appointment, destination: string | undefined,
    status: NotificationDelivery["status"]) {
    const timestamp = this.now().toISOString();
    const value: NotificationDelivery = { id: this.createId(), tenantId: appointment.tenantId,
      appointmentId: appointment.id, kind, channel: "EMAIL", destinationMasked: maskEmail(destination), status,
      createdAt: timestamp, updatedAt: timestamp };
    await this.repository.save(value); return value;
  }
}

const maskEmail = (value?: string) => {
  if (!value) return "unavailable";
  const [name, domain] = value.split("@");
  return `${name?.slice(0, 1) ?? "*"}***@${domain ?? "***"}`;
};
