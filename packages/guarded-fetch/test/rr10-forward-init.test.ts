// AUTHORED-BY Codex GPT-6.1-Sol
import { Request as UndiciRequest } from "undici";
import { describe, expect, it, vi } from "vitest";
import { refuseRedirects } from "../src/refuseRedirects.js";

const TARGET = "https://api.example/upload";
const implementations = {
  native: (input: RequestInfo | URL, init?: RequestInit): Request => new Request(input, init),
  undici: (input: RequestInfo | URL, init?: RequestInit): Request =>
    new UndiciRequest(input as never, init as never) as unknown as Request,
};

for (const [name, construct] of Object.entries(implementations)) {
  describe(`refuseRedirects: ${name} nullish body overrides`, () => {
    it.each([undefined, null])("inherits the POST payload with init.body = %s", async (body) => {
      const init = { body };
      // Main passes (request, init) directly to Fetch: nullish bodies inherit the upload.
      const baseline = construct(construct(TARGET, { method: "POST", body: "payload" }), init);
      expect(await baseline.text()).toBe("payload");

      const sent: { url: string; method: string; body: string; redirect: string }[] = [];
      const transport = vi.fn<typeof fetch>(async (input, options) => {
        const request = construct(input, options);
        sent.push({
          url: request.url,
          method: request.method,
          body: await request.text(),
          redirect: request.redirect,
        });
        return new Response("ok");
      });
      await refuseRedirects(transport)(
        construct(TARGET, { method: "POST", body: "payload" }),
        init,
      );

      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0]?.[1]).toHaveProperty("body", body);
      expect(sent).toEqual([{ url: TARGET, method: "POST", body: "payload", redirect: "manual" }]);
    });
  });
}
