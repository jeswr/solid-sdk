// AUTHORED-BY Codex GPT-6
import type { PathResult } from "./run.js";
/** Called before adding a manifest row or writing any trace/outline artifact. */
export function assertPublishable(path: Pick<PathResult, "usedTestDouble">): void {
  if (path.usedTestDouble)
    throw new Error("Refusing to write a runs row or trace produced with a test-double verifier.");
}
