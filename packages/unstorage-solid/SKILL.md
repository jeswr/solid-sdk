---
name: unstorage-solid
description: Use when maintaining @jeswr/unstorage-solid, its Solid store, scope compatibility, or container listing behavior.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Solid unstorage keys and listings

Keys split on `:` into path segments. Keep raw slash/backslash, empty-segment, traversal,
and malformed-encoding refusals. Pre-encoded `%2F`/`%5C` segments (any case) must throw a
clear `[unstorage-solid]` error in `keyToUrl`; `urlToKey` returns undefined for such member
paths. Encoded colons and percent signs still round-trip.

`listContainer(containerUrl, base, fetchImpl)` is a compatibility wrapper around
`@jeswr/ldp-container`'s `readContainerMembers`; preserve its signature and null on 404/410.
Keep the existing scope delegate as an additional member filter, including its stricter
root-alias rules. Malformed and unsafe entries are skipped individually. Keep recursion,
request headers, key mapping, clear ordering, watch handling, and redirect wrappers local.
This package is security-critical: no guard may be loosened.

Scope wrappers use guarded-fetch's `snapshotFetchInput(input, undefined)` to validate fresh
Request snapshots, never caller-shadowable `url` properties. Match main's transport boundary:
forward the captured URL string plus the explicit init, forcing `redirect: "manual"`.
Bodies, signals, and policies supplied in init survive; Request-only fields are not inherited.
Capture URL objects once and fetch the checked string. Keep `SolidRedirectError` identical
to `RedirectRefusedError`, including the legacy `(url, status)` constructor contract.
