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
const MAX_BODY_BYTES = 256 * 1024;

/** Evidence must use HTTPS, bypass caches and refuse redirects. */
function noStore(inner: Fetch): Fetch {
  return (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).protocol !== "https:") throw new TypeError("Evidence requires HTTPS");
    return inner(input, { ...init, cache: "no-store", redirect: "manual" });
  }) as Fetch;
}

/** Stop reading immediately at the byte ceiling, before any parser buffers the body. */
async function readBoundedBody(response: Response): Promise<string | undefined> {
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
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Evidence body exceeds byte limit");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** The delegated WebID resolver buffers text, so bound its transport first. */
function boundedProfiles(inner: Fetch): Fetch {
  return (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const response = await inner(input, init);
    const text = await readBoundedBody(response);
    const bounded = new Response(text === undefined ? null : new TextEncoder().encode(text), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    // The constructor cannot carry these, but resolver redirect checks require them.
    Object.defineProperties(bounded, {
      url: { value: response.url },
      redirected: { value: response.redirected },
    });
    return bounded;
  }) as Fetch;
}

/** Bounded browser-safe transport; parsing alone never establishes authority. */
export function createPodMandateVerifier(options: PodMandateOptions): MandateVerifier {
  const evidenceFetch = noStore(options.fetch);
  const profileFetch = boundedProfiles(noStore(options.profileFetch ?? options.fetch));
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
            fetch: evidenceFetch,
            resolveKey: keys.resolveKey,
            isControlledBy: keys.isControlledBy,
            now,
            trustedStatusIssuers: [options.ownerWebId],
          }),
          read: async () => {
            const response = await evidenceFetch(options.credentialUrl, {
              headers: { Accept: "application/trig" },
              redirect: "manual",
            });
            if (
              !response.ok ||
              response.redirected ||
              (response.url && response.url !== options.credentialUrl)
            )
              return undefined;
            const text = await readBoundedBody(response);
            if (text === undefined) return undefined;
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
