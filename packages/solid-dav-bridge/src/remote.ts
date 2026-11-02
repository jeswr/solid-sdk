// AUTHORED-BY Codex GPT-6.1-Sol
import { type FetchDavOptions, fetchDavWithFetch } from "./remote-core.js";

export { type DavAuth, DavFetchError, type FetchDavOptions } from "./remote-core.js";
/** Node callers retain DNS-pinned defaults; browsers use the explicit injected-fetch entry. */
export async function fetchDav(url: string, options: FetchDavOptions = {}): Promise<string> {
  const fetch = options.fetch ?? (await import("@jeswr/guarded-fetch/node")).nodeGuardedFetch;
  return fetchDavWithFetch(url, { ...options, fetch });
}
