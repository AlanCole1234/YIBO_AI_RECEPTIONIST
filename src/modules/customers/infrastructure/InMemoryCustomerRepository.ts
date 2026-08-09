import type { CustomerId, TenantId } from "../../../shared/types/index.js";
import type { Customer } from "../domain/Customer.js";
import type { CustomerRepository } from "../ports/CustomerRepository.js";

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly customers = new Map<string, Customer>();

  public async findByPhone(tenantId: TenantId, phone: string): Promise<Customer | null> {
    return [...this.customers.values()].find(
      (customer) => customer.tenantId === tenantId && customer.phone === phone,
    ) ?? null;
  }

  public async findById(
    tenantId: TenantId,
    customerId: CustomerId,
  ): Promise<Customer | null> {
    const customer = this.customers.get(this.key(tenantId, customerId));
    return customer ? { ...customer } : null;
  }

  public async save(customer: Customer): Promise<void> {
    this.customers.set(this.key(customer.tenantId, customer.id), { ...customer });
  }

  private key(tenantId: TenantId, customerId: CustomerId): string {
    return `${tenantId}:${customerId}`;
  }
}
