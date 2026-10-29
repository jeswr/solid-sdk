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

describe("refuseRedirects bases body replacement on the init it forwards (Codex rr11)", () => {
  const inherited = () => Object.create({ body: "replacement" }) as RequestInit;
  const hidden = () => {
    const init: RequestInit = {};
    Object.defineProperty(init, "body", { value: "replacement", enumerable: false });
    return init;
  };
  for (const [implementation, Ctor] of [
    ["native", Request],
    ["undici", UndiciRequest],
  ] as const) {
    for (const [kind, make] of [
      ["inherited", inherited],
      ["non-enumerable", hidden],
    ] as const) {
      it(`sends the ${implementation} Request body when init has an ${kind} body`, async () => {
        const request = new Ctor("https://pod.example/alice/doc", {
          method: "POST",
          body: "payload",
        });
        const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          // Each implementation reads its own Request brand.
          expect(await new (Ctor as typeof Request)(input as Request, init).text()).toBe("payload");
          return new Response("ok");
        });
        await refuseRedirects(transport as typeof fetch)(request as Request, make());
        expect(transport).toHaveBeenCalledOnce();
      });
    }
  }
});
