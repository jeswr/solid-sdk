// AUTHORED-BY Codex GPT-6.1-Sol
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee the referenced entries. */

import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory as df, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type Batch,
  buildNanopublications,
  createFactAssertion,
  type Fact,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "../src/index.js";
import { NS } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const owner = options.owner;
function batch(): Batch {
  return {
    batch_id: "security",
    worker: { agent_id: "https://example.org/agents/test", agent_label: "Synthetic extractor" },
    sources: [{ id: "doc", kind: "document", url: "https://example.org/document" }],
    claims: [
      {
        id: "one",
        epistemic: "Mentioned",
        assertion: createFactAssertion(owner, { template: "email", value: "avery@example.org" }),
        evidence: [{ source: "doc", quote: "Synthetic quote." }],
      },
    ],
  };
}

it.each([
  '" . <https://example.org/evil> <https://schema.org/name> "injected',
  'quote " slash \\ newline\n\r\t emoji 🫖',
  '"""\n<https://example.org/evil>',
])("keeps literal payload %j in its RDF literal", async (payload) => {
  const b = batch();
  b.claims[0]!.assertion = createFactAssertion(owner, {
    template: "preference",
    value: { propertyID: payload, value: payload },
  });
  b.claims[0]!.evidence![0]!.quote = payload;
  b.claims[0]!.note = payload;
  b.worker.agent_label = payload;
  const built = await buildNanopublications(b, options);
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  expect(parsed.nanopubs[0]!.evidence[0]!.quote).toBe(payload);
  expect(
    [...parsed.dataset].filter(
      (q) => q.object.termType === "Literal" && q.object.value === payload,
    ),
  ).toHaveLength(5);
  expect([...parsed.dataset].some((q) => q.subject.value === "https://example.org/evil")).toBe(
    false,
  );
});

it("escapes IRIREF delimiters at all builder IRI boundaries without adding statements", async () => {
  const payload =
    'https://example.org/iri> . <https://example.org/evil> <https://schema.org/name> "injected" #';
  const b = batch();
  b.worker.agent_id = payload;
  b.sources![0]!.url = payload;
  b.claims[0]!.attributed_to = payload;
  b.claims[0]!.categories = [payload];
  b.claims[0]!.assertion = createFactAssertion(payload, {
    template: "relationship",
    value: { id: payload, person: payload, roleName: "friend" },
  });
  const result = await parseNanopublications(
    await serializeNanopublications(await buildNanopublications(b, { ...options, owner: payload })),
  );
  const named = [...result.dataset]
    .flatMap((q) => [q.subject, q.predicate, q.object])
    .filter((t) => t.termType === "NamedNode");
  expect(named.some((t) => t.value.includes("%3E"))).toBe(true);
  expect(named.some((t) => t.value === "https://example.org/evil")).toBe(false);
});

it.each([
  "javascript:alert(1)",
  "data:text/plain,test",
  "/relative",
  " https://example.org/",
  "https://example.org/\n",
])("rejects unsafe IRI %j", async (value) => {
  expect(() =>
    createFactAssertion(value, { template: "email", value: "avery@example.org" }),
  ).toThrow();
  const b = batch();
  b.worker.agent_id = value;
  await expect(buildNanopublications(b, options)).rejects.toThrow();
  await expect(buildNanopublications(batch(), { ...options, owner: value })).rejects.toThrow();
  await expect(parseAssertion("", value)).rejects.toThrow();
});

it.each([
  "bad@@example.org",
  "avery@example.org> . <https://example.org/evil>",
  "tel:javascript:alert(1)",
])("rejects contact injection %j", (value) => {
  expect(() => createFactAssertion(owner, { template: "email", value })).toThrow();
  expect(() => createFactAssertion(owner, { template: "phone", value })).toThrow();
});

it("rejects invalid templates, dates and numeric doses", () => {
  expect(() => createFactAssertion(owner, { template: "unknown" } as unknown as Fact)).toThrow(
    "Unknown fact template",
  );
  for (const bound of [
    { value: "2026-01", datatype: "invalid" },
    { value: "not-a-date", datatype: "date" },
    { value: "nonsense", datatype: "dateTime" },
  ]) {
    expect(() =>
      createFactAssertion(owner, {
        template: "address",
        value: {
          id: "https://example.org/a",
          locality: "Storyville",
          country: "Exampleland",
          validFrom: bound,
        },
      } as Fact),
    ).toThrow();
  }
  expect(() =>
    createFactAssertion(owner, {
      template: "medication",
      value: {
        id: "https://example.org/s",
        medication: { id: "https://example.org/m", name: "Fictionalium" },
        dose: { value: '2"; injected', unit: "mg" },
      },
    }),
  ).toThrow();
});

describe("malformed batch rejection", () => {
  const cases: [string, (b: Batch) => void][] = [
    [
      "epistemic",
      (b) => {
        b.claims[0]!.epistemic = "Unknown" as never;
      },
    ],
    [
      "validity",
      (b) => {
        b.claims[0]!.validity = "Unknown" as never;
      },
    ],
    [
      "duplicate claims",
      (b) => {
        b.claims.push(b.claims[0]!);
      },
    ],
    [
      "duplicate sources",
      (b) => {
        b.sources!.push(b.sources![0]!);
      },
    ],
    [
      "unknown source",
      (b) => {
        b.claims[0]!.evidence![0]!.source = "missing";
      },
    ],
    [
      "long quote",
      (b) => {
        b.claims[0]!.evidence![0]!.quote = "🫖".repeat(301);
      },
    ],
    [
      "supersession",
      (b) => {
        b.claims[0]!.supersedes = ["unknown"];
      },
    ],
    [
      "contradiction",
      (b) => {
        b.claims[0]!.contradicts = ["unknown"];
      },
    ],
    [
      "inference input",
      (b) => {
        b.claims[0]!.epistemic = "Inferred";
        b.claims[0]!.inference = { rule: "pkg-rule:test", inputs: ["unknown"] };
      },
    ],
    [
      "inference status",
      (b) => {
        b.claims[0]!.inference = { rule: "pkg-rule:test" };
      },
    ],
    [
      "unknown source kind",
      (b) => {
        b.sources![0]!.kind = "unknown" as never;
      },
    ],
    [
      "missing source URL",
      (b) => {
        delete b.sources![0]!.url;
      },
    ],
    [
      "invalid source path",
      (b) => {
        delete b.sources![0]!.url;
        b.sources![0]!.path = "relative";
      },
    ],
    [
      "invalid thread UUID",
      (b) => {
        b.sources![0]!.kind = "codex-thread";
        b.sources![0]!.thread_id = "invalid";
      },
    ],
    [
      "missing thread UUID",
      (b) => {
        b.sources![0]!.kind = "claude-session";
      },
    ],
    [
      "empty assertion",
      (b) => {
        b.claims[0]!.assertion = "";
      },
    ],
    [
      "RDF syntax",
      (b) => {
        b.claims[0]!.assertion = "This is not RDF";
      },
    ],
  ];
  it.each(cases)("rejects %s", async (_, mutate) => {
    const b = batch();
    mutate(b);
    await expect(buildNanopublications(b, options)).rejects.toThrow();
  });
  it.each([
    "not-a-time",
    "2026-99-99T00:00:00Z",
  ])("rejects invalid publication time %j", async (generatedAt) => {
    await expect(buildNanopublications(batch(), { ...options, generatedAt })).rejects.toThrow(
      "dateTime",
    );
  });
});

async function altered(
  mutate: (dataset: Store, id: string, assertion: string) => void,
): Promise<string> {
  const result = await buildNanopublications(batch(), options);
  const n = result.nanopubs[0]!;
  mutate(result.dataset, n.id, n.assertionId);
  return serialize([...result.dataset], { format: "application/trig" });
}
const replace = (store: Store, s: string, p: string, o: string, g: string) => {
  store.removeQuads(store.getQuads(df.namedNode(s), df.namedNode(p), null, df.namedNode(g)));
  store.addQuad(df.namedNode(s), df.namedNode(p), df.namedNode(o), df.namedNode(g));
};

it.each([
  [
    "absent graph",
    (ds: Store, _id: string, a: string) =>
      ds.removeQuads(ds.getQuads(null, null, null, df.namedNode(a))),
  ],
  [
    "overlapping graphs",
    (ds: Store, id: string) => replace(ds, id, `${NS.np}hasAssertion`, id, id),
  ],
  [
    "cross-graph head",
    (ds: Store, id: string) =>
      ds.addQuad(
        df.namedNode(id),
        df.namedNode(`${NS.rdf}type`),
        df.namedNode(`${NS.np}Nanopublication`),
        df.namedNode("https://example.org/evil"),
      ),
  ],
  [
    "blank head",
    (ds: Store) =>
      ds.addQuad(
        df.blankNode(),
        df.namedNode(`${NS.rdf}type`),
        df.namedNode(`${NS.np}Nanopublication`),
      ),
  ],
  [
    "duplicate graph link",
    (ds: Store, id: string) =>
      ds.addQuad(
        df.namedNode(id),
        df.namedNode(`${NS.np}hasAssertion`),
        df.namedNode("https://example.org/evil"),
        df.namedNode(id),
      ),
  ],
  [
    "literal graph link",
    (ds: Store, id: string) => {
      ds.removeQuads(
        ds.getQuads(df.namedNode(id), df.namedNode(`${NS.np}hasAssertion`), null, df.namedNode(id)),
      );
      ds.addQuad(
        df.namedNode(id),
        df.namedNode(`${NS.np}hasAssertion`),
        df.literal("not an IRI"),
        df.namedNode(id),
      );
    },
  ],
  [
    "foreign graph link scheme",
    (ds: Store, id: string) => replace(ds, id, `${NS.np}hasAssertion`, "javascript:alert(1)", id),
  ],
  [
    "unknown status",
    (ds: Store, id: string, a: string) =>
      replace(ds, a, `${NS.pkg}epistemicStatus`, `${NS.pkg}Unknown`, `${id}#provenance`),
  ],
  [
    "literal category",
    (ds: Store, id: string, a: string) =>
      ds.addQuad(
        df.namedNode(a),
        df.namedNode(`${NS.dpv}hasPersonalData`),
        df.literal("bad"),
        df.namedNode(`${id}#provenance`),
      ),
  ],
  [
    "literal hedge",
    (ds: Store, id: string, a: string) =>
      ds.addQuad(
        df.namedNode(a),
        df.namedNode(`${NS.pkg}hedgeMarker`),
        df.namedNode("https://example.org/invalid"),
        df.namedNode(`${id}#provenance`),
      ),
  ],
] as const)("rejects malformed nanopub: %s", async (_, mutate) => {
  await expect(parseNanopublications(await altered(mutate))).rejects.toThrow();
});

it("rejects no nanopubs and invalid annotation targets", async () => {
  await expect(
    parseNanopublications(
      "<https://example.org/a> <https://example.org/b> <https://example.org/c> .",
    ),
  ).rejects.toThrow("No nanopublications");
  for (const field of [`${NS.rdf}type`, `${NS.oa}hasBody`]) {
    const trig = await altered((ds, id) => {
      const annotation = [...ds].find((q) => q.predicate.value === `${NS.oa}hasBody`)!.subject
        .value;
      replace(ds, annotation, field, "https://example.org/wrong", `${id}#provenance`);
    });
    await expect(parseNanopublications(trig)).rejects.toThrow("Invalid evidence");
  }
});

it("does not borrow mandatory metadata from another graph", async () => {
  const trig = await altered((ds, id, a) => {
    const status = ds.getQuads(
      df.namedNode(a),
      df.namedNode(`${NS.pkg}epistemicStatus`),
      null,
      df.namedNode(`${id}#provenance`),
    )[0]!;
    ds.removeQuad(status);
    ds.addQuad(
      status.subject,
      status.predicate,
      status.object,
      df.namedNode("https://example.org/evil"),
    );
  });
  await expect(parseNanopublications(trig)).rejects.toThrow("exactly one");
});

it("rejects non-dateTime publication timestamps and datatype IRI injection", async () => {
  for (const term of [
    df.namedNode("https://example.org/time"),
    df.literal("not a time"),
    df.literal("invalid", df.namedNode(`${NS.xsd}dateTime`)),
  ]) {
    const trig = await altered((ds, id) => {
      ds.removeQuads(
        ds.getQuads(
          df.namedNode(id),
          df.namedNode(`${NS.prov}generatedAtTime`),
          null,
          df.namedNode(`${id}#pubinfo`),
        ),
      );
      ds.addQuad(
        df.namedNode(id),
        df.namedNode(`${NS.prov}generatedAtTime`),
        term,
        df.namedNode(`${id}#pubinfo`),
      );
    });
    await expect(parseNanopublications(trig)).rejects.toThrow();
  }
  const b = batch();
  b.claims[0]!.assertion = new Store([
    df.quad(
      df.namedNode(owner),
      df.namedNode(`${NS.schema}name`),
      df.literal("text", df.namedNode("https://example.org/type> . <https://example.org/evil>")),
    ),
  ]);
  await expect(buildNanopublications(b, options)).rejects.toThrow("Unsafe");
});
