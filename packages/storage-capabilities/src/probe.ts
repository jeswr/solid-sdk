// AUTHORED-BY GPT-6.1-Sol
import { discardBody, httpUrl, request } from "./http.js";
import { parseProbeHeaders } from "./probe-headers.js";
import type { ProbeResult, ResolveOptions } from "./types.js";

/**
 * Probe a Solid root with OPTIONS, falling back to HEAD if OPTIONS is unsupported
 * or its transport fails. Reads permission headers even on a denied HEAD response.
 * LWS descriptions are authoritative; callers must only invoke this for Solid.
 */
export async function probe(
  root: string,
  fetch: typeof globalThis.fetch,
  options: Pick<ResolveOptions, "signal" | "now"> = {},
): Promise<ProbeResult> {
  const url = httpUrl(root).href;
  const transport = { fetch, signal: options.signal };
  let response: Response | undefined;
  try {
    response = await request(url, transport, { method: "OPTIONS" });
  } catch (error) {
    if (options.signal?.aborted) throw error;
  }
  if (!response?.ok) {
    if (response) await discardBody(response);
    response = await request(url, transport, { method: "HEAD" });
  }
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => {
    headers.push([name, value]);
  });
  const result = parseProbeHeaders(url, headers, (options.now ?? Date.now)());
  await discardBody(response);
  return result;
}
