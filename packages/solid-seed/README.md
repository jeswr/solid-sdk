<!-- AUTHORED-BY GPT-5.6 Sol via codex -->

# @jeswr/solid-seed

Browser-safe, server-agnostic pod provisioning and deterministic resource seeding. The package
accepts `@jeswr/synthetic-rdf` output plus a pod layout, rebases generated identities into each
pod's real IRI space, writes resources through an injected Fetch-compatible target, and authors
WAC documents through `@solid/object` typed wrappers.

## Usage

```ts
import { SeedError, seedPods } from "@jeswr/solid-seed";

const manifest = await seedPods({
  mode: "create",
  data: generated,
  provisioner: harness,
  layout: {
    pods: [
      {
        account: { provision: {} },
        resources: [
          {
            path: "/mortgage/applicant",
            source: { instance: { shape: "https://example.test/ApplicantShape" } },
            access: {
              publicRead: false,
              agents: [{ webid: lenderWebid, modes: ["read"] }],
            },
          },
        ],
      },
    ],
  },
});
```

`SeedTarget` and `AccountProvisioner` are structural interfaces. A test harness, a deployed pod,
or an in-browser pod can satisfy them without this package importing any server implementation.
The main entry contains no Node built-ins.

## Modes and groups

- `create` uses `If-None-Match: *` and treats existing state as an error.
- `ensure` skips an existing primary resource but creates or rewrites its requested ACL so access
  policy converges. For an expander group it first requires every primary resource and requested
  ACL sidecar to exist or none to exist; partial groups fail before writes.
- `replace` unconditionally rewrites every selected resource and ACL.

One `ResourceExpander` is called once per run and becomes a stable `group-<layout-index>` unit.
Because LDP has no multi-resource transaction, a mid-group failure rejects with `SeedError`. Its
manifest marks written, failed, and unwritten members and the group as `partial`. Re-run the same
deterministic layout in `replace` mode to converge the group:

```ts
try {
  await seedPods(options);
} catch (error) {
  if (error instanceof SeedError) {
    console.error(error.manifest);
    await seedPods({ ...options, mode: "replace" });
  }
}
```

Concurrent mutation is outside the contract: seeding expects exclusive control of its target
pods. `placeholderBase` defaults to `urn:synthetic:` and must match a custom base passed to
synthetic-rdf; an unmapped placeholder IRI is rejected before any body is written.

## ACL safety

An `access` entry creates a sibling `.acl` resource. Every such ACL always grants the target owner
read, write, and control, then adds the requested public or named-agent rules. ACL RDF is built
with `@solid/object`'s `Authorization` wrapper and serialized with `n3.Writer`; there are no Turtle
string templates.

A resource with an `access` entry is written in three steps so its data never sits under an
inherited (possibly public) container ACL: an empty placeholder is created, its ACL is written, and
only then is the data written. Before writing the ACL the seeder requires the server to advertise
it at `<resource>.acl` with `Link: rel="acl"`; a server that uses another location (ACP `.acr`) or
none fails the seed rather than storing an ACL that grants nothing. If the ACL or data write fails,
a placeholder created by this run (with the ACL this run wrote for it) is deleted. A container's
description is skipped when the server answers 409 to a PUT on an existing container, as CSS does
(CSS also ignores a container body on creation). A process that dies between placeholder and data leaves the empty
placeholder, which `ensure` cannot tell from real data; re-run with `replace` after a crash.

`baseUrl` must be an origin (`https://pod.example`), not a path-based pod. Paths cannot target
auxiliary resources (`.acl`, `.acr`, `.meta`) or percent-encode an unreserved character, `/` or `\`
(servers such as CSS decode `/x.%61cl` to `/x.acl`); this includes `%7E`, so write `~` as is. Every request is sent with
`redirect: "error"`, so an `authFetch` wrapper must pass `init.redirect` through; error details read
at most 4 KiB of a response.
