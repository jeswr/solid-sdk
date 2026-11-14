// AUTHORED-BY Codex GPT-6.1-Sol
import { type Operation, SCHEMA } from "@jeswr/site-model";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";
import type { Replayer } from "./verify.js";
import { learnEffectVerification } from "./write-effect.js";

/** Fetch only an identity actually deleted in the demonstration; never guess an unused ID. */
export async function probeDeletedResources(
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
  replayer: Replayer,
): Promise<void> {
  for (const operation of operations) {
    if (operation.actionType !== `${SCHEMA}DeleteAction`) continue;
    const witnesses: RecordedRequest[] = [];
    const declaration = learnEffectVerification(
      operation,
      operations,
      trace,
      origin,
      (_write, before) => witnesses.push(before),
    );
    const read = operations.find((op) => op.id === declaration?.operation);
    if (!declaration || declaration.notFound || !read) continue;
    for (const before of witnesses) {
      const values = matchRequest(read.request, before);
      if (!values) continue;
      await replayer
        .get(before.url, {
          signedIn: true,
          headers: { ...before.requestHeaders, "cache-control": "no-cache", pragma: "no-cache" },
          request: read.request,
          csrf: read.csrf,
          values,
        })
        .catch(() => undefined);
    }
  }
}
