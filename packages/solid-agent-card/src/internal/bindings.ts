// AUTHORED-BY Codex GPT-6.1-Sol
import { type ChannelCapability, podRecordSchema } from "@jeswr/agent-model";

/** Copy and validate the public extension rather than forwarding arbitrary account data. */
export function validateBindings(bindings: readonly ChannelCapability[]): ChannelCapability[] {
  const seen = new Set<string>();
  return bindings.map((binding) => {
    const parsed = podRecordSchema.safeParse(binding);
    if (!parsed.success || parsed.data.type !== "channel-capability") {
      throw new TypeError("describeAgent: invalid channel capability.");
    }
    if (seen.has(parsed.data.id)) {
      throw new TypeError("describeAgent: duplicate channel capability id.");
    }
    seen.add(parsed.data.id);
    return parsed.data;
  });
}
