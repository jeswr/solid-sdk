---
name: solid-seed
description: Use when provisioning Solid pod targets, seeding @jeswr/synthetic-rdf output, defining pod layouts or resource expanders, choosing create/ensure/replace behavior, recovering partial expander groups, or authoring seed ACLs.
---
<!-- AUTHORED-BY GPT-5.6 Sol via codex -->

# Deterministic Solid pod seeding

Keep server lifecycle ownership outside this package. Pass a structural `SeedTarget` for an
existing account or an `AccountProvisioner` when the layout creates accounts. Do not import a
harness or server package into application code that defines a layout.

## Layout rules

- Paths are pod-root-relative and begin with `/`; never target `.acl` directly.
- Prefer `{ instance }` for generated RDF, `{ dataset }` for caller-owned RDF/JS data, and
  `{ body }` only for already-issued artifacts such as JSON-LD VCs.
- Assign one generated instance to one resource per pod. Cross-instance references are rebased
  only after every assignment is known.
- Pass `placeholderBase` whenever synthetic-rdf used a non-default base. An unmapped placeholder
  is an error, never an absolute IRI that may leak into the pod.
- An expander represents one mutually dependent issuance or computation. Call that computation
  once and return every related resource from the same result.

## Mode choice and recovery

Use `create` for fresh e2e pods, `ensure` for long-lived development pods, and `replace` for a
deliberate deterministic rewrite. `ensure` treats expander groups as all-or-none: all members skip,
none are created, and a partial set errors. `create` also preflights the group and keeps
`If-None-Match: *` on every actual write.

On `SeedError`, inspect `error.manifest`. A group marked `partial` can contain `created` or
`replaced` members followed by one `failed` member and `unwritten` members. Repair it by running
the exact same deterministic layout in `replace` mode. Do not retry only the failed member because
the group output is one consistency unit.

## Access control and tests

Specify access through `AccessSpec`; never emit `.acl` Turtle yourself. The package uses
`@solid/object` wrappers and always preserves owner read/write/control. Test pure behavior with an
injected Fetch implementation, and keep one integration suite against the selected Solid server
outside the browser-safe core. Assert content types, conditional headers, read-back bytes, group
manifest states, and typed ACL authorization values.
