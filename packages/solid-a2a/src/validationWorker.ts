// AUTHORED-BY Codex GPT-6.1-Sol
import { parentPort } from "node:worker_threads";
import { validateGraphs } from "./validationCore.js";
import { decodeValidationQuads } from "./validationTransfer.js";
import type { ValidationWorkerRequest } from "./validationWorkerClient.js";

if (!parentPort) throw new Error("SHACL validation requires a worker message port");
const port = parentPort;
port.on("message", async ({ id, data, shapes }: ValidationWorkerRequest) => {
  try {
    port.postMessage({
      id,
      report: await validateGraphs(decodeValidationQuads(data), decodeValidationQuads(shapes)),
    });
  } catch (error) {
    port.postMessage({
      id,
      report: {
        conforms: false,
        results: [{ message: error instanceof Error ? error.message : String(error) }],
      },
    });
  }
});
// Ready means the validator and its dependencies have loaded, not just Worker 'online'.
port.postMessage({ ready: true });
