// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { discoverInbox, noFollowFetch } from "./agent-target.js";

const webId = "https://8.8.8.8/profile#me";
const inbox = "https://8.8.4.4/inbox/";

test("delegates exact-subject discovery and its recipient cache to the SDK", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(`<${webId}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
      headers: { "content-type": "text/turtle" },
    }),
  );
  expect(await discoverInbox(webId, fetch)).toBe(inbox);
  expect(await discoverInbox(webId, fetch)).toBe(inbox);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(webId.split("#")[0]);
});

test("foreign resource reads retain public HTTPS, byte limits and redirect refusal", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response(null, { status: 307, headers: { location: "https://127.0.0.1/" } }),
    );
  await expect(noFollowFetch(fetch)(inbox)).rejects.toThrow();
  expect(fetch.mock.calls[0][1]?.redirect).toBe("manual");
  await expect(noFollowFetch(fetch)("https://127.0.0.1/")).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
