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
  policy converges, as long as that only narrows access: it refuses to grant more than the
  existing Turtle ACL already does (or anything beyond the owner when there is none), because it
  did not write the existing content. Use `replace` to publish it. The existing ACL counts as
  narrower only when it holds every desired statement and the authorizations it shares with the
  desired ACL carry nothing but grant statements (`rdf:type`, `acl:accessTo`, `acl:default`,
  `acl:agent`, `acl:agentClass`, `acl:agentGroup`, `acl:mode`); a restriction such as `acl:origin`
  would be lost, so it refuses. The rewrite is conditional (`If-Match`) on the ETag it checked;
  a server that sends no ETag gets an unconditional rewrite, and one that sends only weak ETags
  always answers 412, so the rewrite fails closed. In a group, every member is checked before any
  ACL is written, so a broadening is refused before any change. For an expander group it first requires every primary resource and requested
  ACL sidecar to exist or none to exist; partial groups fail before writes.
- `replace` rewrites every selected resource and ACL whatever their current content, except that
  it will not broaden the ACL of an existing container (and rewrites that ACL with `If-Match` on
  the ETag it checked, so a server with only weak ETags answers 412 and the seed fails closed): its `acl:default` reaches children this run did not
  write. Delete the container first, or grant that access by hand. Grants on a container this run
  created apply only once a Turtle read of it lists no members, since a 201 alone does not prove it
  new.

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

A resource with an `access` entry is written so that the seeder never puts content it has not just
written under broader grants than it already had: an empty placeholder is created (or the existing resource
found), an owner-only ACL is written, then the data, and only then the ACL with the requested grants.
A replacement therefore never exposes the superseded content to the new grants (and an existing
container's grants may only narrow, since `acl:default` reaches its other children). Before writing any
ACL the seeder requires the server to advertise it at `<resource>.acl` with `Link: rel="acl"`; a
server that uses another location (ACP `.acr`) or none fails the seed rather than storing an ACL
that grants nothing. If a later step fails, a failed replacement keeps the owner-only ACL, and a
resource this run created is deleted while its ACL still protects it; the ACL is then deleted only
once the resource is confirmed gone (a successful DELETE or 404). If the resource cannot be removed,
the ACL is kept and the error says so. A 202 Accepted counts as neither a completed write nor a
completed delete, so no ACL transition advances on one. The final grant over a created
container is written with `If-Match` on the ETag of the owner-only ACL this run wrote, so an ACL
changed in between fails the seed (a server that returns no strong ETag gets an unconditional
write). A container's description is skipped when the server answers
409 to a PUT on an existing container, as CSS does (CSS also ignores a container body on creation).
Only a 201 to the placeholder PUT counts as this run creating the resource, and on a container
CSS answers 409 rather than 412 to that conditional PUT, which counts as existing. A process that
dies between placeholder and data leaves the empty placeholder under the owner-only ACL, which
`ensure` cannot tell from real data (nor will it broaden that ACL); re-run with `replace` after a
crash or a failed replacement.

`baseUrl` must be an origin (`https://pod.example`), not a path-based pod. Paths cannot target
auxiliary resources (`.acl`, `.acr`, `.meta`) or percent-encode an unreserved character, `/`, `\` or `%`
(servers such as CSS decode `/x.%61cl` to `/x.acl`, and a double encoding like `%2561` depends on how often the server decodes); this includes `%7E`, so write `~` as is. Every request is sent with
`redirect: "error"`, so an `authFetch` wrapper must pass `init.redirect` through; error details read
at most 4 KiB of a response.
