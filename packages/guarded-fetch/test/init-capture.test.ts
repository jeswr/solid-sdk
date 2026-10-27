// AUTHORED-BY Codex GPT-6.1-Sol
import { Request as UndiciRequest } from "undici";
import { describe, expect, it, vi } from "vitest";
import {
  createPodScopedFetch,
  refuseRedirects,
  snapshotFetchInput,
  snapshotRequest,
} from "../src/index.js";

const TARGET = "https://pod.example/alice/item";
const constructors = {
  native: (input: RequestInfo | URL, init?: RequestInit): Request => new Request(input, init),
  undici: (input: RequestInfo | URL, init?: RequestInit): Request =>
    new UndiciRequest(input as never, init as never) as unknown as Request,
};

for (const [implementation, construct] of Object.entries(constructors)) {
  describe(`${implementation}: init capture`, () => {
    for (const kind of ["string", "URL", "Request"] as const) {
      it.each([
        "spread",
        "direct",
      ] as const)(`${kind}: reads a replacement body accessor once in %s mode`, async (initSemantics) => {
        const input =
          kind === "string"
            ? TARGET
            : kind === "URL"
              ? new URL(TARGET)
              : construct(TARGET, { method: "POST", body: "original" });
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("replacement"));
            controller.close();
          },
        });
        const getBody = vi.fn().mockReturnValueOnce(body).mockReturnValue(undefined);
        const init = {
          method: "PUT",
          duplex: "half",
          get body() {
            return getBody();
          },
        } as RequestInit;
        const transport = vi.fn<typeof fetch>(async (input, init) => {
          expect(await construct(input, init).text()).toBe("replacement");
          return new Response();
        });
        const fetch: typeof globalThis.fetch =
          initSemantics === "spread"
            ? refuseRedirects(transport)
            : async (input, init) => {
                const snapshot = snapshotFetchInput(input, init, { forward: true, initSemantics });
                return refuseRedirects(transport)(snapshot.input, snapshot.init);
              };
        await fetch(input, init);
        expect(getBody).toHaveBeenCalledOnce();
        expect(transport).toHaveBeenCalledOnce();
        if (typeof input !== "string" && !(input instanceof URL))
          expect(await input.text()).toBe("original");
      });
    }

    it.each([
      "inherited",
      "hidden",
    ])("keeps %s method/body/headers/signal in direct mode, and ignores them in spread wrappers", async (kind) => {
      const reason = new Error("cancelled");
      const values = {
        method: "PUT",
        body: "replacement",
        headers: { "x-option": "keep" },
        signal: AbortSignal.abort(reason),
      };
      const init: RequestInit =
        kind === "inherited"
          ? Object.create(values)
          : Object.defineProperties(
              {},
              Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
            );
      const snapshot = snapshotFetchInput(construct(TARGET), init, {
        forward: true,
        initSemantics: "direct",
      });
      const effective = construct(snapshot.input, snapshot.init);
      expect(effective.method).toBe("PUT");
      expect(effective.headers.get("x-option")).toBe("keep");
      expect(await effective.text()).toBe("replacement");
      expect(() => effective.signal.throwIfAborted()).toThrow(reason);
      for (const wrap of [
        refuseRedirects,
        (fetch: typeof globalThis.fetch) =>
          createPodScopedFetch("https://pod.example/alice/", { fetch }),
      ]) {
        await wrap(async (input, init) => {
          const request = construct(input, init);
          expect(request.method).toBe("GET");
          expect(request.headers.has("x-option")).toBe(false);
          expect(request.signal.aborted).toBe(false);
          expect(await request.text()).toBe("");
          return new Response();
        })(construct(TARGET), init);
      }
    });
  });
}

it("snapshotRequest honours inherited and non-enumerable init options", async () => {
  const reason = new Error("cancelled");
  const init = Object.create({ signal: AbortSignal.abort(reason), method: "PUT" });
  Object.defineProperty(init, "body", { value: "replacement" });
  const request = snapshotRequest(new Request(TARGET), init);
  expect(request.method).toBe("PUT");
  expect(await request.text()).toBe("replacement");
  expect(() => request.signal.throwIfAborted()).toThrow(reason);
});

it("direct capture reads each known member once, omits undefined, and preserves dispatcher", () => {
  const members = [
    "method",
    "headers",
    "body",
    "referrer",
    "referrerPolicy",
    "mode",
    "credentials",
    "cache",
    "redirect",
    "integrity",
    "keepalive",
    "signal",
    "duplex",
    "priority",
    "window",
    "dispatcher",
  ];
  const dispatcher = {};
  const reads: string[] = [];
  const init = new Proxy(Object.create({ dispatcher }), {
    get(target, key) {
      reads.push(String(key));
      return Reflect.get(target, key);
    },
  });
  const snapshot = snapshotFetchInput(TARGET, init, { forward: true, initSemantics: "direct" });
  expect(reads).toEqual(members);
  expect(snapshot.init).toEqual({ dispatcher });
});
