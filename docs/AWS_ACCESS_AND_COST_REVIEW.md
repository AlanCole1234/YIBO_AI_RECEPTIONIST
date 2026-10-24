# AWS access and cost review — 24 October 2026

## Current state

The owner reports an active **Free plan and $100 credit balance**. Read-only Safari
inspection confirmed the new AWS experience, project **Happy Path**, region
**us-east-2 (Ohio)**, **183 days remaining**, and a registered Builder ID MFA device.
The Builder ID uses GitHub sign-in. The credit balance has not been API-verified.
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

## Ohio hosting estimate — public rates verified 24 October

Candidate, **not approved or provisioned**: one Linux `t4g.small` (2 vCPU/2 GiB),
20 GiB total encrypted gp3 storage at baseline performance, one public IPv4,
existing domain/DNS, and low initial traffic. Reuse the prepared Caddy + Node
service, regional SQLite, and backup workflow. Keep Asterisk on its existing
DigitalOcean server and its routing unchanged. A single instance is a low-cost
launch candidate, not a high-availability design; restore and load tests remain
release gates. The Mac must not remain part of the eventual production path.

| Component, 730 hours/month | x86 fallback `t3.small` | ARM `t4g.small` after trial | ARM during eligible trial |
| --- | ---: | ---: | ---: |
| Linux compute | $15.18 ($0.0208/h) | $12.26 ($0.0168/h) | $0 within 750 shared hours/month |
| 20 GiB gp3 | $1.60 | $1.60 | $1.60 |
| One public IPv4 | $3.65 | $3.65 | $3.65 |
| Base subtotal | **$20.43** | **$17.51** | **$5.25** |
| Small backup/log/request reserve | $1–3 | $1–3 | $1–3 |
| Planning total | **$21.43–23.43** | **$18.51–20.51** | **$6.25–8.25** |

Compute rates come from AWS's [Ohio Linux pricing data](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20%28Ohio%29/Linux/index.json).
AWS's [EBS pricing data](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json)
contains Ohio gp3 at $0.08/GB-month and standard snapshot storage at $0.05/GB-month.
For example, 20 GB-month of billable snapshot blocks costs $1; actual retention
and changed blocks determine the bill. The reserve is a planning allowance, not
a quoted bundle or cap. Public IPv4 is [$0.005/hour](https://aws.amazon.com/vpc/pricing/)
for both used and idle allocated addresses. Extra gp3 IOPS/throughput are not proposed.

AWS publishes a **750 aggregate monthly t4g.small hour trial through December 31,
2026 UTC**, including Ohio, for new/existing customers. It is shared across the
payer organization and covers compute only. Starting January 1, 2027, ordinary
On-Demand rates apply if the instance continues running. Surplus CPU credits are
extra. The account's applied offer and any other usage still need checking in
Billing; EC2's `FreeTierEligible=true` is not proof of a zero bill.
[T4g trial terms](https://aws.amazon.com/ec2/faqs/).

### Credit runway and recommendation

Illustration only: starting October 24 and running to April 24 (182 days, based on
183 days reported the previous day), there are 69 trial days and 113 post-trial
days. With the published trial applied, unchanged rates, one instance, and the
$1–3/month reserve, estimated AWS usage is **$82.96–94.93**. This leaves little
room within the reported $100. Exact account expiry/balance and applied credits
remain unverified. Do not promise six months free or 24/7 service after expiry.

**Recommended next step:** validate the existing app on Linux ARM at no hosting
cost before proposing `t4g.small`. In particular check native SQLite dependencies,
production startup/restart, persistence, and synthetic load. If ARM validation
fails, keep x86 as a fallback; its planning cost consumes $100 in about 4.3–4.7
months. Do not choose a smaller RAM size or Spot just to advertise free hosting.

Use Standard CPU-credit mode for the initial synthetic evaluation to avoid
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
2. **Public pricing complete; account checks remain:** verify the applied trial,
   credits/expiry and vCPU quota; confirm the domain; complete Linux ARM validation
   and a backup/restore plan before the final resource proposal. A new read-only
   session/trust extension needs fresh explicit approval; none was issued.
3. Obtain explicit approval for infrastructure, then start with synthetic data.
   Existing hosted OAuth, Voice Lab, backup and real-call gates remain in
   [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md). No production deployment is authorized.
