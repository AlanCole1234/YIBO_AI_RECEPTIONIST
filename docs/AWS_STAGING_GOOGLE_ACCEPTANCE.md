# AWS staging Google Calendar — prepared, not activated

6 November 2026. Existing hostname: **https://staging.getyibo.com**. The hosted
OAuth return fix is active in release `f38de13`; staging still uses the synthetic
provider. The owner login and 18 hosted synthetic checks are verified in
[the release report](AWS_STAGING_RELEASE_UPDATE.md).

**Account decision, 6 November:** after unsuccessful signup attempts, the owner
explicitly chose the existing regular Google account. A new private secondary
calendar, **YIBO AWS STAGING TEST**, was created in that verified signed-in account
with timezone **America/Chicago**. Public access is off and only the owner appears
in sharing. The older **YIBO Test Appointments** calendar and all existing events
are preserved. No new OAuth client, grant, event or server configuration has been
created. Do not resume test-account signup or reuse working OAuth clients/tokens.

## Isolation and the prepared deployment guard

`buildConfiguredApplication` selects the real Google adapter when all four OAuth
settings exist. The runtime choice `in-memory` controls the AI runtime; it does
**not** disable that Calendar adapter. Adding Google credentials to the current
deployment is blocked by the existing staging preflight.

The prepared preflight adds one explicit, deployment-only setting:

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
Initialize the new DB through existing migrations/US demo seeding, then copy only
the existing staging owner's identity/role record privately on the host so the
same password works. Copy no customers, appointments, calls, grants or calendar
mappings. This is a **proposed activation step**, not yet performed.

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

## Exact Google setup — OAuth preparation awaiting approval

1. **Calendar created and privacy checked:** **YIBO AWS STAGING TEST**,
   **America/Chicago**, owner-only sharing and public access disabled. Record its
   actual Calendar ID privately from settings; do not invent an ID, use `primary`
   or substitute the older test calendar.
2. **Project inventory checked:** the signed-in account's All-projects view shows
   only **YIBO Development** (`yibo-development`). Preserve it. The separate
   **YIBO AWS Staging** project form is prepared but has not been submitted;
   project/client creation approval is pending. Record Google's actual project ID
   after creation, rather than treating a form suggestion as an existing resource.
   Enable only Google Calendar API. Standard API usage is listed at no additional
   cost. Do not attach billing, start a paid trial, add Workspace or enable other
   services. If Google's current flow requires payment or an upgrade, stop before
   accepting it; no such spending is approved.
   [Calendar API quotas and pricing](https://developers.google.com/workspace/calendar/api/guides/quota).
3. Configure a separate OAuth app in **External / Testing**, adding only the
   owner's approved regular account as a test user. Use its address for
   contact/support. Keep the existing YIBO production/development project's clients
   and grants unchanged. Any terms,
   MFA or account-ownership challenge must be completed privately by the owner.
4. Create a **Web application** OAuth client for this staging app. Authorized
   redirect URI, with no trailing slash:

   `https://staging.getyibo.com/api/integrations/google/callback`

   No browser JavaScript client is used by YIBO's server-side flow. Preserve the
   private client download outside Git; the secret may only be shown at creation.
   If Google requests domain verification, review that separate action before
   modifying DNS. [Google web-server OAuth requirements](https://developers.google.com/identity/protocols/oauth2/web-server).
5. Request only the application's existing scopes:
   `https://www.googleapis.com/auth/calendar.events` and
   `https://www.googleapis.com/auth/calendar.events.freebusy`.
   Testing-mode Calendar refresh tokens expire after seven days; reauthorization
   during staging is expected. This is not a durable customer-launch authorization.
   [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## Private host configuration — proposed only

Use [the prepared template](../deploy/aws/lightsail/google-calendar-test.env.example)
as the reviewed complete environment, retaining existing systemd/Caddy/HTTPS setup.
The completed file belongs at `/etc/yibo/backend.env`, root-owned mode 0600.

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
history. Use a private no-echo entry session. The new token encryption key and
client secret also need owner-controlled recovery custody: database snapshots
alone do not contain the key needed to decrypt restored Google grants. The restic
recovery password is separate and is not changed.

## Activation, verification and rollback — approval still required

Before changing the running host, present the verified account/project/calendar,
exact committed release and configuration diff for approval. Then:

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
application source is unchanged. Native Linux checks remain part of approval-time
activation; this preparation is not installed on the host.

Only synthetic credentials were used by automated checks. The new private test
calendar is the only external change in this account-preparation step. Google
Cloud settings, staging services, databases, credentials, production data and
phone routing remain unchanged. Real consent, event writes, Linux activation and
key-custody handoff remain pending. This preparation does not claim real Google
synchronization from AWS. Documentation and template comments now reflect the
owner's regular-account choice; no executable code changed for that decision.
The 20 focused staging guard tests pass again after this documentation/template
comment update; local documentation links and blank credential fields are checked.
Typechecks and build are not repeated for this non-executable change.
