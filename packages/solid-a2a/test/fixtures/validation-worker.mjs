// AUTHORED-BY Codex GPT-6.1-Sol
import { workerData } from "node:worker_threads";
import SHACLValidator from "rdf-validate-shacl";

if (workerData.crash) throw new Error("simulated worker crash");
if (workerData.exitEarly) process.exit(0);

const validate = SHACLValidator.prototype.validate;
SHACLValidator.prototype.validate = function (...args) {
  Atomics.store(new Int32Array(workerData.started), 0, 1);
  const started = performance.now();
  // An infinite synchronous validator cannot be stopped by a Promise race.
  while (performance.now() - started < workerData.delayMs) {}
  return validate.apply(this, args);
};
await import(workerData.actualWorker);
