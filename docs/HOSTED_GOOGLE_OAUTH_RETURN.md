# Hosted Google OAuth dashboard return

Fix dated 31 October 2026; **deployed to synthetic staging on 6 November UTC**
(5 November in Denver), release `f38de13`. Not deployed to production.
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
- **2 November follow-up:** the same 82 tests, both typechecks and production build
  also pass on local Mac ARM64 with Node **22.23.4**, matching staging's Node version.
  No code change was needed.
- **5–6 November deployment:** native staging Linux x86-64 / Node 22.23.4 passed
  **111 tests** (the same 82 plus staging guards and regional backups), both
  typechecks and production build. The exact reviewed release was activated;
  **18 hosted synthetic checks** and subsequent private owner login passed.
  [Deployment, rollback and evidence](AWS_STAGING_RELEASE_UPDATE.md).

## Remaining deployment gates

The separately approved hostname checkpoint is complete: trusted HTTPS at
`https://staging.getyibo.com`, with the previous IP URL redirecting there. The
hostname certificate's first natural renewal remains to be observed; the earlier
IP certificate renewal was verified independently. The fix is now deployed, but
real Google credentials and consent remain disabled. The exact future callback is
`https://staging.getyibo.com/api/integrations/google/callback`; Google prohibits
raw-IP redirect hosts except localhost.
[Google redirect validation rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).

Domain/DNS approval and the synthetic release update do not authorize real-provider
activation. Before consent, review the staging guard/environment change and obtain
approval for staging-only credentials/callback registration without altering the
working Google integration. Once approved and configured, verify Google create → retrieve
→ reschedule the same event → cancel with a labeled test appointment. Hosted
authenticated Voice Lab and private phone handover remain separate launch gates.
