// AUTHORED-BY Codex GPT-6.1-Sol
import { parentPort, workerData } from "node:worker_threads";
import type { Quad } from "@rdfjs/types";
import { DataFactory, type Quad as N3Quad } from "n3";
import { validateGraphs } from "./validationCore.js";
import type { ValidationWorkerData } from "./validationWorkerClient.js";

if (!parentPort) throw new Error("SHACL validation requires a worker message port");

try {
  const { data, shapes } = workerData as ValidationWorkerData;
  // Structured cloning discards RDF/JS prototypes; restore them with N3 rather
  // than relying on clone-specific term layouts or constructing RDF syntax.
  const decode = (json: string): Quad[] =>
    (JSON.parse(json) as N3Quad[]).map((quad) => DataFactory.fromQuad(quad));
  parentPort.postMessage(await validateGraphs(decode(data), decode(shapes)));
} catch (error) {
  parentPort.postMessage({
    conforms: false,
    results: [{ message: error instanceof Error ? error.message : String(error) }],
  });
}
