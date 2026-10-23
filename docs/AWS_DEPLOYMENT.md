# AWS launch preparation

23 October 2026. **Prepared locally, not deployed.** The owner selected AWS instead
of Cloudflare and now reports a Free-plan account with $100 credits, 183 days
remaining and registered MFA. No authenticated AWS access, hostname, server or
billable resource has been configured here. See the current
[read-only access and cost review](AWS_ACCESS_AND_COST_REVIEW.md). The account
creation instructions below are retained as the preparation history.

## Account action for the owner

1. Start at [AWS Free Tier](https://aws.amazon.com/free/). Create the account
   yourself, including verification, payment details and terms. Choose the **Free
   account plan** if AWS offers it to this new account, and Basic Support.
2. Enable root-account MFA. Do not send passwords, access keys or payment details
   in chat. No root access key is needed for this preparation.
3. Open **Billing and Cost Management → Free Tier** and record the plan, credit
   balance and expiry. Share only those non-secret facts, your intended AWS region
   and an existing domain/subdomain you control. Do not launch an instance yet.
4. Review the concrete resource/cost proposal and approve provisioning separately.
   Root account access must not be the application/deployment identity; prepare
   limited operator access and an EC2 instance role at that approved stage.

Current new-account rules provide $100 initial credits and opportunities to earn
another $100. The Free plan lasts until six months or credit exhaustion, whichever
comes first; it is not permanent free hosting. Expiry closes the account and makes
resources inaccessible unless upgraded. Do not depend on it for uninterrupted
paying-customer service. Obtain approval for a Paid-plan transition and ongoing
cost ceiling before production. Joining AWS Organizations can trigger an automatic
Paid-plan upgrade; do not set that up as an incidental onboarding step.
[AWS account-plan documentation](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

## Smallest deployment that fits this application

```text
Browser → approved HTTPS hostname:443 → Caddy on dedicated AWS EC2
                                       ├─ dashboard/dist (Vue assets)
                                       └─ /api/* → 127.0.0.1:3000 Fastify
                                                      └─ regional SQLite on EBS

Later, separately approved:
same authoritative YIBO runtime ↔ private network ↔ existing DigitalOcean Asterisk
                                                    ↔ existing Telnyx service
```

- Start with **one** persistent Linux Node host. A `t3.small` (x86, 2 GiB) is a
  candidate, subject to the account's eligibility, selected region, estimate and
  load tests. AWS lists it among eligible types for new accounts. Eligibility
  means credits can offset usage, not unlimited free 24/7 compute. ARM `t4g.small`
  is an alternative after Linux ARM validation. Do not assume a 1 GiB host has
  enough headroom for simultaneous voice, API and builds.
  [EC2 Free Tier rules](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html).
- Use encrypted gp3 EBS for the existing regional SQLite databases. One
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
  second phone application. Reboot/restart tests on AWS remain a release gate.
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
causes downtime until recovery. A stable approved hostname and public address,
off-host backups, a tested restore and monitoring are prerequisites for launch.
There is **no working AWS URL yet** and no invented `API_ORIGIN` value. The
Cloudflare Worker/Access variables are not used in this AWS topology.

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
| `deploy/backup/*` | Existing online regional backup, verify and restic upload workflow; use a private encrypted off-host repository. Prefer an EC2 IAM role scoped to the approved S3 bucket/prefix instead of long-lived AWS keys. Restic encryption secret remains private. Validate restore into a separate directory. |

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
Full application evidence is in [the combined integration report](launch/COMBINED_INTEGRATION.md).

Before provisioning:

1. Verify the owner-reported account allowances, region/residency, hostname
   ownership and approved cost estimate. No IAM/DNS/EC2 change was made.
2. Approve the exact EC2/EBS/address/backup/management-access proposal. Provision
   isolated synthetic data first; no automatic production deployment workflow.

Before public business acceptance:

3. Fix the existing Google OAuth return-state validator to accept only the exact
   trusted configured HTTPS dashboard origin as well as intended development
   origins. It currently permits only HTTP localhost with a port, so a hosted
   reconnect callback fails. Add focused redirect/state tests before any live
   Google Cloud callback or token change. No OAuth changes were made here.
4. Do not publish the unauthenticated development Voice Lab on port 4317. Its
   hosted authenticated WSS design is separate; the dashboard's voice test is
   not deployment-ready merely because local protocol tests pass.
5. Verify HTTPS login/logout, role/tenant restrictions, persistent data across
   service restart/reboot, encrypted off-host backup and restore, disk/memory
   monitoring and health checks. A service reload/start is not a backup test.
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
