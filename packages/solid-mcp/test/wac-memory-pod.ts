// AUTHORED-BY Codex GPT-6
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import type { PodPort } from "../src/pod-port.js";

/** Keep even the new shared ancestor's advertised ACL inside the protected area. */
export function memoryAclUrl(root: string, target: string): string {
  return target === new URL("private/", root).href
    ? new URL("private/pkg/private.acl", root).href
    : `${target}.acl`;
}

/** Explicit WAC metadata for fixtures; the generic memory port promises no WAC support. */
export function createWacMemoryPodPort(
  options: Parameters<typeof createMemoryPodPort>[0],
): PodPort {
  return {
    ...createMemoryPodPort(options),
    async head(target) {
      return { acl: memoryAclUrl(options.root, target) };
    },
  };
}
