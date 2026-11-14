// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createApprovalGate, type Gate, guardUrl } from "@jeswr/site-executor";
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
  gate: Gate = createApprovalGate(),
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
      const authorize = async (url: string) => {
        const guarded = guardUrl(url, origin);
        const decision = await gate.authorize({
          site: origin,
          target: {
            kind: "operation",
            id: read.id,
            label: read.label,
            actionType: read.actionType,
          },
          effect: "read",
          inputs: values,
          summary: `Verify demonstrated deletion on ${guarded.host}`,
          digest: JSON.stringify([read.id, guarded.href, values]),
        });
        if (decision.kind !== "allow") throw new Error("Deleted-resource read denied");
      };
      // Denial must prevent even a preparatory request made by the replayer.
      try {
        await authorize(before.url);
      } catch {
        continue;
      }
      await replayer
        .get(before.url, {
          signedIn: true,
          headers: { ...before.requestHeaders, "cache-control": "no-cache", pragma: "no-cache" },
          request: read.request,
          csrf: read.csrf,
          values,
          authorize,
        })
        .catch(() => undefined);
    }
  }
}
