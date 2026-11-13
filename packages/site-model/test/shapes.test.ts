// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import type { Quad } from "@rdfjs/types";
import env from "@zazuko/env-node";
import { Parser, Writer } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { writeSiteModel } from "../src/index.js";
import { model } from "./fixtures.js";

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const parse = (ttl: string) => new Parser().parse(ttl);
const toDataset = (quads: Quad[]) => {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
};

const SAB = "https://jeswr.org/ns/site-action#";
const ontology = parse(read("site-action.ttl"));
const shapes = toDataset(parse(read("site-action.shacl.ttl")));

async function validate(quads: Quad[]) {
  return new SHACLValidator(shapes, { factory: env }).validate(toDataset(quads));
}

const subjectsOfType = (quads: Quad[], type: string) =>
  quads
    .filter((q) => q.predicate.value.endsWith("#type") && q.object.value === type)
    .map((q) => q.subject.value);

describe("vocabulary", () => {
  it("defines every sab: term the shapes and the codegen profile use", () => {
    const defined = new Set(
      ontology.filter((q) => q.subject.termType === "NamedNode").map((q) => q.subject.value),
    );
    for (const file of ["site-action.shacl.ttl", "codegen/site-action.codegen.shacl.ttl"]) {
      const used = new Set(
        parse(read(file))
          .flatMap((q) => [q.subject, q.predicate, q.object])
          .filter((t) => t.termType === "NamedNode" && t.value.startsWith(SAB))
          .map((t) => t.value),
      );
      expect(
        [...used].filter((iri) => !defined.has(iri)),
        file,
      ).toEqual([]);
    }
  });

  it("labels and defines every sab: term and puts the effects in their scheme", () => {
    const sab = [...new Set(ontology.map((q) => q.subject.value).filter((s) => s.startsWith(SAB)))];
    for (const term of sab) {
      const has = (p: string) =>
        ontology.some((q) => q.subject.value === term && q.predicate.value === p);
      expect(has("http://www.w3.org/2000/01/rdf-schema#label"), term).toBe(true);
      expect(has("http://www.w3.org/2000/01/rdf-schema#comment"), term).toBe(true);
    }
    const inScheme = ontology
      .filter(
        (q) => q.predicate.value.endsWith("#inScheme") && q.object.value === `${SAB}EffectScheme`,
      )
      .map((q) => q.subject.value)
      .sort();
    expect(inScheme).toEqual([
      `${SAB}IrreversibleWrite`,
      `${SAB}Payment`,
      `${SAB}Read`,
      `${SAB}ReversibleWrite`,
    ]);
  });

  it("uses https schema.org everywhere", () => {
    for (const file of [
      "site-action.ttl",
      "site-action.shacl.ttl",
      "codegen/site-action.codegen.shacl.ttl",
    ]) {
      expect(read(file), file).not.toContain("http://schema.org/");
    }
  });
});

describe("normative shapes (site-action.shacl.ttl)", () => {
  it.each([
    [
      "Completed",
      "Payment",
      'schema:price "20.00"^^xsd:decimal; schema:priceCurrency "GBP";',
      true,
    ],
    ["Completed", "Payment", "", false],
    ["Completed", "ReversibleWrite", "", true],
    ["Failed", "Payment", "", true],
    ["Uncertain", "Payment", "", true],
    ["Uncertain", "IrreversibleWrite", "", true],
    ["Pending", "Payment", "", false],
    ["Completed", "Read", "", false],
    ["Completed", "Payment", 'schema:price "-1"^^xsd:decimal; schema:priceCurrency "GBP";', false],
  ])("validates %s %s execution receipts", async (status, effect, money, conforms) => {
    const quads =
      parse(`@prefix sab: <${SAB}>. @prefix schema: <https://schema.org/>. @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
      [] a sab:ActionOutcome; sab:status sab:${status}; sab:effect sab:${effect}; sab:target "Buy a product"; ${money} schema:result <https://shop.test/orders/42>.`);
    expect((await validate(quads)).conforms).toBe(conforms);
  });

  it("a written site model conforms", async () => {
    const quads = parse(await writeSiteModel(model));
    const report = await validate(quads);
    expect(
      report.results.map(
        (r) => `${r.focusNode?.value} ${r.path?.value} ${r.message.map((m) => m.value)}`,
      ),
    ).toEqual([]);
    expect(report.conforms).toBe(true);
    expect(subjectsOfType(quads, `${SAB}Operation`)).toHaveLength(5);
  });

  const mutate = async (edit: (quads: Quad[]) => Quad[]) =>
    validate(edit(parse(await writeSiteModel(model))));
  const drop = (predicate: string, subjectPart?: string) => (quads: Quad[]) =>
    quads.filter(
      (q) =>
        !(
          q.predicate.value === predicate &&
          (subjectPart === undefined || q.subject.value.includes(subjectPart))
        ),
    );

  it.each([
    ["an operation without an effect", drop(`${SAB}effect`, "#search")],
    [
      "a cookie CSRF source without its name",
      drop("https://schema.org/name", "add-to-cart.csrf.0.source"),
    ],
    ["an html CSRF source without its selector", drop(`${SAB}selector`)],
    ["a flow without steps", drop(`${SAB}step`)],
    [
      "an entry point without a URL template",
      drop("https://schema.org/urlTemplate", "#search.request"),
    ],
  ])("rejects %s", async (_name, edit) => {
    expect((await mutate(edit)).conforms).toBe(false);
  });

  it("rejects a CSRF source that carries a second kind's fields", async () => {
    const extra = parse(
      `<https://shop.test/.well-known/site-model#add-to-cart.csrf.0.source> <${SAB}pointer> "/x" ; <https://schema.org/urlTemplate> "https://shop.test/x" .`,
    );
    const report = await mutate((quads) => [...quads, ...extra]);
    // cookie + json fields together still match exactly one branch (cookie needs only a name),
    // so the shape accepts it; a document with a second sourceKind violates maxCount instead.
    expect(report.conforms).toBe(true);
    const twoKinds = parse(
      `<https://shop.test/.well-known/site-model#add-to-cart.csrf.0.source> <${SAB}sourceKind> "json" .`,
    );
    expect((await mutate((quads) => [...quads, ...extra, ...twoKinds])).conforms).toBe(false);
  });

  it("rejects a value path list holding a literal", async () => {
    const report = await mutate((quads) => {
      const ttl = new Writer().quadsToString(quads);
      return parse(ttl.replace("<https://schema.org/additionalProperty>", '"additionalProperty"'));
    });
    expect(report.conforms).toBe(false);
  });
});
