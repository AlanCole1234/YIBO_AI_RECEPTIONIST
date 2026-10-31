# Hosted Google OAuth dashboard return

31 October 2026. Local launch-branch fix; **not deployed to staging or production**.
No Google Cloud client, callback registration, token, real calendar or phone setting
was changed. The AWS staging release remains synthetic with real providers off.

## Reproduced failure and fix

The dashboard starts Calendar authorization using `window.location.origin` as
`returnTo`. The service signed that value, but callback state validation accepted
only HTTP localhost URLs with a port. A valid signed HTTPS state therefore failed
before token exchange: the unit test returned `null` and the actual Fastify
callback returned HTTP 400 instead of redirecting to the dashboard.

`buildConfiguredApplication` now passes the same effective dashboard origin used
by the API to `GoogleOAuthService`. An explicitly supplied application config keeps
precedence over environment configuration. The service checks the return address
both before signing and when reading callback state, including failure callbacks.

| Setting | Existing default / accepted value | Runtime consumer |
| --- | --- | --- |
| `YIBO_DASHBOARD_ORIGIN` → `ApplicationConfiguration.dashboardOrigin` | Existing default `http://localhost:5173`; configured hosted value must be an HTTPS origin to qualify for hosted OAuth return | Existing API configuration and now configured Google OAuth construction |
| `GoogleOAuthConfig.dashboardOrigin` | Optional internal field; if absent, only the existing HTTP loopback flow is allowed | OAuth authorization issuance, signed-state validation and callback error return |
| `GOOGLE_REDIRECT_URI` | Existing exact Google callback URL, including `/api/integrations/google/callback`; unchanged | Google authorization request and code exchange, distinct from the dashboard return origin |

Hosted returns must match the configured HTTPS **origin** (scheme, host and port),
use the root path and contain no userinfo, query or fragment. No wildcard, request
Host/Origin inference or trust derived from the Google callback URL is used.
Existing HTTP `localhost`, `127.0.0.1` and `[::1]` flows with an explicit port remain
supported; userinfo is rejected. Signatures, ten-minute expiry, scopes, encrypted
tenant token storage, API authorization and Calendar event operations are unchanged.

## Validation

- Both regression reproductions failed before the fix with the expected `null`
  and HTTP 400 results, then passed after it.
- **40 OAuth/callback tests pass**, including **24 new cases**: trusted HTTPS,
  rejected destinations, expired/tampered state, changed configured origin,
  localhost compatibility, success/provider rejection/consent denial, explicit
  configuration precedence, tenant-isolated token storage and providers-off defaults.
- **42 related tests pass**: application configuration/bootstrap, admin authentication,
  Calendar adapter/event identity/ETag preconditions, stale-compensation protection
  and configured API/voice SQLite concurrency. Total: **82 passing tests**.
- Backend `tsc --noEmit`, frontend `vue-tsc --noEmit` and Vite production build pass
  with installed dependencies on local Node 26.7.0. These are the existing package
  build steps, run directly; no dependency or lockfile changes. Full suite not rerun.
- Native SQLite fixtures run in child processes, following the repository's existing
  test convention. They use `:memory:` databases and a replacement fetch function;
  no request reaches Google. No real browser consent or live synchronization test
  is claimed.

## Remaining deployment gates

Natural TLS renewal remains pending; the existing IP dashboard still passes
HTTPS/health/auth-boundary checks. Deploying this fix is a separate reviewed step.
Before live Calendar consent, select an approved controlled DNS hostname and exact
callback registration: Google prohibits raw-IP redirect hosts except localhost,
so the current public IP URL cannot itself be the Google OAuth callback.
[Google redirect validation rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).

No domain purchase, DNS change, provider credentials or consent is authorized by
this code checkpoint. Once approved and configured, verify Google create → retrieve
→ reschedule the same event → cancel with a labeled test appointment. Hosted
authenticated Voice Lab and private phone handover remain separate launch gates.
