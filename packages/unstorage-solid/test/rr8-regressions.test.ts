// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { RedirectRefusedError } from "@jeswr/guarded-fetch";
import { describe, expect, it, vi } from "vitest";
import {
  createSameOriginRedirectRefusingFetch,
  createScopedFetch,
  SolidRedirectError,
} from "../src/scope.js";

const BASE = "https://pod.example/alice/";
const TARGET = `${BASE}item`;
const ORIGIN = new URL(BASE).origin;
// Use guarded-fetch's existing transport dependency, without adding a dependency here.
const { Request: UndiciRequest, Response: UndiciResponse } = createRequire(
  new URL("../node_modules/@jeswr/guarded-fetch/dist/node.js", import.meta.url),
)("undici") as { Request: typeof Request; Response: typeof Response };
const implementations = {
  native: (input: RequestInfo | URL, init?: RequestInit): Request => new Request(input, init),
  undici: (input: RequestInfo | URL, init?: RequestInit): Request =>
    new UndiciRequest(input as never, init as never) as unknown as Request,
};
const wrappers = {
  createScopedFetch: (transport: typeof fetch) => createScopedFetch(BASE, transport),
  createSameOriginRedirectRefusingFetch: (transport: typeof fetch) =>
    createSameOriginRedirectRefusingFetch(ORIGIN, transport),
};

for (const [inputName, constructInput] of Object.entries(implementations)) {
  for (const [transportName, constructTransport] of Object.entries(implementations)) {
    for (const [wrapperName, wrap] of Object.entries(wrappers)) {
      describe(`${wrapperName}: ${inputName} input, ${transportName} consuming transport`, () => {
        it("reads init.body once across metadata capture and redirect refusal", async () => {
          const input = constructInput(TARGET, { method: "POST", body: "original" });
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("replacement"));
              controller.close();
            },
          });
          const body = vi.fn().mockReturnValueOnce(stream).mockReturnValue(undefined);
          await wrap(async (input, init) => {
            expect(await constructTransport(input, init).text()).toBe("replacement");
            return new Response();
          })(input, {
            method: "PUT",
            duplex: "half",
            get body() {
              return body();
            },
          } as RequestInit);
          expect(body).toHaveBeenCalledOnce();
          expect(await input.text()).toBe("original");
        });
        for (const body of [null, undefined]) {
          it.each([
            "fresh",
            "consumed",
            "locked",
          ] as const)(`reuses a %s POST twice with body: ${body}, leaving its original body untouched`, async (state) => {
            const input = constructInput(TARGET, { method: "POST", body: "original" });
            if (state === "consumed") expect(await input.text()).toBe("original");
            const original = input.body;
            const reader = state === "locked" ? original?.getReader() : undefined;
            const wasUsed = input.bodyUsed;
            const wasLocked = original?.locked;
            const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
              expect(input).toBe(TARGET);
              // Main's wrappers forward only explicit init; the input's POST is discarded.
              expect(init).toEqual({ body, redirect: "manual" });
              const effective = constructTransport(input, init);
              expect(effective.method).toBe("GET");
              expect(effective.redirect).toBe("manual");
              expect(effective.body).toBeNull();
              expect(await effective.text()).toBe("");
              return new Response("ok");
            });
            const guarded = wrap(transport);
            try {
              for (let call = 0; call < 2; call += 1) {
                expect(await (await guarded(input, { body })).text()).toBe("ok");
                expect(input.body).toBe(original);
                expect(input.bodyUsed).toBe(wasUsed);
                expect(original?.locked).toBe(wasLocked);
              }
              expect(transport).toHaveBeenCalledTimes(2);
            } finally {
              reader?.releaseLock();
            }
            if (state !== "consumed") expect(await input.text()).toBe("original");
          });
        }
      });
    }
  }
}

for (const [wrapperName, wrap] of Object.entries(wrappers)) {
  for (const [name, ResponseImpl] of Object.entries({ native: Response, undici: UndiciResponse })) {
    it(`${wrapperName} promptly refuses a ${name} redirect while the transport retains its clone`, async () => {
      let retained: Response | undefined;
      let cancellation: Promise<void> | undefined;
      let cancelSettled = false;
      const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const effective = new Request(input, init);
        expect(effective.redirect).toBe("manual");
        expect(await effective.text()).toBe("");
        const response = new ResponseImpl("redirect body", {
          status: 307,
          headers: { location: `${BASE}next` },
        }) as unknown as Response;
        retained = response.clone();
        const cancel = response.body?.cancel.bind(response.body);
        vi.spyOn(response.body as ReadableStream, "cancel").mockImplementation(() => {
          cancellation = cancel?.();
          void cancellation?.then(() => {
            cancelSettled = true;
          });
          return cancellation as Promise<void>;
        });
        return response;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const pending = wrap(transport)(TARGET, { redirect: "follow" });
        const bounded = Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("redirect refusal hung on clone")), 500);
          }),
        ]);
        await expect(bounded).rejects.toBeInstanceOf(SolidRedirectError);
        await expect(pending).rejects.toMatchObject({ url: TARGET, status: 307 });
        expect(SolidRedirectError).toBe(RedirectRefusedError);
        expect(transport).toHaveBeenCalledOnce();
        expect(cancellation).toBeInstanceOf(Promise);
        expect(cancelSettled).toBe(false);
      } finally {
        clearTimeout(timer);
        if (retained) expect(await retained.text()).toBe("redirect body");
        await cancellation;
      }
    }, 1_000);
  }
}
