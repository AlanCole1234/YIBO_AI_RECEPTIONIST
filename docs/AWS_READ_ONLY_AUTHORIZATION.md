# Temporary AWS inventory access — verified

23 October 2026. The owner explicitly approved the no-charge `yibo-codex-audit`
role and one one-hour read-only session. The account uses the new AWS experience,
project Happy Path, Ohio (`us-east-2`). The source identity was verified as
`/managed/AccountFullAccessRole` in the intended project; its administrator
credentials were never copied to the Mac.

**24 October status:** the one-hour session and the 24-hour trust window have both
expired. No access was renewed, no policy was broadened, and no deployment occurred.

## Completed authorization

- Created only `yibo-codex-audit` and its `YiboReadOnlyInventory` inline policy.
  Read back the exact trust and permission documents, 3,600-second maximum session,
  absence of managed policies/permissions boundary, and sole inline policy.
- Actual-role simulation passed **26/26** expected decisions: thirteen inventory/
  identity actions allowed and thirteen write/sensitive actions explicitly denied.
- Verified the issued role session in CloudShell **and from the Mac**. Identity
  and EC2 reads succeeded; EC2 `CreateVolume` with **DryRun=true** returned
  `UnauthorizedOperation` in both places. No real write was attempted.
- Transferred only temporary credentials through authenticated CloudShell download.
  The named `yibo-audit` profile uses a private file under `~/.aws/yibo-audit/`,
  with directories mode `0700` and files `0600`. The download was moved out of
  Downloads; no credential values were printed or placed in the repository.
  There is no default/admin profile, long-lived access key, or automatic renewal.
- This session expired **2026-10-23 19:56:13 UTC**. New assumptions are blocked after
  **2026-10-24 18:53:41 UTC**. The role remains defined; its trust expiry does not
  revoke sessions already issued. Those expire within their one-hour duration.
  This record is historical after expiry and does not imply a lasting connection.

### Regional simulation issue resolved without changing permissions

The initial principal-policy simulation omitted `aws:RequestedRegion` and returned
organization-policy denials for regional EC2 inventory. The same unchanged role
passed when the simulated request explicitly supplied `us-east-2`. The project
has AWS-managed regional controls; no organization policy, role permission, or
trust restriction was relaxed. Setup stopped before issuing credentials while
this was diagnosed. The resumed verification reused the existing role and
original trust cutoff; it did not recreate or modify either.

### Verified Ohio inventory

On 23 October, no EC2 instances, EBS volumes, or Elastic IPs were present. There
was one available default VPC with three subnets. Both `t3.small` (x86_64) and
`t4g.small` (arm64) were offered,
with two vCPUs and 2 GiB RAM. EC2 reports both as Free Tier eligible; that metadata
alone does **not** establish a zero-cost offer, remaining credits, account quotas,
ARM compatibility, or a 183-day hosting allowance. Other service inventories and
billing are outside this deliberately narrow role.

## Approved access boundary

- Create one custom programmatic IAM role, `yibo-codex-audit`, outside the protected
  `/managed/` path. Do not alter any existing role or managed organization policy.
- Trust only the verified current console role in this same project account.
  Resolve its full IAM ARN from AWS, rather than guessing its path or trusting
  the entire account. Do not trust an external account or wildcard principal.
  The [trust template](../deploy/aws/codex-audit-trust.example.json) has placeholders
  for the verified project account and a UTC expiry 24 hours after creation;
  the applied values were resolved only after the owner approved the IAM change.
  Keep account-specific values and credentials out of these generic templates.
- Attach the inline policy in
  [codex-audit-policy.example.json](../deploy/aws/codex-audit-policy.example.json).
  It permits twelve named EC2 inventory reads plus `sts:GetCallerIdentity` and
  explicitly denies all other actions. This excludes resource writes, IAM changes,
  further role assumptions, secrets, database/customer data, S3 objects, logs,
  billing changes, and model invocation. Inventory metadata can include tags and
  addresses; do not publish the raw output.
- Set the role's maximum session to **3,600 seconds**. Issue one **one-hour** STS
  session, with the same restrictive policy also supplied as the session policy.
  No long-lived access key, admin credential or auto-refresh profile goes on the Mac.
- Restrict new assumptions with a trust-policy UTC expiry set to **24 hours after
  creation**. The role definition remains afterward; existing one-hour sessions
  expire normally. No automatic resource/role deletion is proposed.

## Procedure and renewal constraints

1. Use the owner's signed-in AWS CloudShell session for the approved IAM setup.
   Do not copy its administrator credentials to the Mac. If the expected project,
   identity, role availability or policy controls differ, stop and report.
2. Create only the new role and its inline policy. If the name already exists,
   inspect it and stop rather than overwriting. If any step fails, do not issue
   credentials or broaden permissions to work around the failure.
3. Read back the actual trust and permissions, confirm no additional policies,
   and use IAM policy simulation for allowed inventory reads and denied writes,
   secrets access, and privilege escalation. Simulation alone is not a complete
   account authorization proof. Supply the project region explicitly as simulation
   context; an IAM client region alone is insufficient.
4. Generate only the approved one-hour role session to a private file without
   printing tokens.
   Transfer it through AWS's authenticated download flow, outside the repository,
   and use a separate local `yibo-audit` profile. Verify identity and an inventory
   read. Check a supported EC2 write **with `--dry-run` only** is unauthorized;
   never execute a real write to test permission denial.
5. Review Ohio pricing and the account's credits/expiry before a separate resource
   proposal. This inventory role intentionally cannot query billing or customer
   content; use the signed-in Billing UI/public pricing for those cost checks.

## Cost and limits

AWS lists IAM and CloudShell at no additional charge. This proposal creates no
EC2 instance, disk, database, DNS record or deployed YIBO service and does not
activate advanced features or upgrade the Free plan. Creating or extending this
access is a security-sensitive permission change.
The initial role/session was explicitly approved; extending its expiry or scope
requires another approval.

Local checks confirm thirteen exact allowed actions, matching deny exceptions,
and a 951-character compact session policy within STS's 2,048-character limit.
Before creation, custom-policy simulation passed 10/10 cases. After creation, the
actual-role 26-case simulation and real restricted-session checks described above
passed. App source/runtime did not change, so the previously passing application
suite, typechecks and build were not repeated for this authorization-only step.

Ohio public compute/disk/IPv4 prices and the trial/post-trial forecast were checked
on 24 October; see [the cost review](AWS_ACCESS_AND_COST_REVIEW.md). Remaining gates
include actual credit expiry/offer/quota, a domain, and Linux ARM validation.
Do not provision resources, deploy, upgrade the Free plan, alter phone/Calendar
services, or extend the audit session without the required approval.

Sources: [new account access model](https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html),
[project protection policies](https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html),
[STS session permissions and duration](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html),
[IAM pricing](https://aws.amazon.com/iam/faqs/),
[CloudShell pricing](https://aws.amazon.com/cloudshell/pricing/),
[simulation request context](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html).
