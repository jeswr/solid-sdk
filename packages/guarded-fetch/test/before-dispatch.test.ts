// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { createGuardedFetch } from "../src/index.js";

it("checks authority synchronously after awaited DNS and immediately before fetch", async () => {
  let allow!: () => void;
  let started!: () => void;
  const dns = new Promise<void>((resolve) => {
    allow = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let authority = true;
  const refusal = new Error("authority revoked");
  const beforeDispatch = vi.fn(() => {
    if (!authority) throw refusal;
  });
  const fetch = vi.fn(async () => new Response("sent"));
  const guarded = createGuardedFetch({
    pinningFetch: fetch,
    beforeDispatch,
    dnsLookup: async () => {
      started();
      await dns;
      return [{ address: "1.1.1.1", family: 4 }];
    },
  });
  const result = guarded("https://allowed.example");
  await entered;
  expect(beforeDispatch).not.toHaveBeenCalled();
  authority = false;
  allow();
  await expect(result).rejects.toBe(refusal);
  expect(fetch).not.toHaveBeenCalled();
  authority = true;
  let fenced = false;
  const synchronous = createGuardedFetch({
    dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
    beforeDispatch: () => {
      fenced = true;
      queueMicrotask(() => {
        fenced = false;
      });
    },
    pinningFetch: async () => {
      expect(fenced).toBe(true);
      return new Response("sent");
    },
  });
  expect(await (await synchronous("https://allowed.example")).text()).toBe("sent");
});

it("rechecks after DNS for every redirect hop", async () => {
  const refusal = new Error("revoked at second destination");
  const beforeDispatch = vi
    .fn()
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw refusal;
    });
  const fetch = vi.fn(
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example" },
      }),
  );
  const guarded = createGuardedFetch({
    pinningFetch: fetch,
    beforeDispatch,
    dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
  });
  await expect(guarded("https://allowed.example")).rejects.toBe(refusal);
  expect(fetch).toHaveBeenCalledOnce();
});
