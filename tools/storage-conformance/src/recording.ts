// AUTHORED-BY Codex GPT-6.1-Sol
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRecordingFetch } from "@jeswr/storage-client/testing";

/** Record only storage traffic; account and token exchanges must never pass this seam. */
export function recordingSession(
  target: "css" | "sparq-solid",
  transport: typeof fetch,
  directory = fileURLToPath(
    new URL(`../../../packages/storage-client/testing/fixtures/${target}/`, import.meta.url),
  ),
) {
  // Separate runs and scenarios avoid clobbering prior evidence or resetting sequence numbers.
  const run = randomUUID();
  let requests = 0;
  let current: typeof fetch;
  const select = (scenario: string) => {
    if (!/^[A-Za-z0-9-]+$/.test(scenario)) throw new TypeError("Invalid fixture scenario");
    current = createRecordingFetch({ fetch: transport, directory: join(directory, run, scenario) });
  };
  select("setup");
  return {
    fetch: ((input, init) => {
      requests++;
      return current(input, init);
    }) as typeof fetch,
    requestCount: () => requests,
    recordScenario: select,
  };
}
