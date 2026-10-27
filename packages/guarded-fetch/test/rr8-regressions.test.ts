// AUTHORED-BY Codex GPT-6.1-Sol
import { Request as UndiciRequest, Response as UndiciResponse } from "undici";
import { describe, expect, it, vi } from "vitest";
import {
  createGuardedFetch,
  createPodScopedFetch,
  RedirectRefusedError,
  refuseRedirects,
} from "../src/index.js";

const BASE = "https://pod.example/alice/";
const TARGET = `${BASE}item`;
const implementations = {
  native: (input: RequestInfo | URL, init?: RequestInit): Request => new Request(input, init),
  undici: (input: RequestInfo | URL, init?: RequestInit): Request =>
    new UndiciRequest(input as never, init as never) as unknown as Request,
};
const wrappers = {
  // Frozen main's URL/init normalization, so the same consuming transport checks the oracle.
  main:
    (transport: typeof fetch): typeof fetch =>
    async (input, init) => {
      const request = input as Request;
      return transport(request.url, {
        method: request.method,
        headers: request.headers,
        credentials: request.credentials,
        redirect: request.redirect,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.body ? { body: request.body, duplex: "half" } : {}),
        ...init,
      } as RequestInit);
    },
  createPodScopedFetch: (transport: typeof fetch) =>
    createPodScopedFetch(BASE, { fetch: transport }),
  createGuardedFetch: (transport: typeof fetch) =>
    createGuardedFetch({
      fetch: transport,
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    }),
};

function replacementStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("replacement upload"));
      controller.close();
    },
  });
}

for (const [inputName, constructInput] of Object.entries(implementations)) {
  for (const [transportName, constructTransport] of Object.entries(implementations)) {
    for (const [wrapperName, wrap] of Object.entries(wrappers)) {
      describe(`${wrapperName}: ${inputName} input, ${transportName} consuming transport`, () => {
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
              expect(init).toHaveProperty("body", body);
              const effective = constructTransport(input, init);
              expect(effective.method).toBe("POST");
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

        it.each([
          "fresh",
          "consumed",
          "locked",
        ] as const)("uploads a stream override of a %s POST with inherited duplex half", async (state) => {
          const input = constructInput(TARGET, { method: "POST", body: "original" });
          if (state === "consumed") await input.text();
          const reader = state === "locked" ? input.body?.getReader() : undefined;
          const wasUsed = input.bodyUsed;
          const wasLocked = input.body?.locked;
          const body = replacementStream();
          const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(input).toBe(TARGET);
            expect(init).toHaveProperty("body", body);
            expect(init).toHaveProperty("duplex", "half");
            const effective = constructTransport(input, init);
            expect(effective.method).toBe("POST");
            expect(effective).toHaveProperty("duplex", "half");
            expect(await effective.text()).toBe("replacement upload");
            return new Response("uploaded");
          });
          try {
            expect(await (await wrap(transport)(input, { body })).text()).toBe("uploaded");
            expect(transport).toHaveBeenCalledOnce();
            expect(input.bodyUsed).toBe(wasUsed);
            expect(input.body?.locked).toBe(wasLocked);
          } finally {
            reader?.releaseLock();
          }
          if (state !== "consumed") expect(await input.text()).toBe("original");
        });

        it.each([
          false,
          true,
        ])("matches main for a body-less POST stream override (explicit duplex %s)", async (explicitDuplex) => {
          const input = constructInput(TARGET, { method: "POST" });
          const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (!explicitDuplex) expect(init).not.toHaveProperty("duplex");
            const effective = constructTransport(input, init);
            expect(await effective.text()).toBe("replacement upload");
            return new Response("uploaded");
          });
          const pending = wrap(transport)(input, {
            body: replacementStream(),
            ...(explicitDuplex ? { duplex: "half" } : {}),
          } as RequestInit);
          if (explicitDuplex) {
            expect(await (await pending).text()).toBe("uploaded");
          } else {
            await expect(pending).rejects.toThrow(/duplex/i);
          }
          expect(transport).toHaveBeenCalledOnce();
          expect(input.body).toBeNull();
          expect(input.bodyUsed).toBe(false);
        });

        it.each([
          "inherited",
          "non-enumerable",
        ] as const)("ignores an %s nullish body key, as main's init spread does", async (kind) => {
          const input = constructInput(TARGET, { method: "POST", body: "original" });
          const init =
            kind === "inherited"
              ? Object.create({ body: null })
              : Object.defineProperty({}, "body", { value: undefined });
          const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(await constructTransport(input, init).text()).toBe("original");
            return new Response("ok");
          });
          expect(await (await wrap(transport)(input, init)).text()).toBe("ok");
          expect(transport).toHaveBeenCalledOnce();
        });
      });
    }
  }
}

for (const [name, ResponseImpl] of Object.entries({ native: Response, undici: UndiciResponse })) {
  it(`refuseRedirects promptly refuses a ${name} redirect while the transport retains its clone`, async () => {
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
      const pending = refuseRedirects(transport)(TARGET, { redirect: "follow" });
      const bounded = Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("redirect refusal hung on clone")), 500);
        }),
      ]);
      await expect(bounded).rejects.toBeInstanceOf(RedirectRefusedError);
      await expect(pending).rejects.toMatchObject({ url: TARGET, status: 307 });
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
