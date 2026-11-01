// AUTHORED-BY Codex GPT-6
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import type { PodPort } from "../src/pod-port.js";

/** Explicit WAC metadata for fixtures; the generic memory port promises no WAC support. */
export function createWacMemoryPodPort(
  options: Parameters<typeof createMemoryPodPort>[0],
): PodPort {
  return {
    ...createMemoryPodPort(options),
    async head(target) {
      return { acl: `${target}.acl` };
    },
  };
}
