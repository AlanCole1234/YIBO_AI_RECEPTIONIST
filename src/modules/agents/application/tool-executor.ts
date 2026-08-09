import type { AppointmentService } from "../../appointments/index.js";
import type { SchedulingService } from "../../scheduling/index.js";
import type { HumanTransferPort } from "../ports/agent-dependencies.js";
import type {
  AgentToolCall,
  AgentToolResult,
  ToolExecutionContext,
  ToolExecutor,
} from "./contracts.js";

type Input = Record<string, unknown>;

export class ToolExecutorImpl implements ToolExecutor {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly appointments: AppointmentService,
    private readonly transfer: HumanTransferPort,
  ) {}

  async execute(context: ToolExecutionContext, call: AgentToolCall): Promise<AgentToolResult> {
    if (!isObject(call.arguments)) return invalid(call, "Tool arguments must be an object");
    if (containsTrustedField(call.arguments)) {
      return invalid(call, "Trusted context fields cannot be supplied by the model");
    }
    switch (call.name) {
      case "check_availability": return this.checkAvailability(context, call);
      case "create_appointment": return this.createAppointment(context, call);
      case "cancel_appointment": return this.cancelAppointment(context, call);
      case "transfer_to_human": return this.transferToHuman(context, call);
    }
  }

  private async checkAvailability(context: ToolExecutionContext, call: AgentToolCall) {
    const input = call.arguments as Input;
    if (!exactKeys(input, ["serviceId", "employeeId", "rangeStart", "rangeEnd"], ["serviceId", "rangeStart", "rangeEnd"]) ||
        !text(input.serviceId) || !dateTime(input.rangeStart) || !dateTime(input.rangeEnd) ||
        (input.employeeId !== undefined && !text(input.employeeId))) {
      return invalid(call, "serviceId, rangeStart and rangeEnd are required and must be valid");
    }
    const result = await this.scheduling.findAvailableSlots({
      tenantId: context.tenantId,
      serviceId: input.serviceId,
      ...(input.employeeId ? { employeeId: input.employeeId as string } : {}),
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
    });
    if (!result.ok) {
      return toolError(call, result.error.code, "Availability could not be checked. Ask for another date or try again.", result.error.code === "EXTERNAL_CALENDAR_UNAVAILABLE" && result.error.retryable);
    }
    return { toolCallId: call.toolCallId, ok: true as const, data: { slots: result.value } };
  }

  private async createAppointment(context: ToolExecutionContext, call: AgentToolCall) {
    if (!context.customerId) return toolError(call, "CUSTOMER_REQUIRED", "Verify the caller before creating an appointment.", false);
    const input = call.arguments as Input;
    if (!exactKeys(input, ["serviceId", "employeeId", "startAt"], ["serviceId", "employeeId", "startAt"]) ||
        !text(input.serviceId) || !text(input.employeeId) || !dateTime(input.startAt)) {
      return invalid(call, "serviceId, employeeId and a valid startAt are required");
    }
    const result = await this.appointments.createAppointment({
      tenantId: context.tenantId,
      customerId: context.customerId,
      serviceId: input.serviceId,
      employeeId: input.employeeId,
      startAt: input.startAt,
      idempotencyKey: `${context.callId}:${call.toolCallId}`,
      source: "AI_CALL",
      sourceCallId: context.callId,
    });
    if (!result.ok) {
      const retryable = result.error.code === "CALENDAR_SYNC_FAILED" && result.error.retryable;
      const message = result.error.code === "SLOT_NO_LONGER_AVAILABLE"
        ? "That time is no longer available. Offer the caller alternative slots."
        : "The appointment could not be confirmed. Do not tell the caller it was booked.";
      return toolError(call, result.error.code, message, retryable);
    }
    if (result.value.status !== "CONFIRMED") {
      return toolError(call, "APPOINTMENT_NOT_CONFIRMED", "The appointment is not confirmed. Do not present it as booked.", false);
    }
    return { toolCallId: call.toolCallId, ok: true as const, data: { appointment: result.value } };
  }

  private async cancelAppointment(context: ToolExecutionContext, call: AgentToolCall) {
    if (!context.customerId) return toolError(call, "CUSTOMER_REQUIRED", "Verify the caller before cancelling an appointment.", false);
    const input = call.arguments as Input;
    if (!exactKeys(input, ["appointmentId"], ["appointmentId"]) || !text(input.appointmentId)) {
      return invalid(call, "appointmentId is required");
    }
    const lookup = await this.appointments.getAppointment({
      tenantId: context.tenantId,
      appointmentId: input.appointmentId,
    });
    if (!lookup.ok || lookup.value.customerId !== context.customerId) {
      return toolError(call, "APPOINTMENT_NOT_FOUND", "No cancellable appointment was found for this verified caller.", false);
    }
    const result = await this.appointments.cancelAppointment({
      tenantId: context.tenantId,
      appointmentId: input.appointmentId,
    });
    if (!result.ok) {
      const retryable = result.error.code === "CALENDAR_SYNC_FAILED" && result.error.retryable;
      return toolError(call, result.error.code, "The appointment could not be cancelled. Do not claim it was cancelled.", retryable);
    }
    return { toolCallId: call.toolCallId, ok: true as const, data: { appointment: result.value } };
  }

  private async transferToHuman(context: ToolExecutionContext, call: AgentToolCall) {
    const input = call.arguments as Input;
    if (!exactKeys(input, [], [])) return invalid(call, "transfer_to_human does not accept a destination");
    const result = await this.transfer.transferToConfiguredDestination({
      tenantId: context.tenantId,
      callId: context.callId,
    });
    return result.ok
      ? { toolCallId: call.toolCallId, ok: true as const, data: { transferred: true } }
      : toolError(call, result.error.code, "The transfer could not be completed. Continue assisting the caller.", result.error.retryable);
  }
}

const isObject = (value: unknown): value is Input => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const dateTime = (value: unknown): value is string => text(value) && !Number.isNaN(new Date(value).valueOf());
const containsTrustedField = (input: Input): boolean => ["tenantId", "callId", "customerId", "idempotencyKey"].some((key) => key in input);
const exactKeys = (input: Input, allowed: string[], required: string[]): boolean =>
  Object.keys(input).every((key) => allowed.includes(key)) && required.every((key) => key in input);
const invalid = (call: AgentToolCall, message: string) => toolError(call, "INVALID_TOOL_ARGUMENTS", message, false);
const toolError = (call: AgentToolCall, code: string, messageForAgent: string, retryable: boolean): AgentToolResult => ({
  toolCallId: call.toolCallId,
  ok: false,
  error: { code, messageForAgent, retryable },
});
