import type { CustomerId, TenantId } from "../../../shared/types/identifiers.js";
import type { Customer } from "../domain/Customer.js";

export interface CustomerRepository {
  findByPhone(tenantId: TenantId, phone: string): Promise<Customer | null>;
  findById(tenantId: TenantId, customerId: CustomerId): Promise<Customer | null>;
  save(customer: Customer): Promise<void>;
}
