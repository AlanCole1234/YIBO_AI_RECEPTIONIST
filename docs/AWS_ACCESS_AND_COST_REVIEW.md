# AWS access and cost review — 25 October 2026

## Current state

Read-only Safari inspection of AWS Settings → Billing on October 24 confirmed
**Free plan, $100.00 credits remaining, $0.00 due and $0.00 project usage**. The page
displayed **182 days remaining, ending April 23, 2027**. The credits detail showed
$100 issued October 23, zero used, and credit expiry October 23, 2027 06:21 UTC.
That later credit expiry does **not** extend the six-month Free-plan deadline.
These are observed console values, not an API billing forecast. Existing account
inspection also confirmed project **Happy Path**, **us-east-2 (Ohio)**, Builder ID
GitHub sign-in and registered MFA.
The official **AWS CLI 2.38.5** is now installed for the Mac user only, under
`~/.local/share/aws-cli`, with a binary at `~/.local/bin/aws`. The vendor installer
verified the macOS package signature; `aws --version` and local login help passed.
The explicitly approved **`yibo-codex-audit`** role and one-hour STS session were
verified on 23 October. **Both the session and 24-hour trust window have now
expired.** The Mac has only the named `yibo-audit` profile and private temporary
credentials; no administrator CLI login, long-lived access key, default profile,
MCP server, or toolkit was configured. No YIBO hosting resources, DNS records,
deployments, or plan changes were created. The integration branch remains
`codex/launch-integration-reviewed`.

## Enforced read-only connection — completed

The [authorization record](AWS_READ_ONLY_AUTHORIZATION.md) documents the exact
boundary and checks. Thirteen named inventory/identity actions are allowed; all
other actions are explicitly denied in both the role policy and the STS session
policy. Actual-role simulation passed **26/26** with Ohio request context. Reads
succeeded from the Mac and a non-executing resource-creation dry run was denied.

The initial session expired **2026-10-23 19:56:13 UTC**, and the role trust blocks
new assumptions after **2026-10-24 18:53:41 UTC**. No automatic renewal is configured.
Do not interpret this dated record as authorization for later sessions or broader
permissions. Do not extend trust or attach the audit policy to an existing role.

The 23 October Ohio inventory found no EC2 instances, EBS volumes or Elastic IPs;
the default VPC and three subnets already exist. `t3.small` and `t4g.small` were
offered and marked Free Tier eligible. This does not verify account-specific discounts,
credit balance, vCPU quota, or a zero-cost 24/7 deployment.

### Account-specific constraints

The earlier root/IAM-console-user proposal does **not** apply to this account.
In the new AWS experience, Builder ID owns the project; there is no root user.
Human project access is administrator access, and custom IAM users/roles support
programmatic access. AWS manages Organizations/Identity Center for this experience.
That automatic setup does not itself mean the Free plan was upgraded. Do not
activate advanced features or change the plan for this connection. The project
region is Ohio, replacing the earlier N. Virginia planning assumption.
[AWS account and access comparison](https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html).

Direct administrator `aws login` remains **unauthorized**: a profile named "audit"
or an MCP `--read-only` tool filter does not reduce underlying IAM permissions.
The installed CLI is sufficient for this inventory stage. No additional plugin
or Agent Toolkit installation is required.
[Temporary CLI login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html),
[MCP connection options](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html).

## Ohio hosting estimate — public rates checked October 24–25

Validated ARM candidate, **not approved or provisioned**: one Linux `t4g.small` (2 vCPU/2 GiB),
20 GiB total encrypted gp3 storage at baseline performance, one public IPv4,
existing domain/DNS, and low initial traffic. Reuse the prepared Caddy + Node
service, regional SQLite, and backup workflow. Keep Asterisk on its existing
DigitalOcean server and its routing unchanged. A single instance is a low-cost
launch candidate, not a high-availability design; restore and load tests remain
release gates. The Mac must not remain part of the eventual production path.

| Component, 730 hours/month | x86 fallback `t3.small` | ARM `t4g.small` |
| --- | ---: | ---: |
| Linux compute | $15.18 ($0.0208/h) | $12.26 ($0.0168/h) |
| 20 GiB gp3 | $1.60 | $1.60 |
| One public IPv4 | $3.65 | $3.65 |
| Base subtotal | **$20.43** | **$17.51** |
| Small backup/log/request reserve | $1–3 | $1–3 |
| Planning total | **$21.43–23.43** | **$18.51–20.51** |

Compute rates come from AWS's [Ohio Linux pricing data](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20%28Ohio%29/Linux/index.json).
AWS's [EBS pricing data](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json)
contains Ohio gp3 at $0.08/GB-month and standard snapshot storage at $0.05/GB-month.
For example, 20 GB-month of billable snapshot blocks costs $1; actual retention
and changed blocks determine the bill. The reserve is a planning allowance, not
a quoted bundle or cap. Public IPv4 is [$0.005/hour](https://aws.amazon.com/vpc/pricing/)
for both used and idle allocated addresses. Extra gp3 IOPS/throughput are not proposed.

AWS publishes a 750-hour monthly t4g.small trial through December 31, 2026, with
regular pricing from January 1. However, AWS's Free-plan rules exclude other
promotional discounts. **Do not assume the trial stacks with this account's
Free plan.** The earlier $6.25–8.25/month trial estimate is conditional and is not
the launch budget. An account-specific applied offer would need separate proof;
`FreeTierEligible=true` alone does not provide it. Surplus CPU credits cost extra.
[T4g trial terms](https://aws.amazon.com/ec2/faqs/),
[Free-plan restrictions](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

### Lower regular-cost candidate: Lightsail

The Linux **2 GiB / 2 vCPU / 60 GB SSD / public IPv4** bundle is **$12/month**, with
3 TB included transfer. IPv4/storage are already included; do not add EC2's
separate charges. Allowing $1–3 for small backups/logs gives **$13–15/month**.
[Official bundle table](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html).
Snapshots are additional; a stopped instance still accrues charges until deleted.
New customers use Free Tier credits, not the older Lightsail trial offer.
[Lightsail billing rules](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html).

AWS explicitly lists Lightsail, EC2 and EBS as supported in this account's **new
experience Free Tier**. This establishes documented plan eligibility, not an
observed Lightsail quota or permission in Happy Path.
[Supported services](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html).
The current expired audit role did not include Lightsail inventory actions.

### Credit runway and recommendation

At regular EC2 rates, $100 covers about **4.9–5.4 months** of the ARM estimate.
An illustrative 180-day October 25 → April 23 run is **$109.56–121.40**, assuming
730-hour months and the stated reserve. It can exhaust credits before the plan
deadline. The earlier trial-based six-month forecast is superseded.

**Cost recommendation:** shortlist one **2 GiB Lightsail Ubuntu host** for the
lowest regular cost among these 2 GiB options. Six full months at $13–15/month
would consume **$78–90**, before exclusions below. First inspect its actual Ubuntu
blueprint/CPU architecture, account quota and secure backup authentication, then
validate any target differing from the tested ARM64 environment. Do not assume
EC2 instance-profile backup authentication transfers unchanged to Lightsail.
No Lightsail instance or deployment authorization has been created.

**Validated ARM alternative:** `t4g.small` with the existing EC2 service/backup
design. The [local Linux ARM64 validation](AWS_ARM64_VALIDATION.md) passed all
automated checks, real SQLite persistence/restore and synthetic Voice Lab sessions.
It is not a Graviton concurrency/load benchmark. If Lightsail's target/access
constraints make it unsuitable, use this option with an explicitly approved
credit runway. Do not choose 1 GiB or Spot solely to reduce the advertised cost.

For EC2, use Standard CPU-credit mode for the initial synthetic evaluation to avoid
surplus CPU charges; measure throttling before real voice use. Credits do not
cover existing DigitalOcean, Telnyx or direct OpenAI charges. Totals exclude domain
registration, taxes, excess transfer, storage growth, and larger backup/log usage.
No NAT gateway, load balancer, managed database, paid support, commitment purchase,
or plan upgrade is proposed. The Free plan expires; maintaining paying-customer
service afterward needs a separately approved funding/continuity decision.
[Account-plan limits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

## Next gates

1. **Completed:** account/region identified, local CLI installed, and the approved
   read-only role/session verified from the Mac. Observe its expiry; administrator
   CLI login and broader access remain unauthorized.
2. **Completed:** Free-plan balance/deadline inspected read-only; ARM64 full suite,
   typechecks, build, runtime, reboot and local backup/restore validated at zero
   hosting cost. Temporary VM stopped; source and evidence preserved.
3. **Next safe step:** inspect the selected Lightsail target and quota read-only,
   settle off-host backup access, and confirm the owner's hostname. Any new or
   expanded audit session needs explicit approval; do not silently extend IAM.
   Prepare one exact resource/cost proposal, with EC2 ARM as the tested alternative.
4. Obtain explicit approval for infrastructure, then start with synthetic data.
   Existing hosted OAuth, Voice Lab, backup and real-call gates remain in
   [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md). No production deployment is authorized.
