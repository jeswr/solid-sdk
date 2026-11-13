<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/agent-consent

Browser-safe consent core for a consumer agent (security-critical, private).

- `evaluateAction`: the outbound gate. It runs mandate, recipient, disclosure, data terms,
  limits and approval, and evidence, and returns go, ask or stop.
- `buildApprovalRequest` / `checkResponse`: the dynamic approval sheet. The gate writes the
  title, facts and offered responses, and refuses any response that was not offered.
- Spending rules (`checkSpend`, `ruleUsage`) come in three kinds: per purchase, a weekly or
  monthly budget (UTC), and an allowance. The most specific covering rule wins. Money is
  kept in integer minor units.
- Device-signed records (`signRecord` / `verifyRecord`): compact JWS ES256 over RFC 8785
  canonical JSON, signed with a non-extractable WebCrypto key. There are three record
  types: approvals (single use, bound to the action digest, 10-minute TTL), spending rules
  and revocations.

Tests keep 100% line, branch and function coverage per file.
