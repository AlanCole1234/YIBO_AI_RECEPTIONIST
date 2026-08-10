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

export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const code = errorCode(body);
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
  health: () => request<{ status: string }>("/api/health"),
  business: () => request<Business>("/api/business"),
  findOrCreateCustomer: (input: { name: string; phone: string }) =>
    request<Customer>("/api/customers", { method: "POST", body: JSON.stringify(input) }),
  availability: (input: { serviceId: string; employeeId: string; rangeStart: string; rangeEnd: string }) => {
    const query = new URLSearchParams(input);
    return request<{ slots: Slot[] }>(`/api/availability?${query}`);
  },
  createAppointment: (input: { customerId: string; serviceId: string; employeeId: string; startAt: string }) =>
    request<Appointment>("/api/appointments", { method: "POST", body: JSON.stringify(input) }),
  appointment: (appointmentId: string) => request<Appointment>(`/api/appointments/${encodeURIComponent(appointmentId)}`),
};
