import type { BusinessProfile } from "../application/contracts.js";

export type BusinessProfileValidationError = { message: string };

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const normalizePhoneNumber = (value: string): string | null => {
  const normalized = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+?[1-9]\d{6,14}$/.test(normalized)) return null;
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
};

export const validateBusinessProfile = (
  profile: BusinessProfile,
): BusinessProfileValidationError | null => {
  if (!profile.tenantId || !profile.businessId || !profile.name.trim()) {
    return { message: "Tenant ID, business ID, and name are required." };
  }

  try {
    Intl.DateTimeFormat("en-US", { timeZone: profile.timezone });
  } catch {
    return { message: "Business timezone must be a valid IANA timezone." };
  }

  if (profile.calledNumbers.length === 0) {
    return { message: "An active business requires at least one called number." };
  }

  if (profile.calledNumbers.some((number) => normalizePhoneNumber(number) === null)) {
    return { message: "All called numbers must be valid international phone numbers." };
  }

  const employeeIds = new Set(profile.employees.map((employee) => employee.id));
  if (employeeIds.size !== profile.employees.length) {
    return { message: "Employee IDs must be unique within a business." };
  }

  const serviceIds = new Set(profile.services.map((service) => service.id));
  if (serviceIds.size !== profile.services.length) {
    return { message: "Service IDs must be unique within a business." };
  }

  for (const service of profile.services) {
    if (service.durationMinutes <= 0) {
      return { message: `Service ${service.id} must have a positive duration.` };
    }
    if (service.bufferMinutes < 0) {
      return { message: `Service ${service.id} cannot have a negative buffer.` };
    }
    if (service.eligibleEmployeeIds.some((id) => !employeeIds.has(id))) {
      return { message: `Service ${service.id} references an employee outside this tenant.` };
    }
  }

  for (const rule of profile.openingHours) {
    if (!timePattern.test(rule.startTime) || !timePattern.test(rule.endTime)) {
      return { message: "Opening hours must use 24-hour HH:mm time values." };
    }
    if (rule.startTime >= rule.endTime) {
      return { message: "Opening-hour start time must be before end time." };
    }
  }

  return null;
};
