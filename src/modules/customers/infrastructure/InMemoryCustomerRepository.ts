import type { CustomerId, TenantId } from "../../../shared/types/identifiers.js";
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

  public async search(tenantId: TenantId, query: string, limit: number): Promise<Customer[]> {
    const needle = query.toLowerCase();
    return [...this.customers.values()]
      .filter((customer) => customer.tenantId === tenantId && (!needle
        || [customer.name, customer.phone, customer.email].some((value) => value?.toLowerCase().includes(needle))))
      .sort((a, b) => (a.name ?? a.phone).localeCompare(b.name ?? b.phone))
      .slice(0, limit).map((customer) => ({ ...customer }));
  }

  public async listAll(tenantId: TenantId): Promise<Customer[]> {
    return [...this.customers.values()].filter((customer) => customer.tenantId === tenantId)
      .sort((a, b) => (a.name ?? a.phone).localeCompare(b.name ?? b.phone)).map((customer) => ({ ...customer }));
  }

  private key(tenantId: TenantId, customerId: CustomerId): string {
    return `${tenantId}:${customerId}`;
  }
}
