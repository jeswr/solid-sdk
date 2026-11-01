// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { describe, expect, it, vi } from "vitest";
import { listContainer } from "../../src/apps/drive/lib/model/drive.js";

const url = "https://pod.example/drive/";
const body = `<${url}> <http://www.w3.org/ns/ldp#contains> <${url}file.txt>, <${url}folder/>.`;
function response(text = body, headers: Record<string, string> = { etag: '"1"' }) {
  const res = new Response(text, { headers: { "Content-Type": "text/turtle", ...headers } });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

describe("injected-fetch model listing", () => {
  it("retains validators, normalizes a slashless container and sorts its entries", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
    const result = await listContainer(fetch, url.slice(0, -1));
    expect(String(fetch.mock.calls[0]?.[0])).toBe(url);
    expect(result.url).toBe(url);
    expect(result.etag).toBe('"1"');
    expect(result.container.entries.map((entry) => entry.name)).toEqual(["folder", "file.txt"]);
  });

  it("forwards cancellation, accepts empty containers and preserves missing ETags", async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response("", {}));
    const result = await listContainer(fetch, url, { signal });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(signal);
    expect(result.etag).toBeNull();
    expect(result.container.entries).toEqual([]);
  });

  it.each([
    401, 403, 404, 500,
  ])("retains RDF error status %s for later adapters", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status }));
    await expect(listContainer(fetch, url)).rejects.toMatchObject({ status });
  });

  it("surfaces network errors without depending on the global fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("offline"));
    await expect(listContainer(fetch, url)).rejects.toBeInstanceOf(RdfFetchError);
  });
});
