<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Later manual setup and submission procedure

Preparation only. No step below has been executed. `app.json` is our own planning
descriptor, **not an OpenAI schema**. Jesse must verify the current official
OpenAI requirements and account eligibility before proceeding.

## Before submission, Jesse decides/provides

- Choose the HTTPS host for the OAuth deployment of `apps/mcp-server` and set
  the public MCP URL to `https://<host>/mcp`. Confirm public TLS, host routing,
  persistent encrypted vault, allowed origins, rate limits and expiry cleanup.
- Supply a public privacy policy URL covering pod access, conversation capture,
  credential handling, retention/deletion and operator contact details. Replace
  the invalid placeholder; do not submit a placeholder policy.
- Supply a logo with the sizes/formats required at submission time, and final
  display name, description, support contact and domain/ownership information.
- Prepare a test account on a disposable pod with synthetic data only. Provide
  reviewer instructions through the eventual approved submission channel, never
  store credentials in this descriptor or repository.
- Decide whether writes are needed. Start read-only; document each enabled
  write (`pod_write`/`solid_write`, `memory_remember`, `memory_forget`, `chat_save`).

## Developer mode connector setup (later, manual)

- Check current official instructions for developer mode/custom MCP connectors
  in the intended ChatGPT account, and enable that mode if available.
- In the account's connector/app creation flow, enter the display metadata,
  HTTPS `/mcp` URL and OAuth authentication. Use the deployed authorization-server
  metadata and dynamic registration, with PKCE **S256**; never paste a pod token
  into MCP authentication. Verify the endpoint is OAuth mode, not single-user mode.
- Complete Solid sign-in and explicit consent with the disposable owner. Verify
  OAuth audience/resource binding, disconnect/revocation and a denied access case.
- Check discovered tools against `app.json`; exercise `search` then `fetch`,
  including their JSON result envelopes. Confirm every URL stays within the pod.
- Confirm read-only writes fail without mutation. If enabling writes for review,
  use only disposable resources and explicitly approve the operation.
- Check personal reads require trusted client identity, an explicit closed
  purpose and the existing owner policy; absent/malformed policy must fail closed.
- Confirm `health_query` and health recall are denied by default. If a later
  explicit policy permits a sensitive read, verify its private audit append;
  unavailable WAC discovery/audit must withhold the data.

## App submission (only after Jesse authorizes it separately)

- Recheck the current official submission process and required tool metadata,
  policies, supported authentication and review materials. Revalidate packaging.
- Supply the decided host, privacy policy, logo, support details, disposable
  test account and reproducible review steps.
- Include review notes on purpose limits, owner-only archives, card redaction,
  health denial, verified sensitive-read audit, explicit write opt-in and revocation.
  Explain that read-only annotations do not confer permission to disclose data.
- State known limits accurately (including policy/client-identity requirements
  and supported storage/ACL behavior). Make no claim of approval or publication.
- Jesse performs any later submission. This task ends with local artifacts.
