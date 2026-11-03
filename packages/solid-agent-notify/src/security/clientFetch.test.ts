// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
import { clientFetch } from "./clientFetch.js";

afterEach(() => vi.unstubAllGlobals());

test.each([
  undefined,
  null,
  {},
])("recognizes a browser only with window === globalThis and a document (%j)", async (document) => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", document);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
  await expect(clientFetch({ fetch })("https://8.8.8.8/profile")).resolves.toHaveProperty(
    "status",
    200,
  );
  expect(fetch).toHaveBeenCalledOnce();
});
