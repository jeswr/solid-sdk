// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { isOwnPodIri, podScopedFetch } from "./pod-scoped-fetch.js";

afterEach(() => vi.unstubAllGlobals());
it("scopes credentials to the storage path, including its slashless root", async () => {
  const auth = vi.fn(async () => new Response());
  const scoped = podScopedFetch(auth, "https://pods.example/alice/");
  for (const input of [
    "https://pods.example/alice",
    new URL("https://pods.example/alice/doc#it"),
    new Request("https://pods.example/alice/doc"),
  ])
    await scoped(input);
  expect(auth).toHaveBeenCalledTimes(3);
  expect(auth).toHaveBeenLastCalledWith(expect.any(Request), { redirect: "error" });
  expect(isOwnPodIri("https://pods.example/a", "https://pods.example/")).toBe(true);
  for (const iri of [
    "bad",
    "javascript:bad",
    "https://u:p@pods.example/alice/a",
    "https://pods.example/alice-other/a",
    "https://pods.example/bob/a",
    "https://else.example/alice/a",
    "https://pods.example/alice/%2f../bob",
  ])
    expect(isOwnPodIri(iri, "https://pods.example/alice/")).toBe(false);
  expect(isOwnPodIri("https://pods.example/alice/a", "bad")).toBe(false);
  await expect(scoped("bad")).rejects.toThrow("Invalid resource IRI");
});
it("bypasses the auth/native cache and strips credentials and referrers for foreign requests", async () => {
  const auth = vi.fn();
  const anonymous = vi.fn(async () => new Response());
  vi.stubGlobal("fetch", anonymous);
  const scoped = podScopedFetch(auth, "https://pods.example/alice/");
  await scoped("https://foreign.example/resource");
  const request = new Request("https://pods.example/bob/doc", {
    headers: {
      Authorization: "Bearer secret",
      DPoP: "secret",
      Cookie: "secret",
      Accept: "text/turtle",
    },
  });
  await scoped(request, {
    credentials: "include",
    referrerPolicy: "unsafe-url",
    headers: { "Proxy-Authorization": "secret", "X-Display": "value" },
  });
  expect(auth).not.toHaveBeenCalled();
  const init = anonymous.mock.calls[1]?.[1] as RequestInit;
  expect(init).toMatchObject({
    credentials: "omit",
    referrerPolicy: "no-referrer",
    referrer: "",
    cache: "no-store",
    redirect: "error",
  });
  expect([...new Headers(init.headers)]).toEqual([
    ["accept", "text/turtle"],
    ["x-display", "value"],
  ]);
});
