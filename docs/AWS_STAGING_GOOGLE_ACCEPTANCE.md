# AWS staging Google Calendar — activated, consent pending

Updated 8 November 2026. Existing hostname: **https://staging.getyibo.com**. The hosted
OAuth return fix is preserved in the newly active release `0f55c44`. The approved
Google-test profile now uses its own database; Google consent and real event
acceptance remain pending. The earlier login and 18 hosted synthetic checks are in
[the release report](AWS_STAGING_RELEASE_UPDATE.md).

**Account decision, 6 November:** after unsuccessful signup attempts, the owner
explicitly chose the existing regular Google account. A new private secondary
calendar, **YIBO AWS STAGING TEST**, was created in that verified signed-in account
with timezone **America/Chicago**. Public access is off and only the owner appears
in sharing. The older **YIBO Test Appointments** calendar and all existing events
are preserved. Do not resume test-account signup or reuse working OAuth clients/tokens.

**Google setup completed, 7 November:** the owner approved the separate project,
API and OAuth setup, then explicitly approved the Google APIs/Calendar terms and
User Data Policy at the required agreement step. Project **`yibo-aws-staging`**
exists; Calendar API is **Enabled**. The Billing page confirms **no billing
account is linked**. No Google trial, hosting resource or paid service was added.
The existing `yibo-development` project and its clients/grants are unchanged.

| Verified Google configuration | Value |
| --- | --- |
| OAuth app | **YIBO AWS Staging** |
| Audience / publishing status | **External / Testing**, not published |
| Test users | Exactly one: the owner's approved regular account |
| Web client | **YIBO AWS Staging Web**, one client listed, status **Enabled** |
| Authorized redirect URI | `https://staging.getyibo.com/api/integrations/google/callback` (one entry, no trailing slash) |
| Authorized JavaScript origins | None; YIBO uses the existing server-side OAuth flow |
| Saved scopes | `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.events.freebusy` only |

The generated client ID/secret were preserved privately on the owner's Mac,
outside Git, in `~/Library/Application Support/YIBO/credentials/staging-google/`:
directory mode **0700**, file mode **0600**. This is a local credential record,
not a claim of encrypted/off-device recovery custody. The JSON download did not
report completion; the displayed values were instead preserved without printing
them, validated against the new client/project/callback, and read back locally.
The redundant temporary copy was removed after matching the persistent record.
The dedicated calendar's actual ID was read from its named Google settings page
and saved beside the client as private routing metadata; its name, secondary-ID
format and America/Chicago timezone were checked. The exact mapping was subsequently
installed and verified during the approved 8 November activation below.
No secret was included in chat, screenshots, repository files or command arguments.

At the end of the 7 November Google setup, no AWS activation had occurred.
The owner separately approved it on 8 November; completed work is recorded below.
**Still pending:** private owner login after the restart, Google Calendar consent,
access/refresh tokens, and real event create/reschedule/cancel acceptance.

## Read-only AWS preflight — 8 November 2026

The existing AWS browser session was restored and the staging host inspected
without changing files, services, provider settings or data:

| Check | Verified result |
| --- | --- |
| Immutable release / running process | Both `f38de1316a88f00a5d3f1f36557c3079a2169dc9` |
| API, Caddy and backup timer | All active and enabled |
| Runtime / provider profile | `in-memory` / `synthetic`; Google, OpenAI and phone credentials absent from the backend environment |
| Bind / dashboard origin | `127.0.0.1:3000` / `https://staging.getyibo.com` |
| SQLite | Existing synthetic DB, read-only `quick_check` returns `ok`; proposed Google-test DB does not exist |
| Backup configuration | DB path and release SHA match the running synthetic deployment |
| Latest scheduled backup | Success, **8 November 19:04:22 UTC**; next timer trigger **20:04:27 UTC** at inspection |
| Public routes | Dashboard and `/health` 200; unauthenticated `/api/auth/me` 401; `/voice` and `/ari` 404. `/health` is a SPA fallback, not proof of API health; the actual `/api/health` JSON endpoint was separately verified before and after activation below. |
| Automatic hostname TLS renewal | Caddy recorded successful renewal for `staging.getyibo.com` at **8 November 13:28:06 UTC**; publicly verified certificate expires **15 November 04:29:33 UTC** |

This closes the earlier natural hostname-renewal check. No renewal was forced,
and no restart was needed. This inspection does not constitute a new authenticated
appointment test or a new billing/credit measurement. The existing Google setup
was reused for the separately approved activation below.

## Approved activation completed — 8 November 2026

The owner explicitly approved privately transferring the new staging OAuth client
and verified calendar ID to the existing AWS host, generating a token-encryption
key, creating a separate DB while preserving login/original data, updating backup
targets and restarting only the staging API. Calendar consent was excluded.

| Item | Verified result |
| --- | --- |
| Active immutable release | `0f55c44c8cb50344a9bac38b22b75f5d564d728b` |
| Preserved rollback release | `f38de1316a88f00a5d3f1f36557c3079a2169dc9` |
| Source | Exact public Git commit; **488 tracked files** byte-compared after build; uncompressed archive SHA-256 `360dcd789a99e2da83adfcef76e22757a3ed843f6705c4ecf8817f93417e2a0e` |
| Native validation | Ubuntu 24.04 x86-64, Node **22.23.4**, pnpm **11.19.0**; frozen-lockfile install, **114/114 tests across 13 files**, both typechecks and Vite production build passed |
| Profile / DB | `google-calendar-test` / `/var/lib/yibo/staging-google-us.sqlite` |
| Original synthetic DB | `/var/lib/yibo/staging-us.sqlite` preserved, with a fresh encrypted backup before the switch |
| Owner | Exactly one existing active owner identity, password hash and roles copied within the host; equality and tenant/foreign-key checks passed; no password reset |
| Calendar routing | Fresh default location maps to the privately verified **YIBO AWS STAGING TEST** secondary ID, **America/Chicago** |
| Provider state | New client/token-encryption settings installed privately; **zero Google grants and zero appointments** at activation verification |
| Backup | New DB path and exact release SHA installed together; encrypted post-switch DB backup passed; timer restored active/enabled |
| Recovery | New Google client/routing/token-encryption material encrypted into the existing restic repository under tag `yibo-staging-google-recovery`; restored privately and byte-compared successfully |
| Public verification | **5/5 pass**: dashboard 200, `/api/health` 200 with exactly `{"status":"ok"}`, unauthenticated `/api/auth/me` 401, `/voice` and `/ari` 404; trusted TLS retained |

Build/install ran as the existing unprivileged `yibo-build` user with no provider
credentials. Coverage includes staging guards, OAuth/hosted callback, Calendar
event identity, stale compensation, SQLite concurrency, authentication and regional
backup. Provider requests in these tests were mocked; no full suite was repeated
for a deployment-only change. All tracked source files remained unchanged.

The existing synthetic and new Google-test guards both passed before the switch.
Source/dependencies are root-owned and not writable by runtime. The source release
contains no private environment files, runtime DBs or credential records. Credentials
were transferred through a verified no-echo SSH input session; clipboard/input were
cleared afterward. They were not printed or embedded in command arguments/history.

Rollback files with original permissions, candidates and a private result record
are at `/etc/yibo/rollback/google-0f55c44-20261108`. The API process working directory
and loaded Google-test environment matched the approved release and mapping.
Public environment and Caddy configuration remained byte-for-byte unchanged;
there was no Caddy restart or reload. Only the API was stopped/started, with the
backup timer temporarily paused and resumed. No rollback was needed.

The Google recovery backup uses the existing restic recovery password the owner
already saved in a locked Apple Note. The new encryption key and client secret
were restored and compared without exposing either. The private restored evidence
remains inside the root-only rollback directory. Preserve that repository and the
owner-held recovery password; future credential/key changes require a new encrypted
recovery backup. This is separate from the routine database-only snapshots.

No new resources or subscriptions were created; the approved AWS resource base
remains $13/month, excluding existing usage/overage terms. Credits were not reread.
Existing Google grants/events, personal events, main, production, phone services,
PBX/7001 and Cloudflare were untouched. Google consent and the real Calendar test
remain distinct gates. The sign-in page is prepared with `owner@example.test`;
the owner must enter the existing password privately after session invalidation.

## Isolation and the installed deployment guard

`buildConfiguredApplication` selects the real Google adapter when all four OAuth
settings exist. The runtime choice `in-memory` controls the AI runtime; it does
**not** disable that Calendar adapter. Adding Google credentials to the current
synthetic profile is blocked by the staging preflight. Activation uses the explicit
Google-test opt-in below.

The installed preflight adds one explicit, deployment-only setting:

| Setting | Default / accepted value | Consumer |
| --- | --- | --- |
| `YIBO_STAGING_PROVIDER` | Omitted or `synthetic`: existing provider prohibition; `google-calendar-test`: opt-in below; any other value rejected | `deploy/aws/lightsail/check-staging.mjs`, existing systemd `ExecStartPre` |
| `YIBO_DATABASE_US` in Google-test mode | Exactly `/var/lib/yibo/staging-google-us.sqlite` | Existing regional SQLite configuration and backup CLI |
| Shared instance lock | Existing `/var/lib/yibo/staging-instance.lock`; no second API writer | Existing instance lock and preflight |

The Google-test profile permits only the five named Google/token settings below,
requires a hostname-based exact callback and a secondary Calendar ID, and keeps
loopback 3000, synthetic US tenant, production authentication, recording/dialing
off, and all OpenAI/phone/email/AWS credential prohibitions. The default synthetic
profile and its original tests remain intact. No business logic, routes, schemas,
OAuth scopes or Calendar adapter code changes.

The new database prevents old synthetic event IDs from being treated as real
Google events. Preserve `staging-us.sqlite` and its encrypted backup unchanged.
The new DB was initialized through existing migrations/US demo seeding, with only
the staging owner's identity/role record copied privately on the host so the same
password remains valid. No old customers, appointments, calls, grants or calendar
mappings were copied. The new calendar mapping comes only from the verified
staging configuration.

The current schema stores identity, password hash and roles together in
`admin_users` (migration 005). Copy exactly the active `owner@example.test` row
for region `US` and tenant `tenant-yibo-demo-us`, with all its existing columns,
into the newly migrated/seeded DB in a transaction. Require exactly one source
row and no destination identity conflict; otherwise stop. Read the old DB only,
use bound parameters, and never print the row, password hash or session key.
Verify the tenant foreign key, roles, active flag and row count privately.
No password reset or broader user import is needed. API restart invalidates
in-memory sessions, so the owner must sign in again afterward.

Guard syntax checks cannot prove account/calendar ownership and are not a runtime
calendar allowlist. The owner's regular-account choice replaces the earlier
test-only-account recommendation, but it does **not** limit Google's permissions
to the test calendar: the existing scopes cover event editing and availability
across calendars the authorizing account can access. Explain that scope before
the owner grants consent. Verify the dedicated secondary-calendar ID and fresh
database routing before any event write; tests must target only that calendar.
Do not inspect or modify personal events. A separate OAuth client isolates the
staging grant from working YIBO credentials, not from other calendars accessible
to that Google account. [Google scope definitions](https://developers.google.com/workspace/calendar/api/auth).

## Google setup procedure — completed, do not duplicate

1. **Calendar created and privacy checked:** **YIBO AWS STAGING TEST**,
   **America/Chicago**, owner-only sharing and public access disabled. Its
   actual Calendar ID is now recorded privately from settings. Do not invent an
   ID, use `primary` or substitute the older test calendar.
2. **Project created:** inventory initially contained only **YIBO Development**;
   the approved separate project is now **YIBO AWS Staging** (`yibo-aws-staging`).
   Only Calendar API was explicitly enabled for this setup. Google-provided
   default project services were not modified. Standard Calendar API usage is
   listed at no additional cost. Do not attach billing, start a paid trial, add
   Workspace or enable other services. If a future flow requires payment or an
   upgrade, stop before accepting it; no such spending is approved.
   [Calendar API quotas and pricing](https://developers.google.com/workspace/calendar/api/guides/quota).
3. **Audience saved and verified:** **External / Testing**, with only the owner's
   approved regular account as a test user and contact/support address. The owner
   explicitly approved the required agreements. Any later MFA or account-ownership
   challenge must be completed privately by the owner.
4. **Web application client created and read back:** **YIBO AWS Staging Web**.
   Authorized redirect URI, with no trailing slash:

   `https://staging.getyibo.com/api/integrations/google/callback`

   No browser JavaScript client is used by YIBO's server-side flow. Preserve the
   private credential record outside Git; Google shows the secret only at creation.
   If Google requests domain verification, review that separate action before
   modifying DNS. [Google web-server OAuth requirements](https://developers.google.com/identity/protocols/oauth2/web-server).
5. **Data Access saved:** only the application's existing scopes:
   `https://www.googleapis.com/auth/calendar.events` and
   `https://www.googleapis.com/auth/calendar.events.freebusy`.
   Testing-mode Calendar refresh tokens expire after seven days; reauthorization
   during staging is expected. This is not a durable customer-launch authorization.
   [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## Private host configuration — installed 8 November

The [template](../deploy/aws/lightsail/google-calendar-test.env.example) describes
the installed profile, retaining existing systemd/Caddy/HTTPS setup. Completed
values are only in `/etc/yibo/backend.env`, root-owned mode 0600.

| Field | Source / behavior |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Actual test-project web client's identifier; bootstrap constructs Google OAuth/Calendar |
| `GOOGLE_CLIENT_SECRET` | That client's secret, entered privately on staging; OAuth code exchange and refresh |
| `GOOGLE_REDIRECT_URI` | Exact callback above; Google authorization and token exchange |
| `GOOGLE_CALENDAR_ID` | Verified test secondary calendar's `…@group.calendar.google.com` ID; existing bootstrap imports it only when the fresh location has no default mapping |
| `YIBO_TOKEN_ENCRYPTION_KEY` | Generate 32 random bytes on staging, stored as 64 hex characters; existing AES-GCM tenant token storage and OAuth state signing; distinct from all other keys |
| `YIBO_ADMIN_SESSION_KEY` | Preserve existing private staging value; authentication behavior unchanged |
| `YIBO_DASHBOARD_ORIGIN` | Preserve `https://staging.getyibo.com` in `/etc/yibo/public.env`; API origin checks and trusted OAuth return |

No secret value belongs in chat, screenshots, Git, shell arguments or command
history. The private no-echo entry and encrypted recovery/restore check above are
complete. Database snapshots alone do not contain the key needed to decrypt
restored Google grants. The existing restic recovery password was not changed.

## Approved procedure, remaining acceptance and rollback

The exact committed release and configuration change were approved. Steps 1–4
are complete except the owner's private post-restart login. Steps 5–6 remain
pending; do not treat configured credentials as successful Calendar consent:

1. Build the approved immutable source artifact as `yibo-build`, validate the
   preflight/tests/typechecks/build on Linux, and back up current private config.
2. Pause the backup timer, allow any job to finish, and take a verified encrypted
   backup of the current synthetic DB. Stop only the staging API and confirm its
   writer exited. Preserve the old DB/release/config; no production host involved.
3. Initialize the fresh Google-test DB and copy the staging owner record privately
   as described above. Set only the reviewed profile/Google fields and new DB path.
   Update backup `YIBO_DATABASE_US` to the **same new file** and `YIBO_RELEASE_SHA`
   to the newly installed release. Preserve all restic access and recovery settings.
4. Validate the guard before starting the API. Verify loopback, public HTTPS,
   unauthenticated 401, voice/ARI 404, owner login, and new-release encrypted backup.
   Resume the existing backup timer and confirm enablement/next trigger.
5. Use YIBO's existing Google Connect action. The owner selects the approved
   regular account and grants the two reviewed scopes privately, understanding
   that access is broader than the mapped test calendar. Confirm the dashboard
   reports connected and the exact test mapping is accessible; no default-calendar guess.
6. With a unique `[YIBO AWS STAGING TEST]` run label and synthetic contact data,
   book one appointment plus a neighboring test appointment. Verify actual Google
   ID, ownership metadata and exact clinic-local date/time. Move the first twice;
   its ID must stay unchanged, with no duplicate and the neighbor untouched.
   Cancel both test appointments through YIBO, then verify their Google events are
   cancelled/absent and SQLite/history match. Inspect only this dedicated calendar;
   preserve pre-existing events and never bulk-delete. Stop on ambiguity.

On failure, stop the staging API, preserve the Google-test DB/config and investigate
any outstanding remote event before cleanup. Roll back to the old synthetic DB,
release and private configuration, including backup DB path/SHA, without overwriting
either DB. Restore health and the timer. Provider-test history remains preserved;
it is not imported into synthetic appointments. Do not revoke any original grant.

## Current validation / limits

**20/20 guard tests passed** on local Mac ARM64 with Node **22.23.4** and **26.7.0**:
the original ten cases remain and ten new cases cover explicit opt-in, separate
DB/lock, complete configuration, secret-safe output, exact hosted callback, secondary
calendar syntax, encryption keys, other provider rejection, retained isolation and
an unconfigured template failing closed. These are the same twenty cases on two
runtimes, not forty distinct tests. Backend/frontend typechecks and Vite production
build passed on Node 26.7.0 with existing locked dependencies. No full suite rerun;
application source is unchanged. Native Linux validation has now passed as
recorded above, and the prepared guard is installed on staging.

Only synthetic credentials were used by automated tests. The approved staging
activation uses the new real client without a grant; it does not claim real Google
synchronization from AWS. Existing Google credentials/events, production data and
phone routing are unchanged. Real consent, event writes, and the owner's private
login remain pending.

The 20 focused staging guard tests passed again on 6 November after the
documentation/template-comment update. On 7 November the Google UI configuration
was verified directly, along with local credential schema/callback/permissions,
documentation links and secret-free repository changes. No executable code changed;
tests/typechecks/build are not repeated for this documentation-only checkpoint.

On 8 November the read-only host and public checks above passed. The remaining
local work is documentation only; no application code, dependencies or schemas
changed. The activation candidate included the already tested deployment guard;
native Linux checks and activation subsequently passed as recorded above.
