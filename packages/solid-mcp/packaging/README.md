<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Packaging (prepared, not published)

MCP-14 / sst-in3y. These are local preparation artifacts. Nothing here has been
published, submitted, uploaded, deployed, approved, or enabled in a client.
The npm names in descriptors are intended future distribution names; npm publishing
remains deferred. Do not run the plugin's `npx` commands as part of preparation.

- `server.json` is the only registry descriptor. Its remote URL points to the
  operator's deployment of `apps/mcp-server`; `{host}` is unresolved. The npm
  manifest's `mcpName` must equal `server.json`'s `name` for registry ownership
  verification; the mirror rewrite preserves that field.
- `mcpb/manifest.json` describes a Node >=24 stdio bundle. The UI deliberately
  requires an authenticated issuer-based setup: pod root, CSS credential ID and
  secret, and OIDC issuer. Read-only defaults to true. The optional WebID and
  token-endpoint override remain available through the existing private 0600
  CLI config file. Optional empty strings are omitted because the CLI rejects them.
  No access token is supplied or stored in the bundle. The credential ID is masked
  conservatively along with its secret. Memory/personal tools still require trusted
  client identity and policy; listing a tool grants no access.
  Before submission, check `compatibility.runtimes.node` (`>=24`) against Claude
  Desktop's bundled Node version. The declared requirement remains unchanged.
- `claude-plugin/` contains separate remote `solid-pod` (with capture hooks) and
  stdio-only `solid-pod-local` plugins; see its README for private file settings,
  read-only defaults and capture's required local installation.
- `chatgpt-app/` contains our own planning descriptor and a manual procedure.
- `schemas/` records the official reference sources and fetch date.

From the workspace root, after building workspace prerequisites:

```sh
pnpm --filter '@jeswr/solid-mcp^...' run build
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run packaging:check
pnpm --filter @jeswr/solid-mcp run packaging:build
```

`packaging:build` rebuilds the package, validates the descriptors, then fully
bundles its partially bundled CLI with esbuild. Every external import must be a
Node builtin. A temporary directory contains `manifest.json`, a minimal ESM
`package.json`, `dist/cli.js`, README, LICENSE and `THIRD_PARTY_NOTICES.txt`. Notices
come from esbuild's actual input packages in node_modules: name, version, license
metadata and every LICENSE text, sorted deterministically. Missing license metadata
or text fails the build. First-party workspace packages use the suite's own license.
No production node_modules are needed. The ZIP uses sorted entries, fixed permissions
and 1980 timestamps. It writes only `out/solid-mcp-<version>.mcpb` and removes the
temporary directory.
The archive is local, unsigned and gitignored. It contains no runtime configuration
or credentials. Staging and tests work offline with installed dependencies.

`packaging:check` validates against vendored schemas, reads CLI environment names
from the loader, checks configuration behavior, and queries a real built server's
MCP `tools/list` over an in-memory transport. MCPB and ChatGPT inventories must
match that response, including compatibility aliases and read-only annotations.
After the gate's dependency-first build, the package tests run these checks plus
isolated bundle startup and drift/failure tests. `files` excludes this entire
directory from npm and mirror artifacts. This work does not invoke mirror publishing.
