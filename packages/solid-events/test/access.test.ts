// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { createAccessClient, type EffectivePolicy, readWac } from "@jeswr/pod-access";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, expect, it, vi } from "vitest";
import { closeReplies, publishAccess, sealNewResource } from "../src/access.js";
import { EVENT_STATUS, type EventData } from "../src/model.js";

vi.mock("@jeswr/pod-access", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-access")>()),
  createAccessClient: vi.fn(),
  readWac: vi.fn(),
}));
const root = "https://pod.example/";
const owner = `${root}profile#me`;
const target = `${root}event/`;
const acl = `${target}.acl`;
const policy = (): EffectivePolicy => ({
  denials: [],
  grants: [
    {
      modes: new Set(["read", "write", "control"]),
      who: [[{ kind: "agent", webId: owner }]],
      except: [],
      appliesTo: "both",
      source: { url: acl, node: `${acl}#owner` },
    },
  ],
});
const event: EventData = {
  name: "Supper",
  startDate: new Date("2027-01-01"),
  created: new Date(),
  modified: new Date(),
  organizer: owner,
  eventStatus: EVENT_STATUS.scheduled,
  visibility: "link",
  guestListVisible: false,
  publication: "published",
};
async function fixture() {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  storage.features.accessControl = {
    state: "available",
    evidence: "fixture",
    detail: { model: "wac" },
  };
  await storage.create(root, null, { kind: "container", name: "event" });
  const real = await storage.head(target);
  const head = { ...real, allow: null, links: new Map([["acl", [{ target: acl, params: {} }]]]) };
  storage.head = vi.fn().mockResolvedValue(head);
  return { storage, head };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readWac).mockReturnValue(policy());
});
it("bootstraps only a missing own ACL, with owner defaults for containers and no defaults for files", async () => {
  const { storage, head } = await fixture();
  const fetch = vi
    .fn()
    .mockImplementation(
      async (_url, init) => new Response(null, { status: init?.method === "PUT" ? 201 : 404 }),
    );
  await sealNewResource(storage, fetch, target, owner);
  let body = fetch.mock.calls[1]?.[1].body as string;
  const { readWac: realRead } =
    await vi.importActual<typeof import("@jeswr/pod-access")>("@jeswr/pod-access");
  expect(realRead(await parseRdf(body, "text/turtle"), target, acl).grants[0]?.appliesTo).toBe(
    "both",
  );
  expect(fetch.mock.calls[1]?.[1].headers).toMatchObject({ "if-none-match": "*" });
  head.allow = { control: true } as never;
  fetch.mockClear();
  await sealNewResource(storage, fetch, `${target}index.ttl`, owner);
  body = fetch.mock.calls[1]?.[1].body as string;
  expect(
    realRead(await parseRdf(body, "text/turtle"), `${target}index.ttl`, acl).grants[0]?.appliesTo,
  ).toBe("resource");
});
it.each(["unknown", "acp"])("refuses %s access without fetching", async (model) => {
  const { storage } = await fixture();
  if (model === "unknown")
    storage.features.accessControl = {
      state: "unknown",
      evidence: "fixture",
      detail: { model: "none" },
    };
  else
    storage.features.accessControl = {
      state: "available",
      evidence: "fixture",
      detail: { model: "acp" },
    };
  const fetch = vi.fn();
  await expect(sealNewResource(storage, fetch, target, owner)).rejects.toThrow("WAC");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects lack of Control and absent, empty, multiple, ACP or off-pod links before I/O", async () => {
  const { storage, head } = await fixture();
  const fetch = vi.fn();
  head.allow = { control: false } as never;
  await expect(sealNewResource(storage, fetch, target, owner)).rejects.toThrow("Control");
  head.allow = null;
  for (const links of [
    new Map(),
    new Map([["acl", []]]),
    new Map([
      [
        "acl",
        [
          { target: acl, params: {} },
          { target: acl, params: {} },
        ],
      ],
    ]),
    new Map([
      ["acl", [{ target: acl, params: {} }]],
      ["http://www.w3.org/ns/solid/acp#accessControl", []],
    ]),
  ]) {
    head.links = links;
    await expect(sealNewResource(storage, fetch, target, owner)).rejects.toThrow("unambiguous");
  }
  head.links = new Map([["acl", new Array(1) as never]]);
  await expect(sealNewResource(storage, fetch, target, owner)).rejects.toThrow();
  head.links = new Map([["acl", [{ target: "https://other.example/policy", params: {} }]]]);
  await expect(sealNewResource(storage, fetch, target, owner)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("inspects existing owner access fail closed and never replaces it", async () => {
  const { storage } = await fixture();
  const fetch = vi
    .fn()
    .mockImplementation(
      async () => new Response("", { headers: { "content-type": "text/turtle" } }),
    );
  await sealNewResource(storage, fetch, target, owner);
  expect(readWac).toHaveBeenCalledWith(expect.anything(), target, acl, "css", true);
  expect(fetch).toHaveBeenCalledOnce();
  const base = policy();
  const grant = base.grants[0];
  if (!grant) throw new Error("Missing owner policy");
  for (const invalid of [
    { grants: [], denials: [] },
    { ...base, denials: [grant] },
    { ...base, grants: [{ ...grant, who: [[{ kind: "public" }]] }] },
    {
      ...base,
      grants: [{ ...grant, who: [[{ kind: "agent", webId: "https://stranger.example/me" }]] }],
    },
    {
      ...base,
      grants: [
        {
          ...grant,
          who: [
            [
              { kind: "agent", webId: owner },
              { kind: "agent", webId: owner },
            ],
          ],
        },
      ],
    },
  ] as EffectivePolicy[]) {
    vi.mocked(readWac).mockReturnValueOnce(invalid);
    await expect(sealNewResource(storage, fetch, target, owner)).rejects.toThrow("owner-only");
  }
  vi.mocked(readWac).mockImplementationOnce(() => {
    throw new TypeError("unknown WAC construct");
  });
  await expect(sealNewResource(storage, fetch, target, owner)).rejects.toThrow("unknown");
  expect(fetch.mock.calls.every(([, init]) => init?.method !== "PUT")).toBe(true);
});
it("preserves read errors and fails missing-ACL races without overwriting", async () => {
  const { storage } = await fixture();
  await expect(
    sealNewResource(
      storage,
      async () => {
        throw new Error("offline");
      },
      target,
      owner,
    ),
  ).rejects.toThrow();
  await expect(
    sealNewResource(storage, async () => new Response(null, { status: 403 }), target, owner),
  ).rejects.toMatchObject({ status: 403 });
  const fetch = vi
    .fn()
    .mockImplementation(
      async (_url, init) => new Response(null, { status: init?.method === "PUT" ? 412 : 404 }),
    );
  await expect(sealNewResource(storage, fetch, target, owner)).rejects.toThrow("protect");
  expect(fetch.mock.calls).toHaveLength(2);
});
function accessFixture() {
  const access = {
    model: vi.fn().mockReturnValue("wac"),
    share: vi.fn().mockResolvedValue({}),
    grants: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(createAccessClient).mockReturnValue(
    access as unknown as ReturnType<typeof createAccessClient>,
  );
  return access;
}
it("shares with the exact audience, inheritance only for visible Read, and never Append for closed events", async () => {
  const { storage } = await fixture();
  const access = accessFixture();
  for (const status of [EVENT_STATUS.scheduled, EVENT_STATUS.cancelled, EVENT_STATUS.postponed]) {
    access.share.mockClear();
    await publishAccess(
      storage,
      `${target}index.ttl`,
      { ...event, eventStatus: status, visibility: "invitees", guestListVisible: true },
      [
        { webId: owner, event: `${target}index.ttl#it`, invitedAt: new Date() },
        { displayName: "Cleo", event: `${target}index.ttl#it`, invitedAt: new Date() },
      ],
    );
    expect(access.share).toHaveBeenCalledWith(
      `${target}rsvps/`,
      { agent: owner, modes: ["read"] },
      { inherit: true },
    );
    expect(access.share.mock.calls.some(([, grant]) => grant.modes.includes("append"))).toBe(
      status === EVENT_STATUS.scheduled,
    );
  }
  access.share.mockClear();
  await publishAccess(storage, `${target}index.ttl`, event, []);
  expect(access.share.mock.calls).toEqual([
    [`${target}rsvps/`, { agent: { public: true }, modes: ["append"] }, {}],
    [`${target}index.ttl`, { agent: { public: true }, modes: ["read"] }, {}],
  ]);
  access.share.mockClear();
  await publishAccess(storage, `${target}index.ttl`, { ...event, visibility: "invitees" }, []);
  expect(access.share).not.toHaveBeenCalled();
  access.model.mockReturnValue("acp");
  await expect(publishAccess(storage, target, event, [])).rejects.toThrow("WAC");
});
it("revokes Append by rule id and refuses unidentifiable grants before touching any rule", async () => {
  const { storage } = await fixture();
  const access = accessFixture();
  access.grants.mockResolvedValue([
    { id: `${acl}#append`, agent: { public: true }, modes: ["append"] },
    { id: `${acl}#read`, agent: { public: true }, modes: ["read"] },
    { id: `${acl}#owner`, agent: owner, modes: ["write", "control"] },
  ]);
  await closeReplies(storage, `${target}index.ttl`);
  expect(access.revoke.mock.calls).toEqual([[`${target}rsvps/`, `${acl}#append`]]);
  access.revoke.mockClear();
  access.grants.mockResolvedValue([{ agent: { public: true }, modes: ["append"] }]);
  await expect(closeReplies(storage, target)).rejects.toThrow("identify");
  expect(access.revoke).not.toHaveBeenCalled();
  access.model.mockReturnValue("acp");
  await expect(closeReplies(storage, target)).rejects.toThrow("WAC");
});
