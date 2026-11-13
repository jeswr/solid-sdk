// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/noNonNullAssertion: Explicit fixtures and cardinality assertions establish these entries.
import type { Grant, Subject } from "@jeswr/pod-access";
import { describe, expect, it } from "vitest";
import { classificationForType } from "../src/apps/home/lib/model/classify";
import {
  aggregateHoldings,
  classifyAgent,
  type GrantRecord,
  modeLabel,
  planRevoke,
  roleForModes,
  roleLabel,
  type WalkedAccess,
} from "../src/apps/home/lib/permissions";

const owner = "https://pod.test/profile#me";
const bob = "https://bob.test/profile#me";
function grant(subject: Subject, options: Partial<Grant> = {}): Grant {
  return {
    who: [[subject]],
    modes: new Set(["read"]),
    appliesTo: "resource",
    except: [],
    source: { url: "https://pod.test/.acl", node: "https://pod.test/.acl#rule" },
    ...options,
  };
}
function node(grants: Grant[], options: Partial<WalkedAccess> = {}): WalkedAccess {
  return {
    url: "https://pod.test/docs/",
    isContainer: true,
    policy: { grants, denials: [] },
    system: "wac",
    inherited: false,
    ...options,
  };
}
const classify = () => classificationForType("docs");
const person: Subject = { kind: "agent", webId: bob };
describe("Home permission holdings", () => {
  it("classifies origins, known client IDs, WebIDs and pseudo agents, skipping unsupported matchers", () => {
    for (const [subject, kind, id] of [
      [person, "person", bob],
      [
        { kind: "agent", webId: "https://app.test/client.json" },
        "app",
        "https://app.test/client.json",
      ],
      [
        { kind: "agent", webId: "https://app.test/client.jsonld" },
        "app",
        "https://app.test/client.jsonld",
      ],
      [{ kind: "agent", webId: "https://app.test/client_id" }, "app", "https://app.test/client_id"],
      [
        { kind: "agent", webId: "https://app.test/client-id/web" },
        "app",
        "https://app.test/client-id/web",
      ],
      [
        { kind: "agent", webId: "http://app.test/client.json" },
        "person",
        "http://app.test/client.json",
      ],
      [
        { kind: "agent", webId: "https://app.test/client.json#me" },
        "person",
        "https://app.test/client.json#me",
      ],
      [{ kind: "agent", webId: "urn:person:bob" }, "person", "urn:person:bob"],
      [{ kind: "origin", origin: "https://app.test" }, "app", "https://app.test"],
      [{ kind: "client", clientId: "urn:client:known" }, "app", "urn:client:known"],
      [{ kind: "public" }, "public", "public"],
      [{ kind: "authenticated" }, "authenticated", "authenticated"],
    ] as const)
      expect(classifyAgent(subject)).toEqual({ kind, key: id, id });
    for (const subject of [
      { kind: "group", group: "urn:group" },
      { kind: "vc", vcType: "urn:vc" },
      { kind: "issuer", issuer: "urn:issuer" },
      { kind: "owner" },
      { kind: "creator" },
    ] as Subject[])
      expect(classifyAgent(subject)).toBeUndefined();
  });
  it("maps the highest role and every glossary label without assuming Control implies Read", () => {
    const cases = [
      [[], "viewer"],
      [["read"], "viewer"],
      [["append"], "commenter"],
      [["write", "append"], "editor"],
      [["control"], "manager"],
    ] as const;
    for (const [modes, role] of cases) expect(roleForModes(modes)).toBe(role);
    expect(
      ["viewer", "commenter", "editor", "manager"].map((role) =>
        roleLabel(role as Parameters<typeof roleLabel>[0]),
      ),
    ).toEqual(["Can see", "Can comment", "Can change", "Can manage access"]);
    expect(
      ["read", "write", "append", "control"].map((mode) =>
        modeLabel(mode as Parameters<typeof modeLabel>[0]),
      ),
    ).toEqual(["Read", "Change", "Add", "Manage access"]);
  });
  it("pins public/authenticated, omits the owner and compacts inherited default grants", () => {
    const grants = [
      grant(person, { appliesTo: "both" }),
      grant({ kind: "agent", webId: owner }),
      grant({ kind: "public" }, { appliesTo: "both" }),
      grant({ kind: "authenticated" }),
    ];
    const result = aggregateHoldings(
      [
        node(grants),
        node([grants[0]!, grants[2]!], {
          url: "https://pod.test/docs/a",
          isContainer: false,
          inherited: true,
          inheritedFrom: "https://pod.test/docs/",
        }),
      ],
      { webId: owner, classify },
    );
    expect(result.rows.map((row) => row.key)).toEqual(["public", "authenticated", bob]);
    expect(result.summary).toEqual({ apps: 0, people: 1, publicItems: 2 });
    const lines = result.rows[2]!.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.inherited).toBe(false);
    expect(lines[0]!.resources).toEqual([
      expect.objectContaining({ url: "https://pod.test/docs/", scope: "resource" }),
      expect.objectContaining({
        url: "https://pod.test/docs/",
        inheritedFrom: "https://pod.test/docs/",
        scope: "members",
      }),
    ]);
    expect(lines[0]!.folderScope).toBeUndefined();
    const inheritedOnly = aggregateHoldings(
      [
        node([grant(person, { appliesTo: "members" })], {
          inherited: true,
          inheritedFrom: "https://pod.test/",
        }),
      ],
      { webId: owner, classify },
    );
    expect(inheritedOnly.rows[0]!.lines[0]!.resources[0]!.inheritedFrom).toBe("https://pod.test/");
    expect(inheritedOnly.rows[0]!.lines[0]!.inherited).toBe(true);
    expect(inheritedOnly.rows[0]!.lines[0]!.folderScope).toBeUndefined();
  });
  it("merges separate equal authorizations in either order and retains each scope for revoke", () => {
    const grants = [
      grant(person, {
        modes: new Set(["read", "write"]),
        source: { url: "https://pod.test/docs/.acl", node: "own" },
      }),
      grant(person, {
        appliesTo: "members",
        modes: new Set(["write", "read"]),
        source: { url: "https://pod.test/docs/.acl", node: "members" },
      }),
    ];
    for (const ordered of [grants, [...grants].reverse()]) {
      const lines = aggregateHoldings([node(ordered)], { webId: owner, classify }).rows[0]!.lines;
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ inherited: false, modes: ["read", "append", "write"] });
      expect(lines[0]!.folderScope).toBeUndefined();
      expect(
        planRevoke(lines[0]!, "line").changes.map((change) => [change.node, change.scope]),
      ).toEqual([
        ["own", "resource"],
        ["members", "members"],
      ]);
    }
  });
  it("labels unequal own scopes without confusing them with ancestor grants", () => {
    const own = grant(person);
    const members = grant(person, { appliesTo: "members", modes: new Set(["write"]) });
    for (const ordered of [
      [own, members],
      [members, own],
    ]) {
      const lines = aggregateHoldings([node(ordered)], { webId: owner, classify }).rows[0]!.lines;
      expect(lines).toHaveLength(2);
      expect(lines.find((line) => line.folderScope === "resource")).toMatchObject({
        inherited: false,
        modes: ["read"],
      });
      expect(lines.find((line) => line.folderScope === "members")).toMatchObject({
        inherited: true,
        modes: ["append", "write"],
      });
    }
    const lines = aggregateHoldings(
      [node([own]), node([members], { inherited: true, inheritedFrom: "https://pod.test/" })],
      { webId: owner, classify },
    ).rows[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => !line.folderScope)).toBe(true);
  });
  it("keeps different purposes, expiry and conditions apart across folder scopes", () => {
    for (const field of ["purpose", "expiresAt", "conditions"]) {
      const own = grant(person, { source: { url: "https://pod.test/docs/.acl", node: "own" } });
      const members = grant(person, {
        appliesTo: "members",
        source: { ...own.source, node: "members" },
        ...(field === "conditions"
          ? { who: [[person, { kind: "origin" as const, origin: "https://app.test" }]] }
          : {}),
      });
      const records = new Map<string, GrantRecord>([
        [
          "members",
          field === "purpose"
            ? { purpose: { label: "Preview" } }
            : field === "expiresAt"
              ? { expiresAt: "2030-01-01" }
              : {},
        ],
      ]);
      const lines = aggregateHoldings([node([own, members])], {
        webId: owner,
        classify,
        records,
      }).rows.find((row) => row.id === bob)!.lines;
      expect(lines).toHaveLength(2);
      expect(lines.find((line) => line.inherited)?.folderScope).toBe("members");
      expect(lines.find((line) => !line.inherited)?.folderScope).toBeUndefined();
    }
  });
  it("does not compact a shared ACL line that includes unrelated resources or ancestors", () => {
    const both = grant(person, { appliesTo: "both" });
    for (const extra of [
      node([grant(person)], { url: "https://pod.test/other/" }),
      node([grant(person, { appliesTo: "members" })], {
        url: "https://pod.test/other/",
        inherited: true,
        inheritedFrom: "https://pod.test/docs/",
      }),
    ]) {
      const lines = aggregateHoldings([node([both]), extra], { webId: owner, classify }).rows[0]!
        .lines;
      expect(lines).toHaveLength(2);
      expect(lines.every((line) => !line.folderScope)).toBe(true);
    }
    expect(
      aggregateHoldings([node([both], { inheritedFrom: "https://pod.test/" })], {
        webId: owner,
        classify,
      }).rows[0]!.lines,
    ).toHaveLength(2);
  });
  it("unions modes, deduplicates resources, preserves metadata and uses earliest/latest grant dates", () => {
    const early: GrantRecord = {
      created: "2024-01-01T00:00:00.000Z",
      modified: "2024-05-01T00:00:00.000Z",
      purpose: { label: "Write my diary" },
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    const late: GrantRecord = {
      created: "2025-01-01T00:00:00.000Z",
      modified: "2025-02-01T00:00:00.000Z",
    };
    const records = new Map([
      ["rule", early],
      ["later", late],
    ]);
    const source = { url: "https://pod.test/docs/.acl", node: "rule" };
    const grants = [
      grant(person, { source }),
      grant(person, { source, modes: new Set(["write"]) }),
    ];
    const result = aggregateHoldings(
      [
        node(grants),
        node([grant(person, { source: { ...source, node: "later" } })], {
          url: "https://pod.test/docs/b",
          isContainer: false,
        }),
      ],
      { webId: owner, classify, records },
    );
    const row = result.rows[0]!;
    expect(row.since).toBe(early.created);
    expect(row.lastChanged).toBe(late.modified);
    expect(row.lines[0]).toMatchObject({
      modes: ["read", "append", "write"],
      role: "editor",
      purpose: early.purpose,
      expiresAt: early.expiresAt,
    });
    expect(row.lines).toHaveLength(2);
    expect(row.lines[0]!.resources).toHaveLength(1);
    expect(row.lines[0]!.resources[0]!.modes).toEqual(["read", "append", "write"]);
    expect(row.lines[0]!.dataType).toEqual({ id: "docs", label: "Documents" });
    expect(row.lines[0]!.dataType).not.toBe(classify().dataType);
    expect(row.lines[0]!.domainId).toBe("documents");
    const changed = aggregateHoldings(
      [node([grant(person, { source })], { records: new Map([["rule", late]]) })],
      { webId: owner, classify, records },
    );
    expect(changed.rows[0]!.since).toBe(early.created);
    expect(changed.rows[0]!.lastChanged).toBe(late.modified);
    const updated = aggregateHoldings([node(grants)], {
      webId: owner,
      classify,
      records: new Map([
        [
          "rule",
          {
            ...early,
            expiresAt: "2031-01-01T00:00:00.000Z",
            purpose: { label: "An updated purpose" },
          },
        ],
      ]),
    });
    expect(updated.rows[0]!.lines[0]!.key).not.toBe(row.lines[0]!.key);
    const relabelled = aggregateHoldings(
      [node(grants.map((g) => ({ ...g, source: { ...g.source, node: "b99_parser-local" } })))],
      { webId: owner, classify, records: new Map([["b99_parser-local", early]]) },
    );
    expect(relabelled.rows[0]!.lines[0]!.key).toBe(row.lines[0]!.key);
  });
  it("keeps incompatible purposes and durations separate regardless of grant order", () => {
    const source = "https://pod.test/docs/.acl";
    const records = new Map<string, GrantRecord>([
      ["temporary", { purpose: { label: "Preview" }, expiresAt: "2030-01-01" }],
      ["permanent", { purpose: { label: "Preview" } }],
      ["other-purpose", { purpose: { label: "Archive" } }],
      ["other-iri", { purpose: { iri: "urn:archive", label: "Archive" } }],
      ["other-expiry", { purpose: { label: "Preview" }, expiresAt: "2031-01-01" }],
    ]);
    const grants = [...records.keys()].map((id) =>
      grant(person, { source: { url: source, node: id } }),
    );
    for (const ordered of [grants, [...grants].reverse()]) {
      const result = aggregateHoldings([node(ordered)], { webId: owner, classify, records });
      const lines = result.rows[0]!.lines;
      expect(lines).toHaveLength(5);
      expect(new Set(lines.map((line) => line.key)).size).toBe(5);
      for (const line of lines) {
        const changes = planRevoke(line, "line").changes;
        expect(changes).toHaveLength(1);
        expect(line.purpose).toEqual(records.get(changes[0]!.node)!.purpose);
        expect(line.expiresAt).toBe(records.get(changes[0]!.node)!.expiresAt);
      }
    }
  });
  it("retains each covered data type in heterogeneous inherited subtrees and targets the parent", () => {
    const root = "https://pod.test/";
    const inherited = grant(person, { appliesTo: "members" });
    const nodes = [
      node([inherited], { url: root }),
      ...["notes/", "notes/a", "photos/", "photos/a"].map((path) =>
        node([inherited], {
          url: root + path,
          isContainer: path.endsWith("/"),
          inherited: true,
          inheritedFrom: root,
        }),
      ),
    ];
    for (const ordered of [nodes, [...nodes].reverse()]) {
      const result = aggregateHoldings(ordered, {
        webId: owner,
        classify: (url) => classificationForType(url.includes("photos") ? "photos" : "notes"),
      });
      const lines = result.rows[0]!.lines;
      expect(lines.map((line) => line.dataType?.id).sort()).toEqual(["notes", "photos"]);
      expect(lines.every((line) => line.resources.length === 1)).toBe(true);
      for (const line of lines)
        expect(planRevoke(line, "line").changes).toEqual([
          expect.objectContaining({ resource: root, scope: "members" }),
        ]);
      expect(planRevoke(result.rows[0]!, "all").changes).toHaveLength(1);
    }
  });
  it("preserves condition metadata and counts the widest public Read exposure", () => {
    const publicSubject: Subject = { kind: "public" };
    const origin: Subject = { kind: "origin", origin: "https://app.test" };
    const restricted = grant(publicSubject, { who: [[publicSubject, origin]] });
    const result = aggregateHoldings([node([restricted])], { webId: owner, classify });
    expect(result.summary).toEqual({ apps: 1, people: 0, publicItems: 1 });
    expect(result.rows.find((row) => row.kind === "public")!.lines[0]).toMatchObject({
      conditions: [origin],
      resources: [expect.objectContaining({ clause: [publicSubject, origin] })],
    });
    expect(result.rows.find((row) => row.kind === "app")!.lines[0]!.conditions).toEqual([
      publicSubject,
    ]);
    const mixed = aggregateHoldings([node([restricted, grant(publicSubject)])], {
      webId: owner,
      classify,
    });
    expect(mixed.summary.publicItems).toBe(1);
    expect(mixed.rows[0]!.lines).toHaveLength(2);
    const signedIn = aggregateHoldings(
      [node([grant(publicSubject, { who: [[publicSubject, { kind: "authenticated" }]] })])],
      { webId: owner, classify },
    );
    expect(signedIn.summary.publicItems).toBe(0);
    const alternate = aggregateHoldings(
      [node([grant(publicSubject, { who: [[publicSubject, origin], [publicSubject]] })])],
      { webId: owner, classify },
    );
    expect(alternate.summary.publicItems).toBe(1);
    expect(alternate.rows[0]!.lines).toHaveLength(2);
  });
  it("sorts recent grants before unknown dates, breaking ties by id; keeps Other data honest", () => {
    const nodes = [
      node([
        grant({ kind: "origin", origin: "https://z.test" }, { source: { url: "s", node: "z" } }),
      ]),
      node([grant(person, { source: { url: "s", node: "bob" } })]),
      node([grant({ kind: "agent", webId: "https://a.test/#me" })]),
      node([grant(person, { source: { url: "s", node: "newest" } })]),
    ];
    const records = new Map([
      ["z", { created: "2024-01-01" }],
      ["bob", { created: "2025-01-01" }],
      ["newest", { created: "2023-01-01" }],
    ]);
    const result = aggregateHoldings(nodes, { webId: owner, classify: () => undefined, records });
    expect(result.rows.map((r) => r.key)).toEqual([bob, "https://z.test", "https://a.test/#me"]);
    expect(result.rows[0]!.since).toBe("2023-01-01");
    expect(result.rows[0]!.lastChanged).toBe("2025-01-01");
    expect(result.rows[0]!.lines[0]).toMatchObject({ dataType: undefined, domainId: "other" });
    expect(result.summary).toEqual({ apps: 1, people: 2, publicItems: 0 });
    expect(
      aggregateHoldings([...nodes].reverse(), {
        webId: owner,
        classify: () => undefined,
        records,
      }).rows.map((r) => r.key),
    ).toEqual(result.rows.map((r) => r.key));
  });
  it("skips exclusions, denials, groups and empty modes without claiming unconditional access", () => {
    const group: Subject = { kind: "group", group: "urn:g" };
    const grants = [
      grant(group),
      grant(person, { except: [{ kind: "public" }] }),
      grant(person, { modes: new Set() }),
    ];
    expect(
      aggregateHoldings(
        [node(grants), node([], { policy: { grants: [grant(person)], denials: [grant(person)] } })],
        { webId: owner, classify },
      ).rows,
    ).toEqual([]);
    expect(aggregateHoldings([], { webId: owner, classify })).toEqual({
      rows: [],
      summary: { apps: 0, people: 0, publicItems: 0 },
    });
    // A conjunction with an unsupported matcher is skipped as a whole.
    expect(
      aggregateHoldings([node([grant(person, { who: [[person, group]] })])], {
        webId: owner,
        classify,
      }).rows,
    ).toEqual([]);
  });
});
