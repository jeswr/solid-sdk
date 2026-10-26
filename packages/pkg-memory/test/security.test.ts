// AUTHORED-BY Codex GPT-6.1-Sol
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee the referenced entries. */

import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory as df, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type Batch,
  buildNanopublications,
  canonicalizeAssertion,
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

it.each([
  "en_US",
  "1en",
  "-en",
  "en-",
  "en-1-",
  "en\n",
  "en\r",
  "en\t",
  "fr-é",
  "en . <https://example.org/evil> <https://schema.org/name> <https://example.org/object> #",
])("rejects malformed raw assertion language tag %j before hashing or writing", async (language) => {
  const b = batch();
  const assertion = new Store([
    df.quad(df.blankNode("label"), df.namedNode(`${NS.schema}name`), df.literal("Text", language)),
  ]);
  b.claims[0]!.assertion = assertion;
  expect(() => canonicalizeAssertion(assertion)).toThrow("Invalid language tag");
  await expect(buildNanopublications(b, options)).rejects.toThrow("Invalid language tag");
});

it.each([
  "en",
  "EN-US",
  "es-419",
  "zh-Hant-TW",
  "x-private",
  "",
])("round-trips valid raw assertion language tag %j without changing its graph", async (language) => {
  const b = batch();
  const literal = df.literal("Synthetic label", language || undefined);
  b.claims[0]!.assertion = new Store([
    df.quad(df.namedNode(owner), df.namedNode(`${NS.schema}name`), literal),
  ]);
  const built = await buildNanopublications(b, options);
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  const assertion = parsed.dataset.getQuads(
    null,
    null,
    null,
    df.namedNode(built.nanopubs[0]!.assertionId),
  );
  expect(assertion).toHaveLength(1);
  expect(assertion[0]!.object.equals(literal)).toBe(true);
});

it("rejects rdf:langString literals without a language tag", async () => {
  const assertion = new Store([
    df.quad(
      df.namedNode(owner),
      df.namedNode(`${NS.schema}name`),
      df.literal("Synthetic label", df.namedNode(`${NS.rdf}langString`)),
    ),
  ]);
  const input = batch();
  input.claims[0]!.assertion = assertion;
  expect(() => canonicalizeAssertion(assertion)).toThrow("Invalid language tag");
  await expect(buildNanopublications(input, options)).rejects.toThrow("Invalid language tag");
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
    "2026-01-01T12:00:00",
  ])("rejects invalid publication time %j", async (generatedAt) => {
    await expect(buildNanopublications(batch(), { ...options, generatedAt })).rejects.toThrow(
      "dateTime",
    );
  });
});

it("requires timezones on evidence, worker and source timestamps", async () => {
  const value = "2026-01-01T12:00:00";
  for (const field of ["started", "finished"] as const) {
    const input = batch();
    input.worker[field] = value;
    await expect(buildNanopublications(input, options)).rejects.toThrow("dateTime");
  }
  for (const message of [false, true]) {
    const input = batch();
    input.claims[0]!.evidence = [
      {
        source: "doc",
        timestamp: value,
        ...(message ? { message_id: "fictional-message" } : {}),
      },
    ];
    await expect(buildNanopublications(input, options)).rejects.toThrow("dateTime");
  }
  const input = batch();
  input.sources = [
    {
      id: "doc",
      kind: "codex-thread",
      thread_id: "12345678-1234-4234-8234-123456789abc",
      created: value,
    },
  ];
  await expect(buildNanopublications(input, options)).rejects.toThrow("dateTime");
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
    (ds: Store, id: string) => {
      const head = ds.getQuads(null, null, null, df.namedNode(id));
      ds.removeQuads(head);
      for (const q of head)
        ds.addQuad(q.subject, q.predicate, q.object, df.namedNode("https://example.org/other"));
    },
  ],
  [
    "blank head",
    (ds: Store, id: string) => {
      const blank = df.blankNode();
      const head = ds.getQuads(null, null, null, df.namedNode(id));
      ds.removeQuads(head);
      for (const q of head) ds.addQuad(blank, q.predicate, q.object, blank);
    },
  ],
  [
    "missing head type",
    (ds: Store, id: string) =>
      ds.removeQuads(
        ds.getQuads(df.namedNode(id), df.namedNode(`${NS.rdf}type`), null, df.namedNode(id)),
      ),
  ],
  ...["hasAssertion", "hasProvenance", "hasPublicationInfo"].map(
    (predicate) =>
      [
        `missing ${predicate}`,
        (ds: Store, id: string) =>
          ds.removeQuads(
            ds.getQuads(
              df.namedNode(id),
              df.namedNode(`${NS.np}${predicate}`),
              null,
              df.namedNode(id),
            ),
          ),
      ] as const,
  ),
  [
    "wrong head type",
    (ds: Store, id: string) => replace(ds, id, `${NS.rdf}type`, `${NS.schema}Person`, id),
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

it("ignores type-only declarations in assertion and other graphs during parsing", async () => {
  const built = await buildNanopublications(batch(), options);
  const n = built.nanopubs[0]!;
  const type = df.namedNode(`${NS.rdf}type`);
  const nanopublication = df.namedNode(`${NS.np}Nanopublication`);
  // Even a self-named typed graph is data without the nanopub graph links.
  for (const name of [n.assertionId, "https://example.org/entities"]) {
    for (const subject of [df.namedNode(name), df.namedNode(n.id), df.blankNode()])
      built.dataset.addQuad(subject, type, nanopublication, df.namedNode(name));
  }
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  expect(parsed.nanopubs).toEqual(built.nanopubs);
  expect(parsed.dataset.size).toBe(built.dataset.size);
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

it.each([
  ["TextQuoteSelector", "exact", "quote"],
  ["FragmentSelector", "value", "locator"],
] as const)("rejects multiple %s values regardless of triple order", async (type, predicate, field) => {
  for (const values of [
    ["first", "second"],
    ["second", "first"],
    ["same", "same"],
    ["", "second"],
  ]) {
    const built = await buildNanopublications(batch(), options);
    const n = built.nanopubs[0]!;
    const provenance = df.namedNode(n.provenanceId);
    const target = built.dataset.getQuads(
      null,
      df.namedNode(`${NS.oa}hasTarget`),
      null,
      provenance,
    )[0]!.object;
    built.dataset.removeQuads(
      built.dataset.getQuads(target, df.namedNode(`${NS.oa}hasSelector`), null, provenance),
    );
    for (const value of values) {
      const selector = df.blankNode();
      built.dataset.addQuad(
        target as never,
        df.namedNode(`${NS.oa}hasSelector`),
        selector,
        provenance,
      );
      built.dataset.addQuad(
        selector,
        df.namedNode(`${NS.rdf}type`),
        df.namedNode(`${NS.oa}${type}`),
        provenance,
      );
      built.dataset.addQuad(
        selector,
        df.namedNode(`${predicate === "value" ? NS.rdf : NS.oa}${predicate}`),
        df.literal(value),
        provenance,
      );
    }
    await expect(parseNanopublications(await serializeNanopublications(built))).rejects.toThrow(
      `Multiple evidence ${field} selectors`,
    );
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
    df.literal("2026-01-01T12:00:00", df.namedNode(`${NS.xsd}dateTime`)),
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
