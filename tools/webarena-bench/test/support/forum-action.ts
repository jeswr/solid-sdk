// AUTHORED-BY Codex GPT-6.1-Sol
import type { Operation } from "@jeswr/site-model";
import { DataFactory, Writer } from "n3";

const { blankNode, namedNode, literal } = DataFactory;
const sab = "https://jeswr.org/ns/site-action#";
export async function forumAction(
  op: Pick<Operation, "id" | "actionType" | "inputs">,
  values: Record<string, string>,
  targetName?: string,
) {
  const root = blankNode();
  const writer = new Writer();
  writer.addQuad(
    root,
    namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
    namedNode(op.actionType),
  );
  writer.addQuad(root, namedNode(`${sab}operation`), literal(op.id));
  const nodes = new Map<string, ReturnType<typeof blankNode>>([["", root]]);
  for (const param of op.inputs) {
    const value = values[param.name];
    if (value === undefined || !param.path.length) continue;
    let node = root;
    if (
      param.path.length === 1 &&
      param.path[0] === "https://schema.org/object" &&
      param.range.startsWith("https://schema.org/") &&
      targetName
    ) {
      const child = blankNode();
      nodes.set(param.path[0], child);
      writer.addQuad(root, namedNode(param.path[0]), child);
      writer.addQuad(child, namedNode("https://schema.org/identifier"), literal(value));
      continue;
    }
    param.path.forEach((property, index) => {
      if (index === param.path.length - 1)
        writer.addQuad(node, namedNode(property), literal(value));
      else {
        const key = param.path.slice(0, index + 1).join(" ");
        let child = nodes.get(key);
        if (!child) {
          child = blankNode();
          nodes.set(key, child);
          writer.addQuad(node, namedNode(property), child);
        }
        node = child;
      }
    });
  }
  if (targetName) {
    let object = nodes.get("https://schema.org/object");
    if (!object) {
      object = blankNode();
      writer.addQuad(root, namedNode("https://schema.org/object"), object);
    }
    writer.addQuad(object, namedNode("https://schema.org/name"), literal(targetName));
  }
  return new Promise<string>((resolve, reject) =>
    writer.end((err, text) => (err ? reject(err) : resolve(text))),
  );
}
