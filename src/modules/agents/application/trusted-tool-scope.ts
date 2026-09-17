import type { TrustedCallContext } from "./contracts.js";

/** Bind ephemeral tool state to the complete server-owned scope, never model arguments. */
export const trustedToolScope = (context: TrustedCallContext): string => JSON.stringify([
  context.tenantId, context.locationId, context.callId, context.customerId ?? null,
  context.developerTestModeAuthorized === true,
]);
