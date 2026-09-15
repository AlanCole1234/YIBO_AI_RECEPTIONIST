import type { EditableBusinessConfiguration, VersionedBusinessConfiguration } from "../../../src/modules/business/index.js";

export interface ServiceDefinition {
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  eligibleEmployeeIds: string[];
}

export interface EmployeeDefinition { id: string; displayName: string; active: boolean }
export interface OpeningHoursRule { dayOfWeek: number; startTime: string; endTime: string }

export interface Business {
  region: "MX" | "US";
  name: string;
  timezone: string;
  locale: string;
  services: ServiceDefinition[];
  employees: EmployeeDefinition[];
  openingHours: OpeningHoursRule[];
}

export interface Customer { id: string; tenantId: string; phone: string; name?: string; email?: string }
export interface Slot { employeeId: string; startAt: string; endAt: string }

export interface Appointment {
  id: string;
  customerId: string;
  serviceId: string;
  employeeId: string;
  startAt: string;
  endAt: string;
  status: string;
  externalCalendarEventId?: string;
}
export interface GoogleCalendarStatus { configured: boolean; connected: boolean }
export type AdminRole = "tenant_admin" | "operator";
export interface AdminPrincipal {
  subject: string;
  tenantId: string;
  roles: AdminRole[];
  issuedAt: string;
  expiresAt: string;
}

export type AgentToolName = "get_service_information" | "list_customer_appointments" | "check_availability" | "create_appointment" | "update_customer" | "cancel_appointment" | "reschedule_appointment" | "transfer_to_human";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export type TurnDetectionMode = "server_vad" | "semantic_vad" | "manual";

export type AgentTurnDetection =
  | { type: "server_vad"; threshold?: number; prefixPaddingMs?: number; silenceDurationMs?: number; idleTimeoutMs?: number | null; createResponse: boolean; interruptResponse: boolean }
  | { type: "semantic_vad"; eagerness: "auto" | "low" | "medium" | "high"; createResponse: boolean; interruptResponse: boolean }
  | { type: "manual" };

export interface AgentConfiguration {
  schemaVersion: 4;
  identity: { instructions: string; locale: string };
  enabledTools: AgentToolName[];
  conversation: {
    model: string;
    maxOutputTokens: number;
    reasoningEffort: ReasoningEffort;
    tracing: "disabled" | "auto";
    truncation: { mode: "auto" | "disabled" } | { mode: "retention_ratio"; retentionRatio: number; postInstructionsTokens?: number };
  };
  audio: { voice: string; noiseReduction: "disabled" | "near_field" | "far_field"; turnDetection: AgentTurnDetection };
  behavior: {
    greeting: { mode: "wait_for_caller" } | { mode: "automatic"; message: string };
    responseStyle: { brevity: "brief" | "balanced" | "detailed"; tone: "warm" | "professional" | "direct"; pace: "slow" | "balanced" | "fast" };
    silence: { message: string; maxPrompts: number };
    slotOffering: { maximumOptions: number; strategy: "earliest_first" | "spread_across_day" | "match_requested_time" };
    dataCollectionOrder: Array<"full_name" | "phone_number" | "service">;
  };
  toolPolicies: {
    channels: Record<"phone" | "voice_lab", { enabledTools: AgentToolName[]; toolChoice: "auto" | "required" | "none"; parallelToolCalls: boolean }>;
    limits: { totalPerCall: number; perTool: Partial<Record<AgentToolName, number>> };
    externalRetryAttempts: number;
    automaticTransfer: { onLimitReached: boolean; onRetryableFailure: boolean };
    confirmations: { requiredFor: AgentToolName[] };
  };
}

export interface RealtimeModelCapability {
  id: string;
  label: string;
  badge: string;
  description: string;
  voices: string[];
  limits: {
    contextWindowTokens: number;
    modelMaxOutputTokens: number;
    responseOutputTokens: { minimum: number; maximum: number; uiMinimum: number; step: number };
  };
  controls: {
    reasoningEfforts: ReasoningEffort[];
    turnDetectionModes: TurnDetectionMode[];
    semanticVadEagerness: Array<"auto" | "low" | "medium" | "high">;
    noiseReductionModes: Array<"disabled" | "near_field" | "far_field">;
    serverVad: {
      threshold: { minimum: number; maximum: number };
      prefixPaddingMs: { minimum: number; maximum: number };
      silenceDurationMs: { minimum: number; maximum: number };
    };
    idleTimeoutMs: { minimum: number; maximum: number };
    automaticResponse: boolean;
    responseInterruption: boolean;
    parallelToolCalls: boolean;
    toolChoice: boolean;
    tracing: boolean;
    truncation: boolean;
  };
}

export interface AgentConfigurationPayload {
  current: AgentConfiguration | null;
  recommended: AgentConfiguration;
  modelCapabilities: RealtimeModelCapability[];
  availableTools: Array<{
    name: AgentToolName;
    description: string;
    title: string;
    help: string;
    route: string;
    icon: string;
    kind: "consult" | "mutate" | "external";
  }>;
  secrets: { apiKeyConfigured: boolean };
}

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

const authenticationFailureHandlers = new Set<() => void>();

export function onAuthenticationFailure(handler: () => void): () => void {
  authenticationFailureHandlers.add(handler);
  return () => authenticationFailureHandlers.delete(handler);
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const code = errorCode(body);
    if (response.status === 401 && url !== "/api/auth/login") {
      for (const handler of authenticationFailureHandlers) handler();
    }
    throw new ApiError(code, response.status);
  }
  return body as T;
}

function errorCode(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) return "HTTP_ERROR";
  const error = body.error;
  if (typeof error !== "object" || error === null || !("code" in error)) return "HTTP_ERROR";
  return typeof error.code === "string" ? error.code : "HTTP_ERROR";
}

export const api = {
  login: (credentials: { email: string; password: string }) => request<{ principal: AdminPrincipal }>(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify(credentials) },
  ),
  logout: () => request<{ loggedOut: true }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ principal: AdminPrincipal }>("/api/auth/me"),
  health: () => request<{ status: string }>("/api/health"),
  business: () => request<Business>("/api/business"),
  businessConfiguration: () => request<VersionedBusinessConfiguration>("/api/admin/business-configuration"),
  updateBusinessConfiguration: (configuration: EditableBusinessConfiguration, version: number) =>
    request<VersionedBusinessConfiguration>("/api/admin/business-configuration", {
      method: "PUT", headers: { "if-match": `"${version}"` }, body: JSON.stringify({ configuration }),
    }),
  updateBusinessTimezone: (timezone: string) => request<Business>("/api/business/timezone", {
    method: "PUT",
    body: JSON.stringify({ timezone }),
  }),
  findOrCreateCustomer: (input: { name: string; phone: string }) =>
    request<Customer>("/api/customers", { method: "POST", body: JSON.stringify(input) }),
  availability: (input: { serviceId: string; employeeId: string; rangeStart: string; rangeEnd: string }) => {
    const query = new URLSearchParams(input);
    return request<{ slots: Slot[] }>(`/api/availability?${query}`);
  },
  createAppointment: (input: { customerId: string; serviceId: string; employeeId: string; startAt: string }) =>
    request<Appointment>("/api/appointments", { method: "POST", body: JSON.stringify(input) }),
  appointment: (appointmentId: string) => request<Appointment>(`/api/appointments/${encodeURIComponent(appointmentId)}`),
  googleCalendarStatus: () => request<GoogleCalendarStatus>("/api/integrations/google/status"),
  googleCalendarConnect: (returnTo: string) => request<{ url: string }>(`/api/integrations/google/connect?${new URLSearchParams({ returnTo })}`),
  agentConfiguration: () => request<AgentConfigurationPayload>("/api/configuration"),
  updateAgentConfiguration: (configuration: AgentConfiguration) => request<{
    configuration: AgentConfiguration;
    appliesTo: "next-conversation";
  }>("/api/configuration", { method: "PUT", body: JSON.stringify(configuration) }),
};
