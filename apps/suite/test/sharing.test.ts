// AUTHORED-BY Codex GPT-6.1-Sol

import { LiteralAs, LiteralFrom, NamedGraphDataset, SetFrom } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  diffSharing,
  readSharing,
  SharingError,
  type SharingSelection,
} from "../src/apps/drive/lib/sharing";
import {
  ACL,
  ACP,
  ALICE,
  authorization,
  BOB,
  CAROL,
  COMMENTS,
  context,
  document,
  FILE,
  FixtureAcrs,
  input,
  matcher,
  Properties,
  PUBLIC,
  policy,
  properties,
} from "./sharing-fixtures";

const restricted: SharingSelection = { people: [], link: "none", public: "none" };
const select = (
  webId: string,
  role: "viewer" | "commenter" | "editor" | "owner",
): SharingSelection => ({ ...restricted, people: [{ webId, role }] });

for (const model of ["wac", "acp"] as const) {
  const grant = model === "wac" ? authorization : policy;
  describe(model, () => {
    it("projects an empty effective document and leaves it unchanged", () => {
      const state = readSharing(input(document(model)));
      expect(state).toEqual({
        ...restricted,
        general: { inherited: false, explicit: false, sources: [] },
      });
      expect(diffSharing(input(document(model)), restricted)).toEqual([]);
    });
    it("unions split grants, deduplicates people and sorts by WebID", () => {
      const doc = document(model);
      grant(doc, BOB, ["Read"]);
      grant(doc, ALICE, ["Read"]);
      grant(doc, BOB, ["Write", "Append"]);
      grant(doc, CAROL, []);
      const snapshot = [...doc.dataset];
      expect(readSharing(input(doc)).people).toEqual([
        { webId: ALICE, role: "viewer", inherited: false, explicit: true, sources: [doc.source] },
        { webId: BOB, role: "editor", inherited: false, explicit: true, sources: [doc.source] },
      ]);
      expect([...doc.dataset]).toEqual(snapshot);
      expect(diffSharing(input(doc), readSharing(input(doc)))).toEqual([]);
    });
    it("distinguishes comments-container Append from file access", () => {
      const doc = document(model);
      const comment = document(model, false, COMMENTS);
      grant(doc, ALICE, ["Read"]);
      grant(comment, ALICE, ["Append"]);
      grant(comment, BOB, ["Append"]);
      const value = { ...input(doc), comments: context(comment) };
      expect(readSharing(value).people[0]).toEqual({
        webId: ALICE,
        role: "commenter",
        explicit: true,
        inherited: false,
        sources: [comment.source, doc.source].sort(),
      });
      expect(diffSharing(value, readSharing(value))).toEqual([]);
      expect(diffSharing(value, select(ALICE, "viewer"))).toEqual([
        {
          model,
          source: comment.source,
          resource: COMMENTS,
          principal: { kind: "webid", webId: ALICE },
          add: [],
          remove: ["Append"],
          inherited: false,
        },
      ]);
      expect(diffSharing(value, restricted)).toHaveLength(2);
    });
    it.each(
      [false, true].flatMap((inherited) =>
        [["Read"], ["Append"], ["Write"]].map((modes) => ({ inherited, modes })),
      ),
    )("rejects anonymous comments permissions $modes (inherited: $inherited)", ({
      inherited,
      modes,
    }) => {
      const doc = document(model);
      const comment = document(model, inherited, COMMENTS);
      grant(comment, PUBLIC, modes);
      const value = { ...input(doc), comments: { resource: COMMENTS, documents: [comment] } };
      const snapshot = [...comment.dataset];
      // Anonymous comments matter even without a named file-access row.
      expect(() => readSharing(value)).toThrow(SharingError);
      expect(() => diffSharing(value, restricted)).toThrow(SharingError);
      grant(doc, ALICE, ["Read"]);
      expect(() => readSharing(value)).toThrow(SharingError);
      expect(() => diffSharing(value, select(ALICE, "viewer"))).toThrow(SharingError);
      expect(() => diffSharing(value, select(ALICE, "editor"))).toThrow(SharingError);
      grant(doc, PUBLIC, ["Read"]);
      expect(() => readSharing(value)).toThrow(SharingError);
      expect(() => diffSharing(value, restricted)).toThrow(SharingError);
      expect([...comment.dataset]).toEqual(snapshot);
    });
    it.each([
      false,
      true,
    ])("ignores empty anonymous comments grants (inherited: %s)", (inherited) => {
      const doc = document(model);
      const comment = document(model, inherited, COMMENTS);
      grant(doc, ALICE, ["Read"]);
      grant(comment, PUBLIC, []);
      grant(comment, PUBLIC, ["Append"], "https://example.org/unrelated/");
      const value = { ...input(doc), comments: { resource: COMMENTS, documents: [comment] } };
      const state = readSharing(value);
      expect(state.people).toEqual([
        { webId: ALICE, role: "viewer", inherited: false, explicit: true, sources: [doc.source] },
      ]);
      expect(state.general).toEqual({ inherited: false, explicit: false, sources: [] });
      expect(diffSharing(value, state)).toEqual([]);
      expect(diffSharing(value, select(ALICE, "editor"))).toEqual([
        {
          model,
          source: doc.source,
          resource: FILE,
          principal: { kind: "webid", webId: ALICE },
          add: ["Write"],
          remove: [],
          inherited: false,
        },
      ]);
    });
    it.each([false, true])("rejects authenticated-agent comments (inherited: %s)", (inherited) => {
      const doc = document(model);
      const comment = document(model, inherited, COMMENTS);
      grant(doc, ALICE, ["Read"]);
      if (model === "wac") {
        const auth = authorization(comment, ALICE, ["Append"]);
        auth.agent.clear();
        auth.agentClass.add(`${ACL}AuthenticatedAgent`);
      } else {
        policy(comment, `${ACP}AuthenticatedAgent`, ["Append"]);
      }
      const value = { ...input(doc), comments: { resource: COMMENTS, documents: [comment] } };
      expect(() => readSharing(value)).toThrow(SharingError);
      expect(() => diffSharing(value, select(ALICE, "viewer"))).toThrow(SharingError);
      expect(() => diffSharing(value, restricted)).toThrow(SharingError);
    });
    it("marks inherited access and refuses removing it", () => {
      const doc = document(model, true);
      grant(doc, ALICE, ["Read"]);
      grant(doc, PUBLIC, ["Read"]);
      const state = readSharing(input(doc));
      expect(state.people[0]).toMatchObject({
        role: "viewer",
        inherited: true,
        explicit: false,
        sources: [doc.source],
      });
      expect(state.general).toEqual({ inherited: true, explicit: false, sources: [doc.source] });
      expect(diffSharing(input(doc), state)).toEqual([]);
      expect(() => diffSharing(input(doc), restricted)).toThrow("Inherited access");
      expect(() => diffSharing(input(doc), { ...state, link: "none", public: "none" })).toThrow(
        "Inherited access",
      );
    });
    it("does not apply defaults/member controls to the parent itself", () => {
      const inherited = document(model, true);
      grant(inherited, ALICE, ["Read"]);
      inherited.inherited = false;
      expect(
        readSharing({ access: { resource: inherited.governingResource, documents: [inherited] } })
          .people,
      ).toEqual([]);
    });
    it("ignores unrelated resource grants and keeps exact resource identity", () => {
      const doc = document(model);
      grant(doc, BOB, ["Read"], `${FILE}/`);
      grant(doc, ALICE, ["Read"], "https://example.org/elsewhere");
      expect(readSharing(input(doc)).people).toEqual([]);
    });
    it.each([
      "viewer",
      "editor",
    ] as const)("reports anonymous %s access without promising a secret link", (role) => {
      const doc = document(model);
      grant(doc, PUBLIC, role === "editor" ? ["Read", "Write"] : ["Read"]);
      const state = readSharing(input(doc));
      expect(state).toMatchObject({ people: [], link: role, public: "viewer" });
      expect(diffSharing(input(doc), state)).toEqual([]);
      const delta = diffSharing(input(doc), restricted);
      expect(delta[0]).toMatchObject({
        principal: { kind: "public" },
        add: [],
        remove: role === "editor" ? ["Read", "Write"] : ["Read"],
      });
    });
    it("retains anonymous Read if either presentation requests it", () => {
      const doc = document(model);
      grant(doc, PUBLIC, ["Read", "Write", "Append"]);
      expect(diffSharing(input(doc), { ...restricted, public: "viewer" })[0]).toMatchObject({
        add: [],
        remove: ["Write", "Append"],
      });
      const empty = input(document(model));
      expect(diffSharing(empty, { ...restricted, link: "viewer" })[0]).toMatchObject({
        add: ["Read"],
        remove: [],
      });
      expect(diffSharing(empty, { ...restricted, link: "editor" })[0]).toMatchObject({
        add: ["Read", "Write"],
      });
    });
    it.each(
      [["Write"], ["Append"], ["Read", "Control"], ["Read", "Append"]].map((modes) => ({ modes })),
    )("refuses unrepresentable person modes $modes", ({ modes }) => {
      const doc = document(model);
      grant(doc, ALICE, modes);
      expect(() => readSharing(input(doc))).toThrow(SharingError);
    });
    it.each(
      [["Write"], ["Read", "Append"], ["Read", "Write", "Control"]].map((modes) => ({ modes })),
    )("refuses unrepresentable public modes $modes", ({ modes }) => {
      const doc = document(model);
      grant(doc, PUBLIC, modes);
      expect(() => readSharing(input(doc))).toThrow(SharingError);
    });
    it("rejects unknown modes rather than losing permissions", () => {
      const doc = document(model);
      grant(doc, ALICE, ["Read", "Execute"]);
      expect(() => readSharing(input(doc))).toThrow("Unsupported access mode");
    });
    it("emits only changed modes and preserves redundant Append on promotion", () => {
      const doc = document(model);
      grant(doc, ALICE, ["Read", "Write", "Append"]);
      grant(doc, BOB, ["Read"]);
      const value = {
        ...restricted,
        people: [
          { webId: ALICE, role: "editor" as const },
          { webId: BOB, role: "editor" as const },
        ],
      };
      expect(diffSharing(input(doc), value)).toEqual([
        {
          model,
          resource: FILE,
          source: doc.source,
          principal: { kind: "webid", webId: BOB },
          add: ["Write"],
          remove: [],
          inherited: false,
        },
      ]);
      expect(diffSharing(input(doc), select(ALICE, "viewer"))[0]).toMatchObject({
        add: [],
        remove: ["Write", "Append"],
      });
      expect(diffSharing(input(doc), select(ALICE, "owner"))[0]).toMatchObject({
        add: model === "wac" ? ["Control"] : ["Read", "Write"],
        remove: [],
      });
    });
    it("adds commenter with two scoped deltas and can promote them to editor", () => {
      const doc = document(model);
      const comment = document(model, false, COMMENTS);
      const value = { ...input(doc), comments: context(comment) };
      expect(diffSharing(value, select(ALICE, "commenter"))).toEqual([
        {
          model,
          source: doc.source,
          resource: FILE,
          principal: { kind: "webid", webId: ALICE },
          add: ["Read"],
          remove: [],
          inherited: false,
        },
        {
          model,
          source: comment.source,
          resource: COMMENTS,
          principal: { kind: "webid", webId: ALICE },
          add: ["Append"],
          remove: [],
          inherited: false,
        },
      ]);
      grant(doc, ALICE, ["Read"]);
      grant(comment, ALICE, ["Append"]);
      expect(diffSharing(value, select(ALICE, "editor"))).toHaveLength(1);
    });
    it.each([
      "editor",
      "owner",
    ] as const)("promotes a viewer to %s without a comments destination", (role) => {
      const doc = document(model);
      grant(doc, ALICE, ["Read"]);
      const value = { ...input(doc), comments: { resource: COMMENTS, documents: [] } };
      const delta = {
        model,
        source: doc.source,
        resource: FILE,
        principal: { kind: "webid", webId: ALICE },
        add: role === "owner" && model === "wac" ? ["Write", "Control"] : ["Write"],
        remove: [],
        inherited: false,
      };
      expect(diffSharing(value, select(ALICE, role))).toEqual([
        delta,
        ...(role === "owner" && model === "acp"
          ? [{ ...delta, resource: doc.source, add: ["Read", "Write"] }]
          : []),
      ]);
      expect(() => diffSharing(value, select(ALICE, "commenter"))).toThrow("explicit destination");
    });
    it.each(
      [[], ["Read"], ["Append"], ["Read", "Write"], ["Read", "Write", "Append"]].map((modes) => ({
        modes,
      })),
    )("preserves comments permissions $modes on editor and owner promotion", ({ modes }) => {
      const doc = document(model);
      const comment = document(model, false, COMMENTS);
      grant(doc, ALICE, ["Read"]);
      grant(comment, ALICE, modes);
      const snapshot = [...comment.dataset];
      const value = { ...input(doc), comments: context(comment) };
      for (const role of ["editor", "owner"] as const) {
        expect(diffSharing(value, select(ALICE, role))).toEqual(
          diffSharing(input(doc), select(ALICE, role)),
        );
      }
      expect([...comment.dataset]).toEqual(snapshot);
    });
    it("requires explicit destinations and comments context", () => {
      expect(() => diffSharing(input(document(model)), select(ALICE, "commenter"))).toThrow(
        "comments container",
      );
      expect(() =>
        diffSharing({ access: { resource: FILE, documents: [] } }, select(ALICE, "viewer")),
      ).toThrow("explicit destination");
      const doc = document(model, true);
      expect(() => diffSharing(input(doc), select(ALICE, "owner"))).toThrow("explicit destination");
    });
    it("refuses implicit editing of inherited comments grants", () => {
      const doc = document(model);
      const comment = document(model, true);
      grant(comment, ALICE, ["Append"]);
      const value = { ...input(doc), comments: { resource: COMMENTS, documents: [comment] } };
      expect(diffSharing(value, select(ALICE, "commenter"))).toHaveLength(1);
      expect(() => diffSharing(value, select(ALICE, "viewer"))).toThrow("Inherited access");
      grant(doc, ALICE, ["Read"]);
      expect(readSharing(value).people[0]?.inherited).toBe(true);
      expect(() => diffSharing(value, select(ALICE, "viewer"))).toThrow("Inherited access");
    });
    it("rejects duplicate/reserved people", () => {
      const value = input(document(model));
      expect(() =>
        diffSharing(value, {
          ...restricted,
          people: [
            { webId: ALICE, role: "viewer" },
            { webId: ALICE, role: "editor" },
          ],
        }),
      ).toThrow("Duplicate");
      expect(() => diffSharing(value, select("public", "viewer"))).toThrow("reserved");
    });
  });
}

describe("WAC scope and ownership", () => {
  it("recognizes Control only with file Read+Write and pins the owner", () => {
    const doc = document();
    authorization(doc, ALICE, ["Read", "Write", "Control"]);
    expect(readSharing(input(doc)).people[0]?.role).toBe("owner");
    expect(diffSharing(input(doc), readSharing(input(doc)))).toEqual([]);
    expect(() => diffSharing(input(doc), restricted)).toThrow("Owner rows");
  });
  it("handles multi-valued accessTo/default without collapsing shared subjects", () => {
    const doc = document();
    const auth = authorization(doc, ALICE, ["Read"], "https://example.org/unrelated");
    properties(auth).values(`${ACL}accessTo`).add(FILE);
    auth.agent.add(BOB);
    auth.default = "https://example.org/drive/";
    const before = [...doc.dataset];
    expect(readSharing(input(doc)).people).toHaveLength(2);
    expect(diffSharing(input(doc), select(BOB, "viewer"))).toEqual([
      {
        model: "wac",
        source: doc.source,
        resource: FILE,
        principal: { kind: "webid", webId: ALICE },
        add: [],
        remove: ["Read"],
        inherited: false,
      },
    ]);
    expect([...doc.dataset]).toEqual(before);
    doc.inherited = true;
    doc.governingResource = "https://example.org/drive/";
    expect(readSharing(input(doc)).people).toHaveLength(2);
  });
  it.each([
    "origin",
    "agentGroup",
    "agentClass",
  ])("refuses %s that cannot be flattened safely", (predicate) => {
    const doc = document();
    const auth = authorization(doc, ALICE, ["Read"]);
    properties(auth)
      .values(ACL + predicate)
      .add(`${ACL}AuthenticatedAgent`);
    expect(() => readSharing(input(doc))).toThrow(SharingError);
  });
  it("does not discard malformed authorization objects", () => {
    const doc = document();
    const auth = authorization(doc, ALICE, ["Read"]);
    SetFrom.subjectPredicate(auth, `${ACL}agent`, LiteralAs.string, LiteralFrom.string).add(
      "not a WebID",
    );
    expect(() => readSharing(input(doc))).toThrow("Malformed authorization RDF");
  });
});

describe("ACP policies", () => {
  it("recognizes Read+Write on the ACR as policy management and uses separate deltas", () => {
    const doc = document("acp");
    policy(doc, ALICE, ["Read", "Write"]);
    policy(doc, ALICE, ["Read", "Write"], doc.source);
    expect(readSharing(input(doc)).people[0]?.role).toBe("owner");
    expect(() => diffSharing(input(doc), select(ALICE, "editor"))).toThrow("Owner rows");
    const empty = document("acp");
    expect(diffSharing(input(empty), select(ALICE, "owner"))).toEqual([
      {
        model: "acp",
        source: empty.source,
        resource: FILE,
        principal: { kind: "webid", webId: ALICE },
        add: ["Read", "Write"],
        remove: [],
        inherited: false,
      },
      {
        model: "acp",
        source: empty.source,
        resource: empty.source,
        principal: { kind: "webid", webId: ALICE },
        add: ["Read", "Write"],
        remove: [],
        inherited: false,
      },
    ]);
  });
  it.each(
    [[], ["Read"], ["Write"], ["Read", "Write"]].flatMap((accessModes) =>
      [["Read"], ["Write"], ["Append"], ["Read", "Write"]].flatMap((policyModes) =>
        [ALICE, PUBLIC].flatMap((principal) =>
          principal === ALICE && accessModes.length === 2 && policyModes.length === 2
            ? []
            : [{ principal, accessModes, policyModes }],
        ),
      ),
    ),
  )("rejects unrepresentable ACP management: $principal $accessModes / $policyModes", ({
    principal,
    accessModes,
    policyModes,
  }) => {
    const doc = document("acp");
    policy(doc, principal, accessModes);
    policy(doc, principal, policyModes, doc.source);
    expect(() => readSharing(input(doc))).toThrow("ACP management permissions");
    expect(() => diffSharing(input(doc), restricted)).toThrow("ACP management permissions");
  });
  it("validates management-only principals even alongside a representable owner", () => {
    const doc = document("acp");
    policy(doc, ALICE, ["Read", "Write"]);
    policy(doc, ALICE, ["Read", "Write"], doc.source);
    policy(doc, BOB, ["Read", "Write"], doc.source);
    expect(() => readSharing(input(doc))).toThrow("ACP management permissions");
    expect(() => diffSharing(input(doc), select(ALICE, "owner"))).toThrow(
      "ACP management permissions",
    );
  });
  it("combines split ACR permissions into an immutable owner", () => {
    const doc = document("acp");
    policy(doc, ALICE, ["Read", "Write"]);
    policy(doc, ALICE, ["Read"], doc.source);
    policy(doc, ALICE, ["Write", "Append"], doc.source);
    const state = readSharing(input(doc));
    expect(state.people).toEqual([
      { webId: ALICE, role: "owner", inherited: false, explicit: true, sources: [doc.source] },
    ]);
    expect(diffSharing(input(doc), state)).toEqual([]);
    expect(() => diffSharing(input(doc), restricted)).toThrow("Owner rows");
  });
  it("ignores empty ACR permissions", () => {
    const doc = document("acp");
    policy(doc, ALICE, ["Read"]);
    policy(doc, ALICE, [], doc.source);
    policy(doc, BOB, [], doc.source);
    policy(doc, PUBLIC, [], doc.source);
    expect(readSharing(input(doc)).people).toEqual([
      { webId: ALICE, role: "viewer", inherited: false, explicit: true, sources: [doc.source] },
    ]);
    expect(diffSharing(input(doc), restricted)).toEqual([
      {
        model: "acp",
        source: doc.source,
        resource: FILE,
        principal: { kind: "webid", webId: ALICE },
        add: [],
        remove: ["Read"],
        inherited: false,
      },
    ]);
  });
  it("combines own and ancestor member grants and records both origins", () => {
    const own = document("acp");
    const parent = document("acp", true);
    policy(own, ALICE, ["Read"]);
    policy(parent, ALICE, ["Write"]);
    const value = { access: { resource: FILE, documents: [own, parent] } };
    expect(readSharing(value).people[0]).toEqual({
      webId: ALICE,
      role: "editor",
      explicit: true,
      inherited: true,
      sources: [parent.source, own.source].sort(),
    });
    expect(() => diffSharing(value, restricted)).toThrow("Inherited access");
  });
  it.each([
    ALICE,
    PUBLIC,
  ])("allows explicit access alongside an empty inherited grant for %s", (principal) => {
    const own = document("acp");
    const parent = document("acp", true);
    policy(parent, principal, []);
    const value = { access: { resource: FILE, documents: [own, parent] } };
    expect(readSharing(value)).toEqual({
      ...restricted,
      general: { inherited: false, explicit: false, sources: [] },
    });
    expect(
      diffSharing(
        value,
        principal === PUBLIC ? { ...restricted, link: "viewer" } : select(principal, "viewer"),
      ),
    ).toEqual([
      {
        model: "acp",
        source: own.source,
        resource: FILE,
        principal: principal === PUBLIC ? { kind: "public" } : { kind: "webid", webId: principal },
        add: ["Read"],
        remove: [],
        inherited: false,
      },
    ]);
    policy(own, principal, ["Read"]);
    const state = readSharing(value);
    expect(principal === PUBLIC ? state.general : state.people[0]).toMatchObject({
      inherited: false,
      explicit: true,
      sources: [own.source],
    });
    expect(diffSharing(value, restricted)).toEqual([
      {
        model: "acp",
        source: own.source,
        resource: FILE,
        principal: principal === PUBLIC ? { kind: "public" } : { kind: "webid", webId: principal },
        add: [],
        remove: ["Read"],
        inherited: false,
      },
    ]);
  });
  it("intersects allOf agent sets instead of widening them", () => {
    const doc = document("acp");
    const p = policy(doc, ALICE, ["Read"]);
    p.allOf.add(matcher(doc, [BOB]));
    expect(readSharing(input(doc)).people).toEqual([]);
  });
  it("unions anyOf while respecting allOf and public wildcards", () => {
    const doc = document("acp");
    const p = policy(doc, PUBLIC, ["Read"]);
    p.anyOf.add(matcher(doc, [BOB]));
    p.anyOf.add(matcher(doc, [ALICE]));
    p.allOf.add(matcher(doc, [ALICE, BOB, CAROL]));
    p.allOf.add(matcher(doc, [PUBLIC]));
    expect(readSharing(input(doc)).people.map((person) => person.webId)).toEqual([ALICE, BOB]);
    p.anyOf.clear();
    p.allOf.clear();
    p.anyOf.add(matcher(doc, [CAROL]));
    expect(readSharing(input(doc)).people[0]?.webId).toBe(CAROL);
    p.anyOf.clear();
    expect(readSharing(input(doc)).people).toEqual([]);
  });
  it("does not satisfy empty matchers, and accepts RDF type metadata", () => {
    const doc = document("acp");
    const p = policy(doc, ALICE, ["Read"]);
    p.allOf.clear();
    p.allOf.add(matcher(doc, []));
    expect(readSharing(input(doc)).people).toEqual([]);
    const m = matcher(doc, [ALICE]);
    m.type.add(`${ACP}Matcher`);
    p.allOf.clear();
    p.allOf.add(m);
    expect(readSharing(input(doc)).people[0]?.webId).toBe(ALICE);
  });
  it.each([
    "deny",
    "noneOf",
    "client",
    "issuer",
    "vc",
    "extension",
    "special",
  ])("refuses unsupported %s constraints", (condition) => {
    const doc = document("acp");
    const p = policy(doc, ALICE, ["Read"]);
    if (condition === "deny") p.deny.add(`${ACL}Write`);
    else if (condition === "noneOf") p.noneOf.add(matcher(doc, [BOB]));
    else {
      p.allOf.clear();
      const m = matcher(doc, condition === "special" ? [`${ACP}AuthenticatedAgent`] : [ALICE]);
      if (condition !== "special")
        properties(m)
          .values(ACP + condition)
          .add("https://example.org/condition");
      p.allOf.add(m);
    }
    expect(() => readSharing(input(doc))).toThrow(SharingError);
  });
});

describe("resolved input validation", () => {
  it("refuses invalid governing-resource boundaries", () => {
    for (const resource of [
      "https://example.org/drive/",
      "https://example.org/drive-evil/file",
      "https://other.example.org/drive/file",
    ]) {
      expect(() =>
        readSharing({ access: { resource, documents: [document("wac", true)] } }),
      ).toThrow("Invalid governing resource");
    }
    const doc = document("acp", true);
    doc.governingResource = "https://example.org/drive";
    expect(() => readSharing(input(doc))).toThrow("Invalid governing resource");
    expect(() => readSharing({ access: { resource: COMMENTS, documents: [document()] } })).toThrow(
      "Invalid governing resource",
    );
  });
  it("refuses multiple explicit documents or additive WAC inheritance", () => {
    for (const documents of [
      [document(), document()],
      [document("acp"), document("acp")],
      [document(), document("wac", true)],
    ]) {
      expect(() => readSharing({ access: { resource: FILE, documents } })).toThrow(
        "resolved effective",
      );
    }
  });
  it("refuses named-graph datasets", () => {
    const doc = document();
    const view = new NamedGraphDataset(
      DataFactory.namedNode("https://example.org/graph"),
      doc.dataset,
      DataFactory,
    );
    const subject = new Properties("https://example.org/test", view, DataFactory);
    subject.values(`${ACL}agent`).add(ALICE);
    expect(() => readSharing(input(doc))).toThrow("default graph");
  });
});

it("does not mistake a vocabulary IRI used as an agent for a public grant", () => {
  const doc = document();
  const auth = authorization(doc, ALICE, ["Read"]);
  auth.agent.clear();
  auth.agent.add(PUBLIC);
  expect(readSharing(input(doc))).toMatchObject({
    people: [{ webId: PUBLIC, role: "viewer" }],
    link: "none",
    public: "none",
  });
  const acr = document("acp");
  const p = policy(acr, ALICE, ["Read"]);
  p.allOf.clear();
  const m = matcher(acr, []);
  m.agent.add(PUBLIC);
  p.allOf.add(m);
  expect(readSharing(input(acr))).toMatchObject({
    people: [{ webId: PUBLIC, role: "viewer" }],
    link: "none",
    public: "none",
  });
});

for (const model of ["wac", "acp"] as const) {
  it(`${model}: changes only Append in the comments container`, () => {
    const grant = model === "wac" ? authorization : policy;
    const doc = document(model);
    const comment = document(model, false, COMMENTS);
    grant(doc, ALICE, ["Read"]);
    grant(comment, ALICE, ["Read", "Append"]);
    const value = { ...input(doc), comments: context(comment) };
    expect(diffSharing(value, select(ALICE, "viewer"))).toEqual([
      {
        model,
        source: comment.source,
        resource: COMMENTS,
        principal: { kind: "webid", webId: ALICE },
        add: [],
        remove: ["Append"],
        inherited: false,
      },
    ]);
    grant(comment, ALICE, ["Write"]);
    expect(readSharing(value).people[0]?.role).toBe("commenter");
    expect(() => diffSharing(value, restricted)).toThrow("also comes from Write");
    const empty = document(model);
    const expected = [
      {
        model,
        source: empty.source,
        resource: FILE,
        principal: { kind: "webid" as const, webId: ALICE },
        add: ["Read"],
        remove: [],
        inherited: false,
      },
    ];
    expect(
      diffSharing({ ...input(empty), comments: context(comment) }, select(ALICE, "commenter")),
    ).toEqual(expected);
    const writeOnly = document(model, false, COMMENTS);
    grant(writeOnly, ALICE, ["Write"]);
    expect(
      diffSharing({ ...input(empty), comments: context(writeOnly) }, select(ALICE, "commenter")),
    ).toEqual(expected);
  });
}

it("honors all ACP resource targets, including a shared data and policy scope", () => {
  const doc = document("acp");
  policy(doc, ALICE, ["Read", "Write"], "https://example.org/unrelated");
  const acr = [...new FixtureAcrs(doc.dataset, DataFactory).resources][0];
  if (!acr) throw new Error("fixture");
  properties(acr).values(`${ACP}resource`).add(FILE);
  properties(acr).values(`${ACP}resource`).add(doc.source);
  expect(readSharing(input(doc)).people[0]?.role).toBe("owner");
});
