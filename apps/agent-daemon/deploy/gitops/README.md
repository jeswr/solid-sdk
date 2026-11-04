<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# A-042 GitOps integration

**Undeployed; disabled by default. Jesse must approve any deployment.**

This lane is restricted to the SDK checkout. `sparq-org/solid-suite-gitops` is not
present here, so these files are an integration handoff, not an installed GitOps
app. Copy `modules/agent-daemon.bicep` and `modules/secret-access.bicep` into that
repo's modules directory and incorporate the module call from `dev.bicep` in its
dev entrypoint only. Keep `enableAgentDaemon=false` until Jesse's go. Do not import
it into preview, staging or prod. No deployment workflow is supplied.

The module accepts only environment `dev` and attaches a new app to the existing
dev/nonprod ACA environment beside sparq. It creates a dedicated UAMI and grants
read access only to the explicitly named existing Key Vault secrets. It does not
create a vault, share, storage account, ACA environment, certificate or secret.
It exposes HTTPS-only managed ACA ingress to port 8080, enables A2A, mounts the
dedicated credential share and fixes scaling at one replica with single revisions.
The ACA default HTTPS hostname uses platform-managed TLS. A custom domain would
need its separately reviewed certificate binding in GitOps.

Prerequisites for integration:

- Supply a digest-pinned **derived** image with a reviewed trusted cloud preload
  at `/app/host/compose.mjs`, including a real authenticated A2A receiver. The base
  image intentionally refuses an unconfigured start.
- Register a dedicated Azure Files SMB share as ReadWrite environment storage.
  Prefer the environment's managed-identity mount authentication; its identity,
  storage RBAC, encryption and network policy remain the platform's responsibility.
  No storage account key is passed to this module or the process. The mount sets
  UID/GID 65532 and owner-only modes; do not weaken credential-store checks.
- Supply an existing RBAC vault with soft delete, purge protection and the
  platform's encryption/network restrictions. `secretBindings` contains only
  names and environment-variable mappings, for example:
  `[{ name: 'agent-openai', environmentVariable: 'OPENAI_API_KEY' }]`.
  Include `AGENT_POD_CLIENT_ID` and `AGENT_POD_CLIENT_SECRET` references as needed
  by the reviewed pod-auth host. Secret values never go in parameters or outputs.
  Keep secret names distinct and lowercase ACA-compatible names; each environment
  variable must have exactly one binding. RBAC propagation may require an operator
  retry after initial identity provisioning; never broaden the role to work around it.
- Configure the trusted host's nonsecret pod root, owner and agent WebIDs, private
  Type Index, verified authority sources and network allowlists explicitly in
  the reviewed preload. No personal Mac-dependent accounts may be composed.
- Stop old writers before revision replacement and retain the durable exclusive
  lease. A replacement racing the old revision fails closed rather than stealing
  the lease. Validate the Files backend's exclusivity and durability before rollout.

Compile locally without Azure authentication or resource creation:

```sh
bicep build apps/agent-daemon/deploy/gitops/dev.bicep --outfile /tmp/agent-daemon-dev.json
```

The container CI workflow compiles this same dev entrypoint. Reference contracts:
[ACA storage mounts](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts),
[Key Vault secret references](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets),
[ACA Bicep schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2025-01-01/containerapps),
[distroless Node images](https://github.com/GoogleContainerTools/distroless/blob/main/nodejs/README.md).
