// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import type { Board } from "../lib/repository";
/** Canvas and descriptor writes settle independently; late saves must preserve a newer name. */
export function mergeBoardFields(
  current: Board,
  incoming: Board,
  fields: "canvas" | "metadata" | "all",
): Board {
  if (fields === "all") return incoming;
  return fields === "canvas"
    ? { ...current, scene: incoming.scene, etag: incoming.etag }
    : {
        ...current,
        title: incoming.title,
        metadata: incoming.metadata,
        descriptorEtag: incoming.descriptorEtag,
        descriptorText: incoming.descriptorText,
      };
}
