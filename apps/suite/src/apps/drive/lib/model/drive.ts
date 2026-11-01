// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { type DriveContainer, readContainer } from "./model.js";

export interface ContainerListing {
  container: DriveContainer;
  etag: string | null;
  url: string;
}

/** Model I/O seam. DRV-01 supplies the protocol-neutral SDK listing adapter later. */
export async function listContainer(
  fetch: typeof globalThis.fetch,
  containerUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<ContainerListing> {
  const url = containerUrl.endsWith("/") ? containerUrl : `${containerUrl}/`;
  const result = await fetchRdf(url, { fetch, ...options });
  return {
    container: readContainer(result.url, result.dataset),
    etag: result.etag,
    url: result.url,
  };
}
