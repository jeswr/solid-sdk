// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createNodeGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch/node";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";

/** Resolve only the verified WebID; ambiguous storage requires operator selection. */
export async function podRootFor(webId: string, transport?: typeof fetch): Promise<string> {
  const url = new URL(webId);
  url.hash = "";
  const { dataset } = await fetchRdf(url.href, {
    fetch: refuseRedirects(
      transport ??
        createNodeGuardedFetch({ maxBytes: 1024 * 1024, timeoutMs: 8_000, maxRedirects: 0 }),
    ),
  });
  const roots = [...new Agent(webId, dataset, DataFactory).storageUrls];
  if (roots.length !== 1) throw new Error("Expected exactly one advertised pod root");
  return roots[0] as string;
}
