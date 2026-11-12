// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
    redirect: "follow",
  });
  expect([...new Headers(init.headers)]).toEqual([
    ["accept", "text/turtle"],
    ["x-display", "value"],
  ]);
});
it("follows redirects anonymously so redirected WebIDs (303, w3id) stay resolvable", async () => {
  const auth = vi.fn();
  const anonymous = vi.fn(async () => new Response());
  vi.stubGlobal("fetch", anonymous);
  await podScopedFetch(auth, "https://pods.example/alice/")("https://w3id.org/people/bob", {
    redirect: "error",
  });
  expect(auth).not.toHaveBeenCalled();
  expect(anonymous.mock.calls[0]?.[1]).toMatchObject({ redirect: "follow", credentials: "omit" });
});
it("grants credentials to each root with strict per-root path checks", async () => {
  const roots = ["https://pods.example/alice/", "https://pods.example/bob/docs/x/"] as const;
  const auth = vi.fn(async () => new Response());
  const anonymous = vi.fn(async () => new Response());
  vi.stubGlobal("fetch", anonymous);
  const scoped = podScopedFetch(auth, roots);
  for (const iri of [
    "https://pods.example/alice/notes/a.ttl",
    "https://pods.example/bob/docs/x",
    "https://pods.example/bob/docs/x/comments/1.ttl",
    "https://pods.example/bob/docs/x/versions/",
    "https://pods.example/bob/docs/x/assets/img.png",
  ]) {
    expect(isOwnPodIri(iri, roots)).toBe(true);
    await scoped(iri, { redirect: "follow" });
  }
  expect(auth).toHaveBeenCalledTimes(5);
  expect(auth).toHaveBeenLastCalledWith("https://pods.example/bob/docs/x/assets/img.png", {
    redirect: "error",
  });
  for (const iri of [
    "https://pods.example/bob/docs/x.ttl",
    "https://pods.example/bob/docs/xy/a",
    "https://pods.example/bob/docs/x-other/a",
    "https://pods.example/bob/private.ttl",
    "https://pods.example/bob/docs/x/..%2f..%2fprivate.ttl",
    "https://pods.example/bob/docs/x/%5C..%5C..%5Cprivate.ttl",
    "https://pods.example/bob/docs/x/../../private.ttl",
    "https://other.example/bob/docs/x/a",
    "http://pods.example/bob/docs/x/a",
  ]) {
    expect(isOwnPodIri(iri, roots)).toBe(false);
    await scoped(iri);
  }
  expect(isOwnPodIri("https://u:p@pods.example/bob/docs/x/a", roots)).toBe(false);
  await expect(scoped("https://u:p@pods.example/bob/docs/x/a")).rejects.toThrow(TypeError);
  expect(auth).toHaveBeenCalledTimes(5);
  expect(anonymous).toHaveBeenCalledTimes(9);
});
it("ignores invalid roots and grants nothing for an empty root list", async () => {
  const iri = "https://pods.example/alice/a";
  expect(isOwnPodIri(iri, [])).toBe(false);
  expect(isOwnPodIri(iri, ["bad", "javascript:x", "https://u:p@pods.example/alice/"])).toBe(false);
  expect(isOwnPodIri(iri, ["https://pods.example/a%2fb/", "https://pods.example/alice/"])).toBe(
    true,
  );
  const auth = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response()),
  );
  await podScopedFetch(auth, [])(iri);
  expect(auth).not.toHaveBeenCalled();
});
