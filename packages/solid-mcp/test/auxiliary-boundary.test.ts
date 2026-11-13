// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { PodOutput } from "../src/output.js";
import { PERSONAL_DATA_DENIED } from "../src/personal-data.js";
import { createFetchPodPort, type PodHeadResult, type PodPort } from "../src/pod-port.js";

const ROOT = "https://example.org/pod/";
const SAFE = `${ROOT}ordinary.txt`;
const BODY = new TextEncoder().encode("ordinary");
const TARGETS = [
  ROOT,
  `${ROOT}private/`,
  `${ROOT}private/pkg/`,
  `${ROOT}agent/`,
  `${ROOT}agent/context/`,
  `${ROOT}agent/memory/`,
  `${ROOT}agent/memory/health/`,
  `${ROOT}agent/accounts/`,
  `${ROOT}profile/`,
  `${ROOT}profile/card`,
].sort();

function fixture(adapter: string, root = ROOT, webId = `${root}profile/card#me`) {
  const metadata = new Map<string, PodHeadResult>();
  const head = vi.fn(
    async (target: string): Promise<PodHeadResult> =>
      metadata.get(target) ?? { acl: `${target}.acl` },
  );
  const write = vi.fn(async () => ({ etag: '"new"' }));
  const remove = vi.fn(async () => {});
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "HEAD") {
      const result = await head(request.url);
      const links = [
        ...(result.acl ? [`<${result.acl}>; rel="acl"`] : []),
        ...(result.describedby ?? []).map((url) => `<${url}>; rel="describedby"`),
      ];
      // Missing protected areas still advertise their governing associations.
      return new Response(null, { status: 404, headers: { link: links.join(", ") } });
    }
    if (request.method === "PUT") {
      await write();
      return new Response(null, { status: 201 });
    }
    if (request.method === "DELETE") {
      await remove();
      return new Response(null, { status: 204 });
    }
    return new Response(BODY, { headers: { "content-type": "text/plain" } });
  });
  const portable: PodPort = {
    root,
    webId,
    head,
    read: vi.fn(async () => ({ body: BODY, contentType: "text/plain" })),
    list: vi.fn(async () => []),
    write,
    delete: remove,
  };
  const pod =
    adapter === "fetch"
      ? createFetchPodPort({ podRoot: root, webId, fetch, readOnly: false })
      : portable;
  return { pod, metadata, head, write, remove, fetch, output: new PodOutput(pod) };
}

async function refused(f: ReturnType<typeof fixture>, target: string) {
  await expect(f.output.write(target, BODY, "text/plain", {})).rejects.toThrow(
    PERSONAL_DATA_DENIED,
  );
  await expect(f.output.delete(target)).rejects.toThrow(PERSONAL_DATA_DENIED);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.remove).not.toHaveBeenCalled();
  expect(
    f.fetch.mock.calls.some(([input, init]) =>
      ["PUT", "DELETE"].includes(new Request(input, init).method),
    ),
  ).toBe(false);
}

describe.each(["portable", "fetch"])("advertised auxiliary boundary: %s", (adapter) => {
  it.each([
    ["agent/", "acl", "policies/agent-rules.ttl"],
    ["", "acl", "root-policy"],
    ["private/", "acl", "policies/private-rules"],
    ["private/pkg/", "describedby", "meta/x"],
    ["agent/context/", "acl", "policies/context"],
    ["agent/memory/", "describedby", "policies/memory.acr"],
    ["agent/accounts/", "describedby", "policies/accounts?ext=acr"],
    ["agent/memory/health/", "acl", "policies/health-rules"],
    ["agent/memory/health/", "describedby", "meta/health.acr"],
    ["agent/", "acl", "policies/agent.acr"],
    ["agent/", "acl", "policies/agent?ext=acr"],
    ["profile/", "acl", "policies/profile-parent"],
    ["profile/card", "acl", "policies/profile"],
  ])("refuses %s's %s association at %s without backend mutations", async (area, rel, path) => {
    const f = fixture(adapter);
    const target = `${ROOT}${path}`;
    f.metadata.set(`${ROOT}${area}`, rel === "acl" ? { acl: target } : { describedby: [target] });
    await refused(f, target);
  });

  it.each([
    "POLICIES/Agent-Rules.ttl",
    "policies/%61gent-rules.ttl",
    "policies/%2561gent-rules.ttl",
    "policies/ignored/../agent-rules.ttl",
    "policies/agent-rules.ttl/",
    "policies/agent-rules.ttl?raw#view",
    "policies;p/agent-rules.ttl",
  ])("refuses normalized target alias %s", async (path) => {
    const f = fixture(adapter);
    f.metadata.set(`${ROOT}agent/`, { acl: `${ROOT}policies/agent-rules.ttl` });
    await refused(f, `${ROOT}${path}`);
  });

  it("normalizes the advertised URL as well as the mutation target", async () => {
    const f = fixture(adapter);
    f.metadata.set(`${ROOT}agent/`, { acl: `${ROOT}POLICIES/%2561GENT-RULES.TTL/` });
    await refused(f, `${ROOT}policies/agent-rules.ttl`);
  });

  it("fetches shared ancestors once per mutation and never consults an unrelated sibling's ACL", async () => {
    const f = fixture(adapter);
    const sibling = `${ROOT}public/`;
    const acl = `${ROOT}policies/public-rules.ttl`;
    f.metadata.set(sibling, { acl });
    await f.output.write(acl, BODY, "text/plain", { ifNoneMatch: "*" });
    expect(f.write).toHaveBeenCalledOnce();
    expect(f.head.mock.calls.map(([url]) => url).sort()).toEqual(TARGETS);
    f.head.mockClear();
    await f.output.delete(acl, { ifMatch: '"new"' });
    expect(f.remove).toHaveBeenCalledOnce();
    expect(f.head.mock.calls.map(([url]) => url).sort()).toEqual(TARGETS);
  });

  it("rechecks associations on the same output object and leaves reads unchanged", async () => {
    const f = fixture(adapter);
    await f.output.write(SAFE, BODY, "text/plain", {});
    f.write.mockClear();
    f.fetch.mockClear();
    f.head.mockClear();
    f.metadata.set(`${ROOT}agent/`, { acl: SAFE });
    await refused(f, SAFE);
    expect(f.head.mock.calls.filter(([url]) => url === ROOT)).toHaveLength(2);
    f.head.mockClear();
    expect((await f.output.read(SAFE)).body).toEqual(BODY);
    expect(f.head).not.toHaveBeenCalled();
  });

  it.each([
    "https://elsewhere.example/policy",
    "https://example.org/other/policy",
    `${ROOT}%252e%252e/outside`,
  ])("fails closed on association outside the pod: %s", async (acl) => {
    const f = fixture(adapter);
    f.metadata.set(`${ROOT}agent/`, { acl });
    await refused(f, SAFE);
  });

  it("fails closed on any off-pod describedby, even alongside a safe ACL", async () => {
    const f = fixture(adapter);
    f.metadata.set(`${ROOT}private/pkg/`, {
      acl: `${ROOT}private/pkg/.acl`,
      describedby: [`${ROOT}meta/one`, "https://elsewhere.example/meta"],
    });
    await refused(f, SAFE);
  });

  it.each(TARGETS)("fails closed if required HEAD %s fails", async (target) => {
    const f = fixture(adapter);
    f.head.mockImplementation(async (url) => {
      if (url === target) throw new Error("private backend network failure");
      return { acl: `${url}.acl` };
    });
    await refused(f, SAFE);
  });

  it("does not discover metadata for an already-refused protected target", async () => {
    const f = fixture(adapter);
    await refused(f, `${ROOT}agent/context/shared-context.md`);
    expect(f.head).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when HEAD supplies no auxiliary associations", async () => {
    const f = fixture(adapter);
    f.head.mockResolvedValue({});
    await refused(f, SAFE);
  });

  it("collects every describedby association", async () => {
    const f = fixture(adapter);
    f.metadata.set(`${ROOT}private/pkg/`, {
      describedby: [`${ROOT}meta/one`, `${ROOT}meta/two`],
    });
    await refused(f, `${ROOT}meta/two`);
  });

  it("protects root associations with a host-root pod and an off-pod WebID", async () => {
    const root = "https://example.org/";
    const f = fixture(adapter, root, "https://identity.example/card#me");
    f.metadata.set(root, { acl: `${root}root-policy` });
    await refused(f, `${root}root-policy`);
    expect(f.head.mock.calls.some(([url]) => url.includes("profile"))).toBe(false);
  });
});

it("refuses mutations without HEAD but still allows ordinary generic reads", async () => {
  const f = fixture("portable");
  delete f.pod.head;
  await refused(f, SAFE);
  expect((await f.output.read(SAFE)).body).toEqual(BODY);
});

it.each([
  { status: 200, link: "" },
  { status: 404, link: "" },
  { status: 500, link: '<policy>; rel="acl"' },
  { status: 403, link: '<policy>; rel="acl"' },
  { status: 302, link: '<policy>; rel="acl"' },
  { status: 200, link: '<one>; rel="acl", <two>; rel="acl"' },
  { status: 404, link: '<one>; rel="acl", <one>; rel="acl"' },
  { status: 200, link: '<one>; rel="acl", malformed' },
  { status: 200, link: '<http://[>; rel="alternate"' },
  { status: 200, link: '<invalid uri>; rel="alternate"' },
  { status: 200, link: '<>; rel="acl"' },
  { status: 200, link: '<one>; rel="acl",' },
  { status: 200, link: '<one>; rel="acl"; rel="alternate"' },
  { status: 200, link: '<one>; rel="describedby"; anchor="other"' },
  { status: 200, link: '<one>; rel="http://www.w3.org/ns/solid/acp#accessControl"' },
])("refuses unsafe HEAD response $status $link", async ({ status, link }) => {
  const f = fixture("fetch");
  f.fetch.mockImplementation(async () => new Response(null, { status, headers: { link } }));
  await refused(f, SAFE);
});

it("fails closed when an otherwise-successful HEAD reports a different final URL", async () => {
  const f = fixture("fetch");
  f.fetch.mockImplementation(async () => {
    const response = new Response(null, { headers: { link: '<policy>; rel="acl"' } });
    Object.defineProperty(response, "url", { value: `${ROOT}other` });
    return response;
  });
  await refused(f, SAFE);
});

it("fails closed on a stalled HEAD without sending a mutation", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture("portable");
    f.head.mockImplementation(() => new Promise(() => {}));
    const denied = expect(f.output.write(SAFE, BODY, "text/plain", {})).rejects.toThrow(
      PERSONAL_DATA_DENIED,
    );
    await vi.advanceTimersByTimeAsync(5000);
    await denied;
    expect(f.write).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  "url",
  "redirect",
])("checks a mutation's final %s alias against discovery", async (kind) => {
  const f = fixture("fetch");
  const target = `${ROOT}policies/agent-rules.ttl`;
  f.metadata.set(`${ROOT}agent/`, { acl: target });
  const original = f.fetch.getMockImplementation();
  f.fetch.mockImplementation(async (input, init) => {
    if (new Request(input, init).method !== "PUT")
      return original?.(input, init) as Promise<Response>;
    const alias = `${ROOT}POLICIES/%61gent-rules.ttl`;
    const response = new Response(null, {
      status: kind === "redirect" ? 307 : 201,
      headers: kind === "redirect" ? { location: alias } : {},
    });
    if (kind === "url") Object.defineProperty(response, "url", { value: alias });
    return response;
  });
  await expect(f.output.write(SAFE, BODY, "text/plain", {})).rejects.toThrow(PERSONAL_DATA_DENIED);
  expect(
    f.fetch.mock.calls.filter(([input, init]) => new Request(input, init).method === "PUT"),
  ).toHaveLength(1);
  expect(f.fetch.mock.calls.some(([input]) => String(input) === target)).toBe(false);
});
