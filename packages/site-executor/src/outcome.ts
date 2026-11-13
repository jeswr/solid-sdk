// AUTHORED-BY Codex GPT-6

import { EFFECT_IRI, PREFIXES, SAB, SCHEMA } from "@jeswr/site-model";
import { DataFactory, Parser, type Quad, Writer } from "n3";
import type { ExecutionOutcome } from "./executor.js";

const { blankNode, namedNode, literal, quad } = DataFactory;
const type = `${PREFIXES.rdf}type`;

/** Only trusted fields on the identified final item enter the completion receipt. */
export function outcomeTurtle(outcome: ExecutionOutcome, finalTurtle = ""): string {
  const node = blankNode();
  const quads: Quad[] = [
    quad(node, namedNode(type), namedNode(`${SAB}ActionOutcome`)),
    quad(
      node,
      namedNode(`${SAB}status`),
      namedNode(
        `${SAB}${outcome.status === "completed" ? "Completed" : outcome.status === "uncertain" ? "Uncertain" : "Failed"}`,
      ),
    ),
    quad(node, namedNode(`${SAB}target`), literal(outcome.target)),
    quad(node, namedNode(`${SAB}effect`), namedNode(EFFECT_IRI[outcome.effect])),
  ];
  if (outcome.amount !== undefined)
    quads.push(
      quad(
        node,
        namedNode(`${SCHEMA}price`),
        literal(outcome.amount, namedNode(`${PREFIXES.xsd}decimal`)),
      ),
    );
  if (outcome.currency !== undefined)
    quads.push(quad(node, namedNode(`${SCHEMA}priceCurrency`), literal(outcome.currency)));
  if (outcome.result) {
    const result = namedNode(outcome.result);
    quads.push(quad(node, namedNode(`${SCHEMA}result`), result));
    const facts = new Parser().parse(finalTurtle);
    const untrusted = new Set(
      facts
        .filter((q) => q.predicate.value === type && q.object.value === `${SAB}UntrustedText`)
        .map((q) => q.subject.value),
    );
    const item = facts.find(
      (q) => q.predicate.value === type && !untrusted.has(q.subject.value),
    )?.subject;
    if (item)
      for (const q of facts) {
        if (
          !q.subject.equals(item) ||
          untrusted.has(q.subject.value) ||
          (q.object.termType === "BlankNode" && untrusted.has(q.object.value)) ||
          (q.object.termType === "Literal" && q.object.datatype.value === `${SAB}UntrustedText`)
        )
          continue;
        quads.push(quad(result, q.predicate, q.object, q.graph));
      }
  }
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  writer.addQuads(quads);
  let turtle = "";
  writer.end((error, text) => {
    if (error) throw error;
    turtle = text;
  });
  return turtle;
}
