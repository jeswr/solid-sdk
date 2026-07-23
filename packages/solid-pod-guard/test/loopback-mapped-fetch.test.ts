import { describe, expect, it } from "vitest";
import { loopbackMappedFetch } from "../src/owner.js";

/**
 * A fake `base` fetch that records every URL it is called with and answers per
 * a scheme-driven behaviour. `undefined` ⇒ a connection-layer throw (the
 * stand-in / TLS listener is absent).
 */
function fakeBase(behaviour: (url: URL) => Response | undefined) {
  const calls: string[] = [];
  const fn: typeof fetch = async (input) => {
    const href = input instanceof Request ? input.url : String(input);
    calls.push(href);
    const res = behaviour(new URL(href));
    if (res === undefined) throw new TypeError("fetch failed");
    return res;
  };
  return { fn, calls };
}

describe("loopbackMappedFetch", () => {
  it("maps https loopback onto the http stand-in when the issuer serves plain HTTP", async () => {
    const { fn, calls } = fakeBase((u) =>
      u.protocol === "http:" ? new Response("ok") : undefined,
    );
    const res = await loopbackMappedFetch(fn)("https://localhost:3000/profile#me");
    expect(await res.text()).toBe("ok");
    // http stand-in tried first and succeeded; no https fallback needed.
    expect(calls).toEqual(["http://localhost:3000/profile#me"]);
  });

  it("falls back to the claimed https when the issuer serves REAL TLS (the fix)", async () => {
    // The http stand-in is absent (connection error); only real https answers.
    const { fn, calls } = fakeBase((u) =>
      u.protocol === "https:" ? new Response("tls") : undefined,
    );
    const res = await loopbackMappedFetch(fn)("https://localhost:3000/profile#me");
    expect(await res.text()).toBe("tls");
    expect(calls).toEqual([
      "http://localhost:3000/profile#me",
      "https://localhost:3000/profile#me",
    ]);
  });

  it("also falls back for 127.0.0.1 and [::1] loopback literals", async () => {
    for (const host of ["127.0.0.1", "[::1]"]) {
      const { fn, calls } = fakeBase((u) =>
        u.protocol === "https:" ? new Response("tls") : undefined,
      );
      await loopbackMappedFetch(fn)(`https://${host}:3000/profile#me`);
      expect(calls).toEqual([`http://${host}:3000/profile#me`, `https://${host}:3000/profile#me`]);
    }
  });

  it("passes NON-loopback https through untouched (no downgrade, no second attempt)", async () => {
    const { fn, calls } = fakeBase(() => new Response("prod"));
    await loopbackMappedFetch(fn)("https://pods.example/alex/profile/card#me");
    expect(calls).toEqual(["https://pods.example/alex/profile/card#me"]);
  });

  it("passes already-http loopback through untouched", async () => {
    const { fn, calls } = fakeBase(() => new Response("http"));
    await loopbackMappedFetch(fn)("http://localhost:3000/profile#me");
    expect(calls).toEqual(["http://localhost:3000/profile#me"]);
  });

  it("surfaces the http-attempt error when BOTH schemes fail (fail closed)", async () => {
    const { fn } = fakeBase(() => undefined);
    await expect(loopbackMappedFetch(fn)("https://localhost:3000/profile#me")).rejects.toThrow();
  });

  it("preserves method/headers when the input is a Request", async () => {
    let method: string | undefined;
    let accept: string | null = null;
    const fn: typeof fetch = async (input) => {
      const req = input as Request;
      method = req.method;
      accept = req.headers.get("accept");
      return new Response("ok");
    };
    await loopbackMappedFetch(fn)(
      new Request("https://localhost:3000/profile#me", {
        method: "GET",
        headers: { accept: "text/turtle" },
      }),
    );
    expect(method).toBe("GET");
    expect(accept).toBe("text/turtle");
  });
});
