# Cloudflare deployment preparation

Status: **configuration verified; no deployment, DNS, Tunnel, OAuth or phone
configuration changes made**. Git publication was authorized on 28 September 2026.
Based on launch candidate `2117c5d`, on the separate
`codex/cloudflare-deployment` branch. The existing dirty phone checkout is preserved.

## Recommended architecture

```text
Browser -- HTTPS --> Cloudflare Worker + Vue static assets
                         |
                         | /api/*, HTTPS, no cache or write retries
                         v
                  Protected Node API origin
                  (Cloudflare Tunnel + Access service token recommended)
                         |
                         v
                  Existing Fastify API, Node 22+
                         |
                  Persistent regional SQLite + existing Google adapter

Existing PBX / ARI / RTP / Realtime processes remain on their current hosts.
```

Use **Workers with Static Assets**, not a static-only Pages upload. The Vue build
already uses relative `/api` requests and same-origin cookies. A small Worker
forwards those requests to one fixed API origin; Fastify continues to enforce all
authentication, roles, tenant/location routing, validation and optimistic versions.
No CORS workaround, tenant selection in the proxy, database migration or Fastify
port is introduced. The API and all provider credentials remain on Node.

`wrangler.jsonc` publishes only `dashboard/dist`, with SPA fallback for UI routes.
`/api` and `/api/*` run the Worker first, including browser navigations, and never
fall through to `index.html`. Unconfigured origins return JSON 503. Workers Static
Assets supports this routing directly. [Cloudflare asset configuration](https://developers.cloudflare.com/workers/static-assets/binding/).

The proxy preserves request bodies, cookies, authorization, `Origin`, `If-Match`,
response statuses, `ETag`, multiple `Set-Cookie` headers and redirects. It does not
follow redirects with credentials, retry writes, log request contents or cache API
responses. An unavailable origin returns JSON 502: after an interrupted appointment
write, refresh/reconcile the appointment before manually submitting it again.

## What stays outside Workers

| Component / evidence in this repository | Deployment constraint |
| --- | --- |
| `src/infrastructure/database/regional-database.ts`: `node:sqlite` DatabaseSync, WAL, local files, synchronous transactions and migration SQL | Keep regional SQLite on persistent disk. Workers' `node:sqlite` and `node:dgram` are non-functional stubs. D1/Durable Objects have different storage APIs and are not configuration-only replacements. |
| The same database module and `src/bootstrap/build-configured-application.ts`: filesystem paths, startup migrations/defaults, encrypted token store | Workers' writable filesystem is temporary per request. Do not put SQLite, credentials or backups into assets, `/tmp`, KV or a copied browser bundle. |
| `src/main.ts`: Fastify listens on `127.0.0.1`, process lifecycle and shutdown handlers | Keep a supervised Node process. Workers has Node HTTP adapters, but this entry point and its storage/telephony dependencies cannot be deployed unchanged by adding Wrangler flags. |
| `src/modules/auth/infrastructure/signed-admin-session.ts`: process-local active-session map | One API process per tenant origin. Restarts invalidate sessions even with the same signing key; horizontally scaled replicas are not interchangeable. |
| `src/modules/telephony`: persistent ARI WebSocket/reconnect state; RTP uses `node:dgram`, UDP and media timers | Keep current PBX/private networking and long-running voice processes. No SIP/RTP/ARI forwarding or extra phone process is configured here. |
| `apps/dev-voice/server.ts` and `dashboard/src/components/AgentVoiceLab.vue` | Voice Lab currently connects to the dashboard hostname on port **4317**. It is a local harness with endpoints outside the admin guard. Do not publish it directly. Hosted Voice Lab requires separately reviewed authentication and WSS routing. |
| `src/modules/integrations/google/google-oauth-service.ts` | OAuth state accepts only HTTP localhost/loopback dashboard return URLs. New authorization from a hosted HTTPS dashboard is **not supported yet**. Existing stored grants can continue to be used by the unchanged Node Calendar adapter. Adding a Google redirect URI alone does not fix the return-URL restriction. |

Cloudflare supports WebSockets and some Node APIs, but that does not make this
particular Node/SQLite/UDP application portable without changes. Sources:
[Node compatibility/stubs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
[filesystem lifetime](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/),
[Node HTTP adapters](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/).

## Exact Cloudflare build/deploy settings

**Do not connect automatic deployment or push this branch until the deployment
summary has been reviewed.** No account/domain was selected or provisioned. Names
in angle brackets below are values the operator must choose; they are not secrets
or existing infrastructure discovered by this work.

In **Workers & Pages**, create a **Worker** connected to the repository after
approval. Use these settings:

| Setting | Value |
| --- | --- |
| Worker name | `yibo-dashboard` (matches Wrangler) |
| Production branch for this initial candidate | `codex/cloudflare-deployment`, after its approved push; never `main` |
| Root directory | Repository root (`/`) |
| Build command | `pnpm install --frozen-lockfile && pnpm cloudflare:build` |
| Deploy command | `pnpm cloudflare:deploy` |
| Build variable `NODE_VERSION` | `22` (latest 22.x, at least 22.13 for pnpm 11) |
| Build variable `PNPM_VERSION` | `11.19.0` |
| Build variable `SKIP_DEPENDENCY_INSTALL` | `true` (the build command explicitly installs the lockfile) |
| Preview/non-production branch builds | Disabled for this initial setup |
| Asset output | `dashboard/dist`, configured in `wrangler.jsonc`; no Pages output setting is needed |
| Worker entry point | `deploy/cloudflare/worker.ts`, configured in Wrangler |
| Public hostname | Add the approved **custom domain** under Domains & Routes after configuration |

`workers_dev` and version `preview_urls` are disabled so an unreviewed alternate
hostname does not expose a production-backed dashboard. There are no Worker routes
in the file; manage the approved custom domain in the Cloudflare dashboard.
`keep_vars: true` preserves dashboard-managed runtime variables on redeploy.
[Build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
[build tool versions and install override](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/),
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## Non-interactive pnpm builds

pnpm 11 refuses unreviewed dependency install scripts. Wrangler needs `workerd`'s
postinstall to prepare/validate its platform binary. Keep this policy in the
**repository-root `pnpm-workspace.yaml`**, alongside the existing version-specific
release-age exceptions:

```yaml
strictDepBuilds: true
allowBuilds:
  esbuild: true
  workerd: true
```

This approves only the two named tools; other unreviewed build scripts still fail.
Keep the frozen lockfile and pnpm 11.19.0 settings above. No interactive
`approve-builds` command, global config change, blanket build permission or disabled
dependency checking is needed. [pnpm build policy](https://pnpm.io/settings/build#allowbuilds).

Approval verification, 27 September 2026:

- A disposable fixture with the reported `workerd@1.20260925.1` and no approval
  reproduced **`ERR_PNPM_IGNORED_BUILDS`** with `CI=true`.
- Using the repository policy, its frozen install completed non-interactively and
  ran `workerd`'s postinstall. The installed native binary reports `2026-09-25`.
- A separate clean snapshot of this deployment worktree, with no `.env` or prior
  `node_modules`, passed `CI=true pnpm install --frozen-lockfile`,
  `pnpm cloudflare:build` and **`pnpm cloudflare:deploy --dry-run --outdir .wrangler/dry-run`**.
  This validates the actual deploy script without uploading or requiring credentials.
  The application manifest and lockfile were not changed for this repair: Wrangler
  remains `4.142.0`, and the project locks `workerd@1.20260926.1`.
- All **28 deployment tests** passed. An initial `pnpm test -- <file>` invocation
  unintentionally selected the full suite: 685 passed, one optional live test was
  skipped and 22 failed in socket-dependent files under the sandbox. The five
  affected files then passed **23/23** with loopback permissions. No application
  changes were needed. Use the explicit `pnpm exec vitest run <files>` form below.

The `workerd: true` entry was already part of the uncommitted local deployment
preparation; this follow-up makes strict enforcement explicit and proves the
approval using clean installs. During that verification, the fetched GitHub refs
did not contain the deployment branch, and the supplied build SHA `abc1234` did not
resolve there. The failed Cloudflare build's exact source revision is therefore
**unverified**. Confirm its connected repository/branch/commit before retrying;
Cloudflare must receive this policy, package manifest and lockfile together.
Nothing was pushed or deployed during this verification.

## Worker runtime variables and secrets

Set these under the Worker's **Settings → Variables and Secrets**, not build-time
Vite variables:

| Binding | Type | Value / purpose |
| --- | --- | --- |
| `API_ORIGIN` | Text variable | `https://<dedicated-node-api-origin-hostname>`; HTTPS origin only, no path/query/credentials; must differ from the public dashboard hostname |
| `CF_ACCESS_CLIENT_ID` | Secret | Service-token client ID for an Access-protected origin, if used |
| `CF_ACCESS_CLIENT_SECRET` | Secret | Matching service-token secret; configure both fields together or neither |
| `ASSETS` | Automatic asset binding | Supplied by Wrangler; do not manually create a storage namespace |

For the recommended protected origin, configure an Access **Service Auth** policy
allowing only that service token. Cloudflare Access protects transport to Node;
YIBO still requires its existing signed admin session. Client-supplied Access
headers are stripped before the Worker adds its own token.
[Service token setup](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

Do not add `.env`, Google/OpenAI/Telnyx/Asterisk credentials, encryption/signing
keys, customer exports, SQLite files or recordings to Cloudflare assets or build
variables. No `VITE_*` secrets are needed. Local `.dev.vars*`, `.wrangler/` and
existing `.env*`/database files are ignored by Git. Keep API response caching
disabled in zone Cache Rules as well; do not apply a “Cache Everything” rule to
either the public `/api` paths or the protected origin.

## Node origin prerequisites (separate approved deployment)

1. Choose a persistent Node host in the correct data region. Keep one API process
   for the configured tenant. Use a separate synthetic database/hostname for the
   first hosted smoke test; do not point it at live data or change the working Mac
   services as part of this preparation.
2. Install the repository with Node 22+ and pnpm 11.19.0:
   `pnpm install --frozen-lockfile --prod=false`. The current `pnpm build` only
   typechecks the backend; it emits the Vue bundle, **not** a runnable backend JS
   directory. Run the existing backend with `pnpm exec tsx src/main.ts` under a
   process supervisor. Keep source files and SQL migrations with the release.
3. On that new Node deployment, set `NODE_ENV=production` (Secure cookies),
   `YIBO_DASHBOARD_ORIGIN=https://<exact-approved-dashboard-hostname>`,
   `PORT=3000` (or the dedicated origin port), the correct `YIBO_TENANT_ID` and
   persistent `YIBO_DATABASE_MX` / `YIBO_DATABASE_US` path as applicable. Configure
   a stable `YIBO_ADMIN_SESSION_KEY` privately. Create the initial admin using the
   existing `admin:create` command on the origin; no default password is added.
4. Keep provider secrets and the existing `YIBO_TOKEN_ENCRYPTION_KEY` on the origin.
   A restored token database requires its original encryption key. Do not copy an
   active SQLite file without a SQLite-consistent backup (including pending WAL
   changes). Prove restore before any live migration. Do not split a live database
   into independent copies for web and phone writers. All writers sharing a file
   must use the compatible revision/claim migration and release.
5. The API already binds loopback. A **new, dedicated** Cloudflare Tunnel on the
   Node host can map the protected origin hostname to `http://127.0.0.1:3000`
   without exposing a public Node listener. Keep port 4317, ARI and RTP outside that
   route. Configure the origin's Access policy before publishing the dashboard.
   Tunnel/DNS provisioning has not been performed here.
6. For a separate web-only origin, leave **all four** `ASTERISK_ARI_*` settings
   absent. `src/main.ts` enables telephony automatically when those settings are
   provided. Never copy the live phone environment into another API process or
   connect another instance to the normal `yibo` ARI application.
7. Keep Google configuration and grants unchanged during this preparation. Hosted
   reauthorization and hosted Voice Lab are separate blockers above, not completed
   by this deployment configuration. A future OAuth change must retain signed
   state and use an explicit trusted dashboard-origin policy.

## Validation and first hosted acceptance

Initial deployment-preparation results, 27 September 2026 (CI approval follow-up above):

- **56/56 focused tests passed** across seven files, including 28 new proxy tests.
  Real Fastify injection verifies login/logout, Secure/HttpOnly cookies, CSRF origin
  rejection, tenant/role isolation, persisted configuration and stale-write 409.
  Existing booking and mocked Google callback/create/reschedule/cancel/identity
  checks passed. No real provider was contacted.
- Backend, Vue and standalone Worker typechecks **passed**. `cloudflare:build`
  **passed** using the same Vite production build; original runtime dependency
  lock entries are unchanged. pnpm frozen installation passed.
- Wrangler **4.142.0 dry run passed**; Worker bundle 2.45 KiB before gzip, only
  the `ASSETS` binding, no backend/SQLite/provider code bundled.
- Local Cloudflare **workerd smoke passed**: root, nested SPA navigation, JS/CSS,
  three API paths returning JSON 503 even for navigation requests, and HEAD
  handling (eight requests). Temporary loopback server stopped afterward.
- Validation ran on this Mac's Node **26.7.0**, pnpm **11.19.0**. The first Cloudflare
  Linux/Node 22 build and public-domain/origin acceptance remain unperformed.
  That initial pass did not repeat unrelated suites; the subsequent CI approval
  checks and socket-test reruns are recorded above. No application runtime files changed.

Local commands (no deployment):

```sh
pnpm typecheck
pnpm cloudflare:typecheck
pnpm exec vitest run tests/deployment/cloudflare-worker.test.ts tests/integration/auth-api.test.ts tests/integration/business-configuration-api.test.ts tests/integration/api-flow.test.ts tests/integration/google-calendar-callback.test.ts tests/integrations/google-calendar-adapter.test.ts tests/integrations/google-event-identity.test.ts
pnpm cloudflare:build
pnpm cloudflare:check
```

The dry run bundles the Worker and validates Wrangler configuration without
uploading. No credentials or provider access are required. A local `wrangler dev
--local` smoke test can serve built assets and verify unconfigured `/api` returns
JSON 503; it must use unused loopback ports and no live environment file.

Before business use, manually verify the approved custom domain/TLS, Access/Tunnel,
login/logout/Secure cookies, an unauthenticated API 401, cross-origin rejection,
roles/tenant separation and stale-edit 409. With synthetic data and an explicitly
approved test calendar, verify availability → create → reschedule same event →
cancel, including no duplicate event and a fresh UI reload. Test an origin outage
without blindly repeating a write. Hosted Google reconnect and Voice Lab remain
blocked until their existing local-only assumptions are addressed separately.
No remote acceptance or real phone test is claimed by local proxy tests.

Rollback: disable the new Worker/custom domain or deploy the previous Worker
version. This preparation makes no backend migration or phone routing changes;
do not roll back a live database or restart the phone service for an asset rollback.
