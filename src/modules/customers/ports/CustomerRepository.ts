import type { CustomerId, TenantId } from "../../../shared/types/identifiers.js";
import type { Customer } from "../domain/Customer.js";

export interface CustomerRepository {
  findByPhone(tenantId: TenantId, phone: string): Promise<Customer | null>;
  findById(tenantId: TenantId, customerId: CustomerId): Promise<Customer | null>;
  search(tenantId: TenantId, query: string, limit: number): Promise<Customer[]>;
  save(customer: Customer): Promise<void>;
}
