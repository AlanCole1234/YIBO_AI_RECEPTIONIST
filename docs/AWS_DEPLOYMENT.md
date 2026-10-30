# AWS deployment and remaining launch gates

29 October 2026. **Approved synthetic Lightsail staging is deployed.** Reuse the
existing Happy Path project in Ohio and its one staging host, attached static IP
and private backup bucket; do not provision duplicates. Base cost is **$13/month**.
The assigned IP serves the dashboard and API with a trusted HTTPS certificate.
Login/appointments, encrypted off-host restore and automatic restart/reboot checks
passed with synthetic data. See [actual results and remaining manual
steps](AWS_STAGING_VALIDATION.md), [staging configuration](../deploy/aws/lightsail/README.md),
[cost review](AWS_ACCESS_AND_COST_REVIEW.md) and [ARM64 evidence](AWS_ARM64_VALIDATION.md).
Live providers remain disabled. The separate DigitalOcean phone system is unchanged.

## Account action for the owner

1. Account creation and Builder ID MFA are complete. Reuse this account and
   project. Do not create a duplicate account, root identity or IAM console user.
2. The initial read-only CLI audit expired and was not extended. Approved staging
   was provisioned through the existing owner console; no AWS administrator
   credentials were copied to the Mac. Additional resources still need approval.
3. Private staging-owner password setup and manual browser login passed on October
   29; the saved owner account is included in a successful encrypted backup.
   The owner also confirmed saving the restic recovery key and repository details
   in a locked Apple Note and closing the private handoff. The note/key were not
   inspected by the agent; recovery using that saved copy has not been separately
   tested. Do not send passwords, keys or tokens in chat.
4. No domain purchase was needed for the initial IP certificate. Observe its first
   natural renewal; review an owned business hostname before real-provider setup.
   AWS still displayed $100 credits / 178 Free-plan days on October 28, with usage
   potentially not yet posted. Monitor billing and storage; the plan deadline is
   April 23, 2027. Do not assume permanent free operation.

Current new-account rules provide $100 initial credits and opportunities to earn
another $100. The Free plan lasts until six months or credit exhaustion, whichever
comes first; it is not permanent free hosting. Expiry closes the account and makes
resources inaccessible unless upgraded. Do not depend on it for uninterrupted
paying-customer service. Obtain approval for a Paid-plan transition and ongoing
cost ceiling before production. This new AWS experience already includes an
AWS-managed organization; do not apply the classic account-joining warning to
that automatic setup or change organization/advanced-feature settings incidentally.
[AWS account-plan documentation](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).
[New-experience account model](https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html).

## Smallest deployment that fits this application

```text
Browser → approved HTTPS address:443 → Caddy on dedicated AWS Linux host
                                       ├─ dashboard/dist (Vue assets)
                                       └─ /api/* → 127.0.0.1:3000 Fastify
                                                      └─ regional SQLite on persistent disk

Later, separately approved:
same authoritative YIBO runtime ↔ private network ↔ existing DigitalOcean Asterisk
                                                    ↔ existing Telnyx service
```

- Start with **one** persistent Linux Node host with at least 2 GiB RAM. Linux
  ARM64 validation now passes, making `t4g.small` the validated EC2 architecture
  candidate; `t3.small` remains an x86 alternative. Eligibility means credits can
  offset usage, not unlimited free 24/7 compute. Do not assume a 1 GiB host has
  enough headroom for simultaneous voice, API and builds.
  [EC2 Free Tier rules](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html).
- **Budget candidate checked:** Lightsail `small_3_0`, Ubuntu `ubuntu_24_04`, Ohio,
  x86-64, 2 GB/2 vCPU/60 GB, $12/month. Account quota has room; private backup bucket
  adds $1/month. The [staging runbook](../deploy/aws/lightsail/README.md) covers the
  exact files, IP HTTPS, security and approval boundary. Actual x86 execution and
  instance-to-bucket authentication now pass. This is not a concurrent-call
  capacity benchmark. Do not create a second EC2 or Lightsail host.
- Use persistent encrypted storage (gp3 EBS for EC2) for the existing regional SQLite databases. One
  authoritative writer/runtime; no autoscaling replicas, network-shared SQLite,
  Lambda, D1 or database migration. Startup can migrate a database: start only on
  a new synthetic volume until a backed-up production transition is approved.
- Caddy serves dashboard and API on **one origin**, avoiding a new CORS or frontend
  proxy system. `YIBO_DASHBOARD_ORIGIN` must exactly equal that HTTPS origin. The
  current relative `/api` requests and secure HttpOnly cookies are retained.
- Build in CI/on a development machine, install locked dependencies on the target
  platform, then copy the reviewed source/build artifact. Do not copy Mac
  `node_modules` to Linux. Keep `tsx` and SQL migration sources; the existing
  service runs TypeScript directly, so `pnpm install --prod` alone is insufficient.
- Reuse `deploy/node/yibo-api.service.example` for restart-on-failure, dedicated
  user, private files and `/var/lib/yibo` persistence. Enable/start it only after
  approval. It deliberately removes ARI/media variables, preventing an accidental
  second phone application. Local systemd restart, crash recovery and VM reboot
  passed; equivalent checks now also pass on the approved AWS staging host.
- Keep Caddy's TLS storage persistent and private under its service user. Public
  security-group ingress is only TCP 80/443; restrict management access. Fastify
  binds loopback. Do not expose 3000, 4317, 8088, SIP or RTP publicly on this host.
  Private phone connectivity and any UDP rules require a later explicit review.
- Use existing DNS hosting if possible. No Route 53 hosted zone, domain purchase,
  NAT gateway, ALB, RDS or Kubernetes is needed for this initial topology.
  EC2, EBS, public IPv4, snapshots, backups and transfer can still consume credits
  or incur charges. Estimate all of them before provisioning; budget alerts do
  not enforce a spending cap. [AWS VPC pricing](https://aws.amazon.com/vpc/pricing/).

This is a low-cost single-host candidate, not high availability. Host failure
causes downtime until recovery. A stable approved HTTPS address,
off-host backups, a tested restore and monitoring are prerequisites for launch.
The assigned staging IP now provides working HTTPS; its exact public origin is
in the private operator configuration and was delivered to the owner. No
`API_ORIGIN` or Cloudflare Worker/Access variables are needed in this AWS topology.

## Reused files and configuration contract

| Item | Required configuration or action |
| --- | --- |
| `deploy/aws/Caddyfile.example` | Replace the reserved `yibo.invalid` fallback by setting `YIBO_PUBLIC_HOSTNAME` in Caddy's service environment to the approved bare hostname. Validate before installing/reloading. No access log is enabled by this template. |
| `deploy/node/yibo-api.service.example` | Reuse on the dedicated approved host with Node 22.16+ and pnpm's pinned version. Do not install it on the PBX. |
| `/etc/yibo/backend.env` | Private operator-created file; never commit it or copy the working phone `.env` wholesale. Start from `deploy/node/backend.env.example`. |
| `NODE_ENV`, `HOST`, `PORT` | `production`, `127.0.0.1`, `3000`. HTTPS terminates at Caddy. |
| `DOTENV_CONFIG_PATH` | `/dev/null`, already set in the service; avoid loading checkout secrets. |
| `YIBO_DASHBOARD_ORIGIN` | The exact approved `https://hostname`, no path, used by the backend's origin protection. Caddy and browser must use the same origin. |
| `YIBO_TENANT_ID`, `YIBO_REGION` | The reviewed existing business ID and region. A made-up tenant is not onboarding: bootstrap must actually contain/resolve that business. Do not expose demo tenants as real businesses. |
| `YIBO_DATABASE_US`, `YIBO_DATABASE_MX` | Explicit absolute paths for every region in use under `/var/lib/yibo`; new synthetic DB first. Region selection alone does not select the tenant/database. |
| `YIBO_ADMIN_SESSION_KEY` | Stable random secret of at least 32 bytes, entered privately by the operator. Provision the initial owner with the existing admin CLI against the explicitly reviewed database, not committed sample credentials. |
| `YIBO_INSTANCE_LOCK`, `YIBO_INSTANCE_LOCK_PATH` | `1` and `/var/lib/yibo/yibo-instance.lock`; keep the reviewed sidecar lock on the local persistent filesystem. Do not unlink or age-delete an active lock. |
| `YIBO_RUNTIME` | `in-memory` for isolated acceptance. `openai-realtime` only at approved AI activation with `OPENAI_API_KEY`. Preserve saved AgentConfiguration and existing call caps. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `YIBO_TOKEN_ENCRYPTION_KEY` | Needed together for real Calendar. Preserve encrypted grants and their original key only via an approved secure migration. Missing settings select an in-memory calendar; that must not be mistaken for live sync. Hosted callback fix/authorization is still a gate below. |
| `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL` | Server-only provider key and approved supported model when AI is activated. Existing saved configuration/defaults remain authoritative. `OPENAI_ADMIN_KEY` is optional cost reporting, not necessary for login. |
| `RESEND_API_KEY`, `YIBO_EMAIL_FROM` | Only for separately approved real email delivery. Existing disabled-provider behavior remains SKIPPED. |
| ARI/Telnyx/media/Voice Lab settings | Absent in the first HTTP-only AWS phase. No phone-route or port 7001 change. |
| `deploy/backup/*` | Existing online regional backup, verify and restic upload workflow. EC2 can use a scoped instance role; the Lightsail proposal uses native same-region bucket resource access without static keys. Verify actual metadata authentication and off-host restore before enabling the timer. Restic encryption secret remains private. |
| `deploy/aws/lightsail/*` | Synthetic-only environment, startup guard, IP-certificate Caddy wrapper, service drop-ins, ingress proposal and runbook. Reuses the existing API/proxy/backup implementation; not installed or enabled by builds. |

Do not share production SQLite between independent Mac and AWS writers or run two
owners of the same Stasis application. The separate phone playback fix `8db12d1`
must be reviewed before migrating AI voice. Later private connectivity should
keep the DigitalOcean PBX intact; starting phone handling on AWS requires an
explicit handover with rollback, capacity and real-call verification.

## Validation and deployment gates

Local build commands (no deployment):

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
caddy validate --adapter caddyfile --config deploy/aws/Caddyfile.example
```

The Caddy template was validated locally with official Caddy 2.11.7, checked
against its published SHA-512 checksum. A disposable loopback proxy test verifies
static/SPA serving, API path/query/status preservation, cookie and Origin
forwarding, no-store responses, blocked private paths and unavailable-upstream
behavior. This does not test public DNS, a public certificate or AWS networking.
[Caddy SPA/proxy pattern](https://caddyserver.com/docs/caddyfile/patterns),
[configuration validation](https://caddyserver.com/docs/command-line#caddy-validate).
Full application evidence is in [the combined integration report](launch/COMBINED_INTEGRATION.md)
and [Linux ARM64 validation](AWS_ARM64_VALIDATION.md): 773 tests passed, one optional
live test skipped, both typechecks/build passed, and 23 synthetic runtime/voice/
reboot checks passed. Production dashboard login rendered in the browser; real
HTTP login and appointment workflows passed. No live provider calls were made.

Completed staging provisioning (historical approval boundary):

1. Account plan/balance, Ohio, Linux ARM64 behavior, Lightsail quota and the x86
   Ubuntu image are verified. Review the concrete $13/month staging proposal and
   the IP-certificate option; no owned domain is currently available. Recheck quota
   and balance before creation. Target execution and off-host backup authentication
   were then verified on the approved host; see the staging validation record.
2. Approve the exact host/storage/address/backup/management-access proposal and
   any narrowly scoped deployment authorization. Only then provision one host,
   install the reviewed release and services, and enable HTTPS for synthetic
   acceptance. This approval was received and executed within the $13 base scope.
   No automatic production deployment workflow is authorized.

Before public business acceptance:

3. Fix the existing Google OAuth return-state validator to accept only the exact
   trusted configured HTTPS dashboard origin as well as intended development
   origins. It currently permits only HTTP localhost with a port, so a hosted
   reconnect callback fails. Add focused redirect/state tests before any live
   Google Cloud callback or token change. No OAuth changes were made here.
4. Do not publish the unauthenticated development Voice Lab on port 4317. Its
   hosted authenticated WSS design is separate; the dashboard's voice test is
   not deployment-ready merely because local protocol tests pass.
5. Synthetic HTTPS login/logout, role/tenant restrictions, restart/reboot durability
   and encrypted off-host restore passed. The owner's browser login and
   owner-confirmed recovery-key vault copy are complete. Observe natural TLS
   renewal and establish operational monitoring before advancing to real
   providers. A service reload/start is not a backup test.
6. After explicit provider/data approval, verify real Google create → retrieve →
   reschedule same event → cancel, then an actual phone conversation and clean
   hangup with private PBX media. Do not enable both Mac and AWS phone owners.
7. Run the existing release preflight for the fully configured launch. It checks
   phone/provider requirements too; an HTTP-only synthetic installation is not
   expected to pass that live gate. Do not weaken it for a green result.

Rollback is an approved switch to the previous release directory **only if its
schema is compatible**. Otherwise restore a verified backup with the single writer
stopped; never downgrade or overwrite production SQLite blindly. Public traffic,
phone ownership and database transitions all require explicit operator approval.
