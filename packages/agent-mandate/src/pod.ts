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
  /**
   * Owner-trusted location of the mandate credential (host configuration, never model or
   * remote input). Must be https and on the owner's storage: the status list is derived
   * from it, so an attacker-chosen location could replay an older status list.
   */
  readonly credentialUrl: string;
  readonly ownerWebId: string;
  readonly agentId: string;
  readonly fetch: NonNullable<ResolveWebIdKeyOptions["fetch"]>;
  /**
   * Fetch used for WebID profiles and verification methods. Pass an unauthenticated fetch
   * when profiles may live outside the pod; omitting it reuses `fetch`, which then may reach
   * the origin hosting a WebID.
   */
  readonly profileFetch?: NonNullable<ResolveWebIdKeyOptions["fetch"]>;
  readonly now?: () => Date;
}

type Fetch = PodMandateOptions["fetch"];

/** Revocation and key-control evidence must never come from an HTTP cache. */
function noStore(fetch: Fetch): Fetch {
  return ((input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) =>
    fetch(input, { ...init, cache: "no-store" })) as Fetch;
}

/** Bounded browser-safe transport; parsing alone never establishes authority. */
export function createPodMandateVerifier(options: PodMandateOptions): MandateVerifier {
  const fetch = noStore(options.fetch);
  const profileFetch = noStore(options.profileFetch ?? options.fetch);
  let statusListCredential: string;
  try {
    statusListCredential = new URL("status.ttl", options.credentialUrl).href;
    if (new URL(options.credentialUrl).protocol !== "https:") throw new Error();
    if (!statusListCredential.endsWith("/agent/mandates/status.ttl")) throw new Error();
  } catch {
    throw new TypeError("Invalid mandate status location");
  }
  return {
    async load() {
      try {
        const keys = createWebIdKeyResolver({ fetch: profileFetch });
        const now = (options.now ?? (() => new Date()))();
        return await createVcMandateVerifier({
          ownerWebId: options.ownerWebId,
          agentWebId: options.agentId,
          statusListCredential,
          webIdKeyResolver: keys,
          now: () => now,
          resolveStatus: createBitstringStatusResolver({
            fetch,
            resolveKey: keys.resolveKey,
            isControlledBy: keys.isControlledBy,
            now,
            trustedStatusIssuers: [options.ownerWebId],
          }),
          read: async () => {
            const response = await fetch(options.credentialUrl, {
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
