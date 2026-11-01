// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Explicit fixtures and cardinality assertions establish these entries.
import type { Grant, Subject } from "@jeswr/pod-access";
import { describe, expect, it } from "vitest";
import { classificationForType } from "../src/apps/home/lib/model/classify";
import {
  aggregateHoldings,
  classifyAgent,
  type GrantRecord,
  modeLabel,
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
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.inherited)?.resources).toEqual([
      expect.objectContaining({
        url: "https://pod.test/docs/",
        inheritedFrom: "https://pod.test/docs/",
        scope: "members",
      }),
    ]);
    expect(lines.every((line) => line.resources.length === 1)).toBe(true);
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
    expect(row.lines[0]!.resources).toHaveLength(2);
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
    expect(updated.rows[0]!.lines[0]!.key).toBe(row.lines[0]!.key);
    const relabelled = aggregateHoldings(
      [node(grants.map((g) => ({ ...g, source: { ...g.source, node: "b99_parser-local" } })))],
      { webId: owner, classify },
    );
    expect(relabelled.rows[0]!.lines[0]!.key).toBe(row.lines[0]!.key);
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
