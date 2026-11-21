// AUTHORED-BY Codex GPT-6.1-Sol
import type { ExecutionResult } from "@jeswr/site-executor";
import { SAB } from "@jeswr/site-model";
import { DataFactory } from "n3";
import { writeQuads } from "../rdf.js";

export function fallbackReceipt(result: ExecutionResult): void {
  if (!result.committed.length) return;
  const { namedNode, blankNode, literal, quad } = DataFactory;
  const node = blankNode();
  const status = result.status === "done" ? "completed" : "uncertain";
  const label = result.committed.at(-1)?.target.label ?? "Fallback write";
  result.outcome = { status, target: label, effect: "irreversible-write" };
  result.observations.unshift({
    operation: "urn:sab:fallback:receipt",
    status: 200,
    itemCount: 0,
    turtle: writeQuads([
      quad(
        node,
        namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        namedNode(`${SAB}ActionOutcome`),
      ),
      quad(
        node,
        namedNode(`${SAB}status`),
        namedNode(`${SAB}${status === "completed" ? "Completed" : "Uncertain"}`),
      ),
      quad(node, namedNode(`${SAB}target`), literal(label)),
      quad(node, namedNode(`${SAB}effect`), namedNode(`${SAB}IrreversibleWrite`)),
    ]),
  });
}
