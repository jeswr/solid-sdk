// AUTHORED-BY Codex GPT-6
import { PodScopeError, RedirectRefusedError } from "@jeswr/guarded-fetch";
import { describe, expect, it, vi } from "vitest";
import {
  discoverRegistrations,
  ensureTypeRegistrations,
} from "../../src/apps/docs/lib/model/type-index.js";
import { DOCUMENT_CLASS, NS } from "../../src/apps/docs/lib/model/vocab.js";
import { mockFetch, turtleToStore } from "./helpers.js";

const POD = "https://pod.example/alice/";
const WEBID = `${POD}profile/card#me`;
const INDEX = `${POD}settings/privateTypeIndex.ttl`;
const REG = { forClass: DOCUMENT_CLASS, container: `${POD}docs/` };
const profile = (index: string) => `<${WEBID}> <${NS.SOLID}privateTypeIndex> <${index}>.`;

const unsafe = [
  "https://evil.example/index.ttl",
  "https://pod.example/alice-other/index.ttl",
  "https://pod.example/index.ttl",
  "http://pod.example/alice/index.ttl",
  "javascript:alert(1)",
  "file:///index.ttl",
  "https://user:password@pod.example/alice/index.ttl",
  `${POD}settings/..%2f..%2findex.ttl`,
];

describe("Type Index scope", () => {
  it.each(unsafe)("rejects linked %s before authenticated index I/O", async (index) => {
    const { fetch, calls } = mockFetch({ [`GET ${WEBID}`]: { body: profile(index) } });
    await expect(
      ensureTypeRegistrations({
        webId: WEBID,
        podRoot: POD,
        registrations: [REG],
        fetchImpl: fetch,
      }),
    ).rejects.toBeInstanceOf(PodScopeError);
    expect(calls.map((call) => call.url)).toEqual([WEBID]);
    calls.length = 0;
    await expect(
      discoverRegistrations(WEBID, turtleToStore(profile(index), WEBID), fetch, POD),
    ).rejects.toBeInstanceOf(PodScopeError);
    expect(calls).toEqual([]);
  });

  it.each(["GET", "PUT"])("refuses an escaping %s redirect during registration", async (method) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.redirect).toBe("manual");
      if (String(url) === WEBID)
        return new Response(profile(INDEX), { headers: { "content-type": "text/turtle" } });
      expect(String(url)).toBe(INDEX);
      if ((init?.method ?? "GET") === method)
        return new Response(null, {
          status: 307,
          headers: { location: "https://evil.example/index.ttl" },
        });
      return new Response(null, { status: 404 });
    });
    await expect(
      ensureTypeRegistrations({ webId: WEBID, podRoot: POD, registrations: [REG], fetchImpl }),
    ).rejects.toMatchObject(
      method === "GET" ? { cause: expect.any(PodScopeError) } : expect.any(PodScopeError),
    );
    expect(fetchImpl.mock.calls.every(([url]) => [WEBID, INDEX].includes(String(url)))).toBe(true);
  });

  it("refuses escaping discovery redirects and never fetches the target", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "/bob/index.ttl" } });
    });
    await expect(
      discoverRegistrations(WEBID, turtleToStore(profile(INDEX), WEBID), fetchImpl, POD),
    ).rejects.toMatchObject({ cause: expect.any(PodScopeError) });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses profile redirects before fetching another profile", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/profile" } }),
    );
    await expect(
      ensureTypeRegistrations({ webId: WEBID, podRoot: POD, registrations: [REG], fetchImpl }),
    ).rejects.toMatchObject({ cause: expect.any(RedirectRefusedError) });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("drops registered destinations outside the selected storage", async () => {
    const { fetch } = mockFetch({
      [`GET ${INDEX}`]: {
        body: `
      @prefix solid: <${NS.SOLID}>.
      <#a> a solid:TypeRegistration; solid:forClass <${DOCUMENT_CLASS}>; solid:instance <https://evil.example/doc>.
      <#b> a solid:TypeRegistration; solid:forClass <${DOCUMENT_CLASS}>; solid:instanceContainer <https://pod.example/bob/docs/>.
      <#c> a solid:TypeRegistration; solid:forClass <${DOCUMENT_CLASS}>; solid:instance <${POD}docs/one.ttl>.
    `,
      },
    });
    expect(
      await discoverRegistrations(WEBID, turtleToStore(profile(INDEX), WEBID), fetch, POD),
    ).toEqual([{ forClass: DOCUMENT_CLASS, instance: `${POD}docs/one.ttl`, container: undefined }]);
  });

  it("rejects out-of-scope registration destinations before any I/O", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      ensureTypeRegistrations({
        webId: WEBID,
        podRoot: POD,
        registrations: [{ ...REG, container: "https://evil.example/docs/" }],
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(PodScopeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
