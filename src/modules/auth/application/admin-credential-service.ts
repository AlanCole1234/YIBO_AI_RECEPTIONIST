import type { TenantId } from "../../../shared/types/identifiers.js";
import type { AdminRole } from "./contracts.js";
import type {
  AdminIdentity,
  AdminIdentityRepository,
  PasswordHasher,
} from "../ports/admin-identity-repository.js";

export type AuthenticatedAdmin = Pick<AdminIdentity, "subject" | "tenantId" | "email" | "roles">;

export class AdminCredentialService {
  constructor(
    private readonly identities: AdminIdentityRepository,
    private readonly passwords: PasswordHasher,
    private readonly generateSubject: () => string,
  ) {}

  async create(input: { tenantId: TenantId; email: string; password: string; roles: AdminRole[] }): Promise<AuthenticatedAdmin> {
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    const roles = normalizeRoles(input.roles);
    if (await this.identities.findByEmail(input.tenantId, email)) throw new Error("ADMIN_EMAIL_ALREADY_EXISTS");
    const now = new Date().toISOString();
    const identity: AdminIdentity = {
      subject: this.generateSubject(),
      tenantId: input.tenantId,
      email,
      passwordHash: await this.passwords.hash(input.password),
      roles,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.identities.save(identity);
    return publicIdentity(identity);
  }

  async authenticate(input: { tenantId: TenantId; email: string; password: string }): Promise<AuthenticatedAdmin | null> {
    const email = normalizeEmail(input.email);
    const identity = await this.identities.findByEmail(input.tenantId, email);
    if (!identity?.active || !await this.passwords.verify(input.password, identity.passwordHash)) return null;
    return publicIdentity(identity);
  }
}

const normalizeEmail = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("INVALID_ADMIN_EMAIL");
  return normalized;
};

const validatePassword = (value: string): void => {
  if (value.length < 12 || value.length > 256) throw new Error("ADMIN_PASSWORD_LENGTH");
};

const normalizeRoles = (roles: AdminRole[]): AdminRole[] => {
  const unique = [...new Set(roles)];
  if (unique.length === 0 || unique.some((role) => role !== "tenant_admin" && role !== "operator")) {
    throw new Error("INVALID_ADMIN_ROLES");
  }
  return unique;
};

const publicIdentity = ({ subject, tenantId, email, roles }: AdminIdentity): AuthenticatedAdmin =>
  ({ subject, tenantId, email, roles: [...roles] });
