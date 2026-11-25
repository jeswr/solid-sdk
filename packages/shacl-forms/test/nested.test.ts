// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import { build, compileForm, formToShapes, parse, validate } from "../src/index.js";
import { EX, graph, SHAPE, SUBJECT } from "./helpers.js";

const nested = (link = "sh:maxCount 1", child = "") =>
  compileForm(
    graph(`
 ex:Form a sh:NodeShape; sh:targetClass ex:Response;
 sh:property [sh:path ex:child; sh:node ex:Child; ${link}], [sh:path ex:ok; sh:datatype xsd:string; sh:maxCount 1].
 ex:Child a sh:NodeShape; sh:targetClass ex:ChildType;
 sh:property [sh:path ex:name; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1],
 [sh:path ex:optional; sh:datatype xsd:integer; sh:maxCount 1 ${child}].`),
    SHAPE,
  );
describe("nested forms", () => {
  it("round trips nested objects, arrays and descriptors", () => {
    const model = nested();
    const values = { child: { name: "Alice", optional: 3 }, ok: "yes" };
    expect(parse(model, SUBJECT, build(model, SUBJECT, values))).toEqual(values);
    expect(compileForm(formToShapes(model), SHAPE)).toEqual(model);
    const list = nested("sh:minCount 1");
    const many = { child: [{ name: "Alice" }, { name: "Bob" }] };
    expect(parse(list, SUBJECT, build(list, SUBJECT, many))).toEqual(many);
  });
  it("reports nested issue keys and blocks incomplete writes", () => {
    const model = nested("sh:maxCount 1; sh:minCount 1");
    expect(validate(model, { child: {} }).issues).toContainEqual(
      expect.objectContaining({ key: "child.name", path: `${EX}name`, severity: "violation" }),
    );
    expect(() => build(model, SUBJECT, { child: {} })).toThrow(/child.name/);
    expect(() => build(model, SUBJECT, {})).toThrow();
    expect(
      parse(
        model,
        SUBJECT,
        graph(`<${SUBJECT}> ex:child ex:elsewhere; ex:ok "yes". ex:elsewhere ex:optional 3.`),
      ),
    ).toEqual({ ok: "yes" });
  });
  it("follows actual linked subjects and does not require the child targetClass", () => {
    const model = nested();
    expect(
      parse(
        model,
        SUBJECT,
        graph(`<${SUBJECT}> ex:child ex:elsewhere. ex:elsewhere ex:name "Alice".`),
      ),
    ).toEqual({ child: { name: "Alice" } });
  });
  it.each([
    '"literal"',
    "_:child",
    "<javascript:alert(1)>",
    "<data:text/plain,x>",
  ])("drops unsafe nested link %s", (link) =>
    expect(parse(nested(), SUBJECT, graph(`<${SUBJECT}> ex:child ${link}; ex:ok "yes".`))).toEqual({
      ok: "yes",
    }));
  it("drops ambiguous singleton links and invalid present optional child values", () => {
    expect(
      parse(
        nested(),
        SUBJECT,
        graph(`<${SUBJECT}> ex:child ex:a,ex:b. ex:a ex:name "Alice". ex:b ex:name "Bob".`),
      ),
    ).toEqual({});
    const data = graph(
      `<${SUBJECT}> ex:child ex:a; ex:ok "kept". ex:a ex:name "Alice"; ex:optional "wrong".`,
    );
    expect(parse(nested(), SUBJECT, data)).toEqual({ ok: "kept" });
    expect(parse(nested("sh:maxCount 1", "; sh:severity sh:Warning"), SUBJECT, data)).toEqual({
      ok: "kept",
    });
  });
  it("enforces explicit link class through data subclasses", () => {
    const model = nested("sh:maxCount 1; sh:class ex:Person");
    expect(
      parse(model, SUBJECT, graph(`<${SUBJECT}> ex:child ex:a. ex:a ex:name "Alice".`)),
    ).toEqual({});
    expect(
      parse(
        model,
        SUBJECT,
        graph(
          `<${SUBJECT}> ex:child ex:a. ex:a ex:name "Alice"; a ex:Worker. ex:Worker rdfs:subClassOf ex:Person.`,
        ),
      ),
    ).toEqual({ child: { name: "Alice" } });
    expect(parse(model, SUBJECT, build(model, SUBJECT, { child: { name: "Alice" } }))).toEqual({
      child: { name: "Alice" },
    });
  });
  it("rejects cyclic JS values and avoids minting over caller IRI identities", () => {
    const model = nested();
    const cyclic: Record<string, unknown> = {};
    cyclic.child = cyclic;
    expect(validate(model, cyclic as never).valid).toBe(false);
    const collision = compileForm(
      graph(
        "ex:Form a sh:NodeShape; sh:property [sh:path ex:child; sh:node ex:Child; sh:maxCount 1], [sh:path ex:iri; sh:nodeKind sh:IRI; sh:maxCount 1]. ex:Child a sh:NodeShape; sh:property [sh:path ex:name; sh:datatype xsd:string; sh:maxCount 1].",
      ),
      SHAPE,
    );
    const values = { child: { name: "Alice" }, iri: `${EX}response#form-node-1` };
    expect(parse(collision, SUBJECT, build(collision, SUBJECT, values))).toEqual(values);
  });
});
