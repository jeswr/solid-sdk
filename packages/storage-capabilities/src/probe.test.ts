// AUTHORED-BY GPT-6.1-Sol
import { describe, expect, test, vi } from "vitest";
import { probe } from "./probe.js";
import { ACP } from "./vocab.js";

const ROOT = "https://pod.example/alice/";

describe("probe", () => {
  test("parses OPTIONS capability and permission headers with evidence", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(null, {
        headers: {
          "Accept-Patch": "text/n3, application/sparql-update",
          "Accept-Post": "text/turtle, application/ld+json",
          "WAC-Allow": 'user="read write control", public="read"',
          Link: `<.acl>; rel="acl", <.acr>; rel="${ACP.accessControl}"`,
          Allow: "GET, HEAD, OPTIONS, PUT, POST, DELETE",
        },
      }),
    );
    const signal = new AbortController().signal;
    const result = await probe(`${ROOT}#fragment`, fetch, { now: () => 42, signal });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(ROOT, {
      method: "OPTIONS",
      redirect: "manual",
      signal,
    });
    expect(result).toMatchObject({
      url: ROOT,
      observedAt: 42,
      acceptPatch: ["text/n3", "application/sparql-update"],
      acceptPost: ["text/turtle", "application/ld+json"],
      wacAllow: { user: ["read", "write", "control"], public: ["read"] },
      aclLink: `${ROOT}.acl`,
      acpLink: `${ROOT}.acr`,
      allow: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "DELETE"],
    });
    expect(result.evidence.map((entry) => entry.header)).toEqual([
      "accept-patch",
      "accept-post",
      "allow",
      "link",
      "wac-allow",
    ]);
  });

  test.each([401, 403, 405, 501])("falls back to HEAD after OPTIONS %i", async (status) => {
    const cancelled = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), { status }))
      .mockResolvedValueOnce(
        new Response(null, { status: 403, headers: { "WAC-Allow": 'user="read"' } }),
      );
    const result = await probe(ROOT, fetch);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["OPTIONS", "HEAD"]);
    expect(result.wacAllow?.user).toEqual(["read"]);
    expect(result.observedAt).toBeGreaterThan(0);
  });

  test("falls back on transport failure but does not retry an aborted request", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(null));
    expect(await probe(ROOT, fetch)).toMatchObject({ evidence: [] });
    const controller = new AbortController();
    controller.abort();
    fetch.mockClear().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(probe(ROOT, fetch, { signal: controller.signal })).rejects.toMatchObject({
      code: "network",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("reports a failed HEAD and refuses invalid URLs without fetching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("offline"));
    await expect(probe(ROOT, fetch)).rejects.toMatchObject({ code: "network", url: ROOT });
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockClear();
    await expect(probe("file:///private", fetch)).rejects.toMatchObject({
      code: "description-invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
