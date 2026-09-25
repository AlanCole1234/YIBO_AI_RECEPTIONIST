import type {
  AdminSessionVerification,
  IssueAdminSessionCommand,
} from "../application/contracts.js";

export interface AdminSessionPort {
  issue(command: IssueAdminSessionCommand): Promise<string>;
  verify(token: string, now: Date): Promise<AdminSessionVerification>;
  revoke(token: string): Promise<void>;
}
