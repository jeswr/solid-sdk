<!-- AUTHORED-BY Claude Fable 5 -->

# Vendored @jeswr/solid-server test artifact

Byte-identical copy of `packages/solid-seed/vendor/jeswr-solid-server-0.1.0.tgz`
(kept self-contained per package so neither package's test harness breaks if
the other migrates to the npm release).

| Field | Value |
| --- | --- |
| Package | `@jeswr/solid-server@0.1.0` |
| Purpose | Test-only real Solid server (LDP/WAC/OIDC) for the pod-guard security suites |
| Upstream | `sparq-org/sparq` package `packages/solid-server` |
| Upstream commit | `947480b0` |
| Packed by | the reference implementation's vendoring script, from a `sparq-org/sparq` checkout |
| SHA-256 | `05f603d7a3320ffcb222703e4ba2ecbf913f18657c4c2eddaf28a80528b4db8d` |
| License | MIT (upstream package manifest and README) |

The package is not published on npm, and the source checkout does not contain
the built WASM artifact, so the pinned packed artifact keeps the real-server
tests reproducible under the workspace's `ignore-scripts=true` supply-chain
posture. It is a `devDependency` only and is excluded from
`@jeswr/solid-pod-guard`'s published `files` allowlist. Delete this directory
and switch the devDependency to the registry version once the npm bootstrap
publish lands.
