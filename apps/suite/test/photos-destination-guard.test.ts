// AUTHORED-BY Claude Sonnet 5.5
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";

const opened = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@jeswr/storage-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/storage-client")>()),
  createPodClient: opened.open,
}));
const { destinationGuard } = await import("../src/apps/photos/lib/data/private-destination");

const root = "https://pod.example/alice/";
const owner = "https://alice.example/profile#me";
const bob = "https://bob.example/#me";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const PREFIX =
  "@prefix acl: <http://www.w3.org/ns/auth/acl#>. @prefix foaf: <http://xmlns.com/foaf/0.1/>.\n";
const ownerAll = "acl:Read, acl:Write, acl:Control";
const wac = (target: string, agent: string, modes: string) =>
  `[] a acl:Authorization; acl:accessTo <${target}>; acl:default <${target}>; ${agent}; acl:mode ${modes}.\n`;
const originals = `${root}photos/originals/`;

/** A WAC pod over fetch. Containers advertise their own `.acl`; missing documents are 404. */
function pod(docs: Record<string, string>, failing: string[] = []) {
  const containers = new Set([
    root,
    `${root}photos/`,
    originals,
    `${root}photos/thumbs/`,
    `${root}photos/items/`,
  ]);
  const requests: { method: string; url: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    requests.push({ method, url });
    if (failing.includes(url)) throw new TypeError("network down");
    if (containers.has(url)) {
      const link = [
        `<${url}.acl>; rel="acl"`,
        '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        ...(url === root ? [`<${PIM_STORAGE}>; rel="type"`] : []),
      ];
      return new Response(method === "HEAD" ? null : "", {
        headers: { link: link.join(", "), etag: '"c"', "content-type": "text/turtle" },
      });
    }
    const doc = docs[url];
    if (doc === undefined) return new Response(null, { status: 404 });
    return new Response(method === "HEAD" ? null : PREFIX + doc, {
      headers: { "content-type": "text/turtle", etag: '"1"' },
    });
  }) as unknown as typeof globalThis.fetch;
  const storage = createSolidBackend({
    fetch,
    root,
    features: {
      ...createMemoryStorage({ root }).features,
      accessControl: { state: "available", detail: { model: "wac" }, evidence: "fixture" },
    },
  });
  opened.open.mockResolvedValue({ storage });
  const session = { mode: "solid", storageUrl: root, webId: owner, fetch } as unknown as PodSession;
  return { session, requests };
}
const writes = (requests: { method: string }[]) =>
  requests.filter(({ method }) => !["GET", "HEAD"].includes(method));

beforeEach(() => {
  opened.open.mockReset();
});

describe("destinationGuard against a stubbed pod", () => {
  it("allows a container whose inherited policy is owner-only, and never writes", async () => {
    const { session, requests } = pod({
      [`${root}.acl`]: wac(root, `acl:agent <${owner}>`, ownerAll),
    });
    expect(await destinationGuard(session)(originals)).toBe(true);
    expect(requests.length).toBeGreaterThan(0);
    expect(writes(requests)).toEqual([]);
  });
  it("refuses when the inherited root policy also grants public read", async () => {
    const { session, requests } = pod({
      [`${root}.acl`]:
        wac(root, `acl:agent <${owner}>`, ownerAll) +
        wac(root, "acl:agentClass foaf:Agent", "acl:Read"),
    });
    expect(await destinationGuard(session)(originals)).toBe(false);
    expect(writes(requests)).toEqual([]);
  });
  it("refuses when the container's own policy shares it with someone else", async () => {
    const { session, requests } = pod({
      [`${root}.acl`]: wac(root, `acl:agent <${owner}>`, ownerAll),
      [`${originals}.acl`]:
        wac(originals, `acl:agent <${owner}>`, ownerAll) +
        wac(originals, `acl:agent <${bob}>`, "acl:Read"),
    });
    expect(await destinationGuard(session)(originals)).toBe(false);
    expect(writes(requests)).toEqual([]);
  });
  it("refuses when no access document can be read at all", async () => {
    const { session } = pod({});
    expect(await destinationGuard(session)(originals)).toBe(false);
  });
  it("refuses when a policy request throws, and recovers once the pod answers", async () => {
    const acl = `${root}.acl`;
    const down = pod({ [acl]: wac(root, `acl:agent <${owner}>`, ownerAll) }, [acl]);
    expect(await destinationGuard(down.session)(originals)).toBe(false);
    const up = pod({ [acl]: wac(root, `acl:agent <${owner}>`, ownerAll) });
    expect(await destinationGuard(up.session)(originals)).toBe(true);
  });
  it("refuses when the storage client cannot be opened, then opens it again next time", async () => {
    const { session } = pod({ [`${root}.acl`]: wac(root, `acl:agent <${owner}>`, ownerAll) });
    const { storage } = await opened.open();
    opened.open.mockClear();
    opened.open.mockRejectedValueOnce(new Error("discovery failed")).mockResolvedValue({ storage });
    const guard = destinationGuard(session);
    expect(await guard(originals)).toBe(false);
    expect(await guard(originals)).toBe(true);
    expect(opened.open).toHaveBeenCalledTimes(2);
  });
  it("opens the storage client once per session", async () => {
    const { session } = pod({ [`${root}.acl`]: wac(root, `acl:agent <${owner}>`, ownerAll) });
    const guard = destinationGuard(session);
    await guard(originals);
    await guard(`${root}photos/thumbs/`);
    expect(opened.open).toHaveBeenCalledTimes(1);
  });
  it("refuses a destination outside the storage", async () => {
    const { session } = pod({ [`${root}.acl`]: wac(root, `acl:agent <${owner}>`, ownerAll) });
    expect(await destinationGuard(session)("https://evil.example/photos/originals/")).toBe(false);
  });
  it("trusts the demo pod only through its explicit isolated-backend marker", async () => {
    const marked = vi.fn(
      async () => new Response(null, { headers: { "X-Solid-Demo-Access-Control": "none" } }),
    );
    const demo = (fetch: unknown) =>
      ({ mode: "demo", storageUrl: root, webId: owner, fetch }) as unknown as PodSession;
    expect(await destinationGuard(demo(marked))(originals)).toBe(true);
    expect(await destinationGuard(demo(vi.fn(async () => new Response())))(originals)).toBe(false);
    expect(opened.open).not.toHaveBeenCalled();
  });
});
