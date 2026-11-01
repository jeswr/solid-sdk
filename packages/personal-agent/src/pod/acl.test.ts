// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { writeOwnerOnlyAcl } from "./acl.js";

const CONTAINER = "https://pod.example/proposals/";
const OWNER = "https://pod.example/profile/card#me";

describe("writeOwnerOnlyAcl discovery", () => {
  it("writes the discovered ACL instead of a guessed .acl URL", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method === "HEAD")
        return new Response(null, { headers: { link: '<owner-policy>; rel="acl"' } });
      return new Response(null, { status: init?.method === "GET" ? 404 : 201 });
    });
    await writeOwnerOnlyAcl(fetch, CONTAINER, OWNER);
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [CONTAINER, "HEAD"],
      [`${CONTAINER}owner-policy`, "GET"],
      [`${CONTAINER}owner-policy`, "PUT"],
    ]);
    expect(String(fetch.mock.calls[2]?.[1]?.body)).toContain(`acl:agent <${OWNER}>`);
  });

  it.each([
    "",
    '<.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
    '<https://foreign.example/.acl>; rel="acl"',
  ])("refuses all writes when discovery is unsupported (%s)", async (link) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { headers: { link } }),
    );
    await expect(writeOwnerOnlyAcl(fetch, CONTAINER, OWNER)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("HEAD");
  });
});
