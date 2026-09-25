import type { CustomerId } from "../../../shared/types/identifiers.js";
import type { Customer } from "../domain/Customer.js";
import type { CustomerRepository } from "../ports/CustomerRepository.js";
import type {
  CustomerError,
  CustomerService,
  FindOrCreateCustomerByPhoneCommand,
  UpdateCustomerCommand,
} from "./contracts.js";
import type { Result } from "../../../shared/domain/result.js";

export type CustomerIdFactory = () => CustomerId;

export class DefaultCustomerService implements CustomerService {
  public constructor(
    private readonly repository: CustomerRepository,
    private readonly createId: CustomerIdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async findOrCreateByPhone(
    command: FindOrCreateCustomerByPhoneCommand,
  ): Promise<Result<Customer, CustomerError>> {
    const validation = validateIdentity(command.tenantId, command.phone, command.email);
    if (!validation.ok) return validation;

    const phone = normalizePhone(command.phone);
    const existing = await this.repository.findByPhone(command.tenantId, phone);
    if (existing) {
      const enrichment = {
        ...existing,
        ...optionalText("name", existing.name ?? command.name),
        ...optionalText("email", existing.email ?? command.email?.toLowerCase()),
        ...(existing.preferredLanguage
          ? { preferredLanguage: existing.preferredLanguage }
          : command.preferredLanguage?.trim()
            ? { preferredLanguage: command.preferredLanguage.trim() }
            : {}),
        ...(existing.emailOptIn === undefined && command.emailOptIn !== undefined
          ? { emailOptIn: command.emailOptIn }
          : {}),
      };
      const changed = enrichment.name !== existing.name
        || enrichment.email !== existing.email
        || enrichment.preferredLanguage !== existing.preferredLanguage
        || enrichment.emailOptIn !== existing.emailOptIn;
      if (!changed) return { ok: true, value: existing };

      const enriched: Customer = {
        ...enrichment,
        updatedAt: this.now().toISOString(),
      };
      await this.repository.save(enriched);
      return { ok: true, value: enriched };
    }

    const timestamp = this.now().toISOString();

    const customer: Customer = {
      id: this.createId(),
      tenantId: command.tenantId,
      phone,
      ...optionalText("name", command.name),
      ...optionalText("email", command.email?.toLowerCase()),
      ...(command.preferredLanguage?.trim() ? { preferredLanguage: command.preferredLanguage.trim() } : {}),
      emailOptIn: command.emailOptIn ?? true,
      source: command.source ?? "UNKNOWN",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.save(customer);
    return { ok: true, value: customer };
  }

  public async updateCustomer(
    command: UpdateCustomerCommand,
  ): Promise<Result<Customer, CustomerError>> {
    if (!command.tenantId.trim()) {
      return validationError("tenantId", "tenantId is required");
    }
    if (command.phone === undefined && command.name === undefined && command.email === undefined
      && command.preferredLanguage === undefined && command.emailOptIn === undefined) {
      return validationError("update", "At least one field must be provided");
    }
    if (command.phone !== undefined && !isValidPhone(command.phone)) {
      return validationError("phone", "phone must contain between 7 and 15 digits");
    }
    if (command.email !== undefined && !isValidEmail(command.email)) {
      return validationError("email", "email is invalid");
    }

    const existing = await this.repository.findById(command.tenantId, command.customerId);
    if (!existing) return { ok: false, error: { code: "CUSTOMER_NOT_FOUND" } };

    const phone = command.phone === undefined ? existing.phone : normalizePhone(command.phone);
    const phoneOwner = await this.repository.findByPhone(command.tenantId, phone);
    if (phoneOwner && phoneOwner.id !== existing.id) {
      return { ok: false, error: { code: "PHONE_ALREADY_EXISTS" } };
    }

    const updated: Customer = {
      ...existing,
      phone,
      ...updatedOptionalText("name", existing.name, command.name),
      ...updatedOptionalText("email", existing.email, command.email?.toLowerCase()),
      ...(command.preferredLanguage === undefined
        ? (existing.preferredLanguage ? { preferredLanguage: existing.preferredLanguage } : {})
        : optionalLanguage(command.preferredLanguage)),
      emailOptIn: command.emailOptIn ?? existing.emailOptIn,
      updatedAt: this.now().toISOString(),
    };
    await this.repository.save(updated);
    return { ok: true, value: updated };
  }

  public async getCustomer(tenantId: string, customerId: CustomerId): Promise<Result<Customer, CustomerError>> {
    const customer = await this.repository.findById(tenantId, customerId);
    return customer ? { ok: true, value: customer } : { ok: false, error: { code: "CUSTOMER_NOT_FOUND" } };
  }

  public searchCustomers(tenantId: string, query: string, limit = 25): Promise<Customer[]> {
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(1_000, Math.max(1, limit)) : 25;
    return this.repository.search(tenantId, query.trim(), safeLimit);
  }

  public listAllCustomers(tenantId: string): Promise<Customer[]> {
    return this.repository.listAll(tenantId);
  }
}

function validateIdentity(
  tenantId: string,
  phone: string,
  email?: string,
): Result<true, CustomerError> {
  if (!tenantId.trim()) return validationError("tenantId", "tenantId is required");
  if (!isValidPhone(phone)) {
    return validationError("phone", "phone must contain between 7 and 15 digits");
  }
  if (email !== undefined && !isValidEmail(email)) {
    return validationError("email", "email is invalid");
  }
  return { ok: true, value: true };
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validationError(
  field: "tenantId" | "phone" | "email" | "update",
  message: string,
): Result<never, CustomerError> {
  return { ok: false, error: { code: "VALIDATION_ERROR", field, message } };
}

function optionalText<K extends "name" | "email">(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  const normalized = value?.trim();
  return normalized ? ({ [key]: normalized } as Partial<Record<K, string>>) : {};
}

function updatedOptionalText<K extends "name" | "email">(
  key: K,
  current: string | undefined,
  next: string | undefined,
): Partial<Record<K, string>> {
  if (next === undefined) return optionalText(key, current);
  return optionalText(key, next);
}

const optionalLanguage = (value: string): { preferredLanguage?: string } => {
  const normalized = value.trim();
  return normalized ? { preferredLanguage: normalized } : {};
};
