// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createBitstringStatusResolver,
  createWebIdKeyResolver,
  type ResolveWebIdKeyOptions,
} from "@jeswr/solid-vc";
import { parseMandateCredential } from "./document.js";
import { createVcMandateVerifier } from "./mandate.js";
import type { MandateVerifier } from "./types.js";

export interface PodMandateOptions {
  readonly credentialUrl: string;
  readonly ownerWebId: string;
  readonly agentId: string;
  readonly fetch: NonNullable<ResolveWebIdKeyOptions["fetch"]>;
  readonly profileFetch?: NonNullable<ResolveWebIdKeyOptions["fetch"]>;
  readonly now?: () => Date;
}

/** Bounded browser-safe transport; parsing alone never establishes authority. */
export function createPodMandateVerifier(options: PodMandateOptions): MandateVerifier {
  let statusListCredential: string;
  try {
    statusListCredential = new URL("status.ttl", options.credentialUrl).href;
    if (!statusListCredential.endsWith("/agent/mandates/status.ttl")) throw new Error();
  } catch {
    throw new TypeError("Invalid mandate status location");
  }
  return {
    async load() {
      try {
        const keys = createWebIdKeyResolver({ fetch: options.profileFetch ?? options.fetch });
        const now = (options.now ?? (() => new Date()))();
        return await createVcMandateVerifier({
          ownerWebId: options.ownerWebId,
          agentWebId: options.agentId,
          statusListCredential,
          webIdKeyResolver: keys,
          now: () => now,
          resolveStatus: createBitstringStatusResolver({
            fetch: options.fetch,
            resolveKey: keys.resolveKey,
            isControlledBy: keys.isControlledBy,
            now,
            trustedStatusIssuers: [options.ownerWebId],
          }),
          read: async () => {
            const response = await options.fetch(options.credentialUrl, {
              headers: { Accept: "application/trig" },
              redirect: "manual",
            });
            if (
              !response.ok ||
              response.redirected ||
              (response.url && response.url !== options.credentialUrl)
            )
              return undefined;
            const reader = response.body?.getReader();
            if (!reader) return undefined;
            let bytes = 0;
            let text = "";
            const decoder = new TextDecoder();
            try {
              for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > 256 * 1024) {
                  await reader.cancel();
                  return undefined;
                }
                text += decoder.decode(chunk.value, { stream: true });
              }
              text += decoder.decode();
            } finally {
              reader.releaseLock();
            }
            const vc = await parseMandateCredential(text);
            return vc?.id === options.credentialUrl ? vc : undefined;
          },
        }).load();
      } catch {
        return undefined;
      }
    },
  };
}
