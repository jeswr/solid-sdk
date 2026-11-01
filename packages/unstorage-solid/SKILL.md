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
The shared helper accepts only NamedNode descendants of the currently listed container,
in addition to the driver-base guard. Prefix clear must never follow sibling resources or
containers, including sibling cycles, or DELETE outside the cleared prefix.
The helper streams listing bodies with a default 16 MiB byte limit and the parser's default
quad limit. Preserve PARSE_LIMIT failures instead of treating them as empty listings.

Scope wrappers use guarded-fetch's `snapshotFetchInput(input, init, { metadataOnly: true })` to validate fresh
Request snapshots, never caller-shadowable `url` properties. Match main's transport boundary:
forward the captured URL string plus the explicit init, forcing `redirect: "manual"`.
Bake that init into `snapshot.init` with the existing spread semantics and forward only the
captured object, so caller accessors run once across the composed wrappers.
Bodies, signals, and policies supplied in init survive; Request-only fields are not inherited.
When init supplies a non-null body, metadata capture uses an empty placeholder for body-capable
inputs without transferring or checking the discarded body. Never forward that placeholder.
Capture URL objects once and fetch the checked string. Keep `SolidRedirectError` identical
to `RedirectRefusedError`, including the legacy `(url, status)` constructor contract.
