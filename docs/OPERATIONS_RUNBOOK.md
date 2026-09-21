# Operating and administering YIBO

Verified against the integration branch on 2026-09-19. This is an operating guide,
not evidence that a deployment or live-provider acceptance test has run.

## Start a local test environment

1. Use Node ≥22.5 and the repository's pnpm version. Run `pnpm install` in the
   intended checkout. Keep the preserved phone checkout and integration worktree separate.
2. Create local `.env` from `.env.example`, keeping secrets out of Git. Review the
   [configuration catalog](CONFIGURATION_CATALOG.md) before enabling live providers.
3. For a new test database, run `pnpm db:init`. Existing databases require the
   [backup/migration procedure](MIGRATION_RECOVERY.md) first; configured API and Voice
   Lab startup also migrate and seed automatically.
4. In an interactive terminal, create a user:
   `pnpm admin:create --tenant tenant-yibo-demo --region MX --email admin@example.test`.
   Only the password is prompted. Roles include `owner`, `office_manager`,
   `secretary`, `read_only` and the compatible historical roles `tenant_admin` and
   `operator`; default is `tenant_admin`. The CLI supports bootstrap-catalog tenants, not arbitrary
   tenant creation. US uses `--tenant tenant-yibo-demo-us --region US`.
5. Run `pnpm dev` for API, dashboard and local Voice Lab. Default endpoints are
   `http://localhost:3000`, `http://localhost:5173` and `http://localhost:4317`.
   Avoid a second API process connected to the same ARI application.
6. Check `/api/health`, login and current tenant. Health only reports API liveness;
   verify Google connection, calendar mapping, ARI and media separately.

Do not restart or reconfigure a working phone deployment as part of documentation
verification. `pnpm build` checks types and builds dashboard assets; it is not a
production process supervisor or a deployment command.

## Admin sequence

- **Locations:** configure active location, unique called number, IANA timezone,
  opening hours/closures, policies and transfer destination. See [UI-005](LOCATION_ADMINISTRATION.md).
- **Catalog/providers:** define services, durations, prices, providers and location/
  service assignments. An empty professional-hours list inherits location hours.
  See [UI-006](CATALOG_ADMINISTRATION.md).
- **Calendars:** connect the tenant's Google account; configure location default or
  professional override and validate access. Access validation does not prove event
  write permission. Changes to effective routes used by non-cancelled bookings are
  blocked, including pending/failed bookings. No events are migrated.
  See [UI-007](CALENDAR_ADMINISTRATION.md).
- **Agent:** edit persisted settings, save, then start a new conversation. Voice Lab
  preview is explicit and can incur provider cost; see [preview](VOICE_PREVIEW.md).
- **Office schedule:** use the day/week/month/agenda workspace to filter appointments,
  inspect open slots, search/create customers, reserve, reschedule, cancel and record
  outcomes. See [business operations](BUSINESS_OPERATIONS.md).
- **Readiness:** an administrator should review `/api/admin/readiness` before live
  acceptance; resolve provider and per-location blockers without copying secrets.
  Calendar is reported connected only when its current access token is usable or
  its refresh succeeds. If Google expires or revokes the grant, use **Reconnect
  Google Calendar**; an existing calendar mapping is not sufficient.
- **Conflicts:** copy the intended draft before choosing discard/reload and reapply
  against the current version. Never bypass `If-Match` or force-save stale data.
  See [UI-009](OPTIMISTIC_EDITING.md). Session expiry can discard in-memory drafts.

`tenant_admin` controls configuration; `operator` performs permitted operational work.
Neither role supplies another tenant/region in request bodies. Do not edit raw SQLite
JSON to bypass configuration validation, assignment protection or audit.

## Diagnose one call in order

Use the default privacy-filtered [observability records](OBSERVABILITY.md) to follow
one hashed call correlation through ingress, session, tools/calendar and cleanup.
Keep recordings, patient details, tokens and full provider payloads out of diagnostics.

| Symptom | Check / next action |
|---|---|
| No call ingress | PBX trunk/dialplan and subscribed ARI application; complete ARI settings; API process is connected. |
| Hangup before session | DID maps to exactly one active tenant/location; agent phone policy supports automatic VAD; inspect safe startup failure code. |
| Answered but no audio | Media host is bindable/reachable, UDP range/firewall and bridge/External Media channel. Check inbound RTP before model settings. Missing output peer times out after four seconds. |
| Audio arrives but tools fail | Enabled tools and phone channel policy, required contact and location assignments. Trusted fields cannot come from the model. |
| Repeated confirmation request | Gate needs identical action arguments/token and a later caller turn. Success should not trigger another booking. Do not bypass the gate to mask a sequence bug. |
| Calendar not connected / unavailable | All OAuth environment settings, tenant token status and mapped calendar access; API health alone is insufficient. |
| Wrong local time or price | Correct DID/location, IANA zone, location offer; compare stored UTC instant, historical price and Google timezone. Do not manually append `Z` to local time. |
| Slot lost after availability | Another booking can win before mutation revalidation. Offer newly verified alternatives; availability does not reserve a slot. |
| `ACTION_OUTCOME_UNKNOWN` | A mutation exceeded the tool deadline. Check local appointment and Google event before any retry; timeout does not prove the write failed. |
| Reschedule/cancel rejected | Customer ownership, notice policy, original event ID, current mapping and Google ownership/etag conflict. Do not delete/recreate an event blindly. |
| Transfer failed | Trusted location destination and PBX route; failed transfer should retain the conversation. |
| Session/bridge remains | Follow runtime completion and caller hangup separately; inspect cleanup records and PBX resources by the matching call. Do not terminate unrelated calls. |
| Admin 401/403/409 | Login/session expiry; role/tenant and exact Origin/HTTPS cookie setup; then stale revision or protected calendar route respectively. |

For offline regression evidence see [booking E2E](VOICE_BOOKING_E2E.md) and
[operations E2E](PHONE_OPERATIONS_E2E.md). They use simulated providers. Live testing
must use synthetic contacts and a test calendar; do not inject failures into the
working production line. Autonomous natural-language goodbye/hangup remains a live
acceptance limitation, not something proved by scripted completion.
