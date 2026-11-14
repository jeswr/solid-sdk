// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { invalid } from "./adapter.js";
import type { ProtocolObjects, SettlementSuite } from "./types.js";

const carriedSchema = z.strictObject({
  suite: z.string(),
  objects: z
    .array(
      z.strictObject({
        name: z.string(),
        form: z.string(),
        shown: z.json(),
        raw: z.json().optional(),
      }),
    )
    .min(1),
});
export function readCarried(value: unknown, suite: SettlementSuite): ProtocolObjects {
  const parsed = carriedSchema.safeParse(value);
  if (!parsed.success || parsed.data.suite !== suite.id) return invalid();
  const carried = parsed.data;
  // Only exact, previously verified content can resolve a retained host association.
  suite.lift(carried);
  return suite.restore?.(carried) ?? carried;
}
export function carry(objects: ProtocolObjects): ProtocolObjects {
  // The order's request and key publications have their own recipient-specific messages.
  const object = objects.objects.at(-1);
  if (!object) return invalid();
  return { suite: objects.suite, objects: [object] };
}
