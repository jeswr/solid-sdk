<!-- AUTHORED-BY GPT-5.6 Sol via codex -->

# Vendored @jeswr/solid-server test artifact

| Field | Value |
| --- | --- |
| Package | `@jeswr/solid-server@0.1.0` |
| Purpose | Test-only real LDP/WAC integration for seeder acceptance criterion 2 |
| Upstream | `sparq-org/sparq` package `packages/solid-server` |
| Upstream commit | `947480b0` |
| Packed by | solid-mortgage `packages/solid-kit/scripts/vendor-solid-server.mjs` |
| Source artifact | solid-mortgage `packages/solid-kit/vendor/jeswr-solid-server-0.1.0.tgz` |
| Source commit | `9699455` (`feat(solid-kit): sparq WASM dev/test Solid-server harness + vendored @jeswr/solid-server (sm-4)`) |
| SHA-256 | `05f603d7a3320ffcb222703e4ba2ecbf913f18657c4c2eddaf28a80528b4db8d` |
| License | MIT (upstream package manifest and README) |

The package is not published on npm, and the source checkout does not contain the built WASM
artifact. This pinned packed artifact makes the real-server test reproducible under the workspace's
`ignore-scripts=true` supply-chain posture. It is a `devDependency` only and is excluded from
`@jeswr/solid-seed`'s published `files` allowlist.
