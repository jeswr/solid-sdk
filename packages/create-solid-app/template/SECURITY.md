# Security Policy

Thank you for helping keep __CSA_APP_NAME__ and its users safe.

## Reporting a vulnerability

**Please report security vulnerabilities privately — do not open a public issue,
pull request, or discussion for a security problem**, since that would disclose
the issue before it can be fixed.

Report it through **GitHub Security Advisories**:

1. Go to this repository's **Security** tab on GitHub
   (<https://github.com/__CSA_REPO__/security/advisories>).
2. Click **Report a vulnerability**.
3. Describe the issue: what it affects, how to reproduce it, and the impact you
   observed.

This uses GitHub's built-in private advisory workflow — it works for any public
repository with no extra service or infrastructure, and the report stays private
between you and the maintainers until a fix is published.

## Response expectations

This project may be early-stage. We aim to acknowledge and investigate reports
promptly and to fix confirmed vulnerabilities as quickly as is practical, but
**response and fix times are not guaranteed** and depend on the maintainers'
availability and the severity of the issue.

> **Maintainer note:** edit this section to match the actual support commitment
> you are willing to make for your project. If you offer a concrete response-time
> SLA, state it here; otherwise leave the best-effort wording above. Do not
> promise a timeline you cannot keep.

## Scope and supported versions

This app is built from the `create-solid-app` template and inherits the suite's
supply-chain hardening (`.npmrc` `ignore-scripts=true`; RDF and auth handled by
vetted libraries — see [`AGENTS.md`](./AGENTS.md)).

It makes **no** certification, compliance-framework, or formal
supported-versions guarantee out of the box. If your deployment adopts a specific
support window or compliance program, document it here — otherwise treat only the
latest released version as supported.
