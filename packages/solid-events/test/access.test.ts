// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Sonnet 5.5
import { readFileSync } from "node:fs";
import {
  type AccessClient,
  checkOwnerOnly,
  createAccessClient,
  type EffectivePolicy,
  readWac,
} from "@jeswr/pod-access";
import { ensurePrivateContainerAccess, setGrants } from "@jeswr/pod-access/roles";
import type { StorageClient } from "@jeswr/storage-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeReplies,
  publishAccess,
  revokeAccess,
  sealNewResource,
  withdrawReplyRead,
} from "../src/access.js";
import { EVENT_STATUS, type EventData, type InviteeData } from "../src/model.js";
import { OWNER, pod, ROOT, session } from "./pod.js";

vi.mock("@jeswr/pod-access", async (original) => {
  const module = await original<typeof import("@jeswr/pod-access")>();
  return { ...module, createAccessClient: vi.fn(module.createAccessClient) };
});
vi.mock("@jeswr/pod-access/roles", async (original) => {
  const module = await original<typeof import("@jeswr/pod-access/roles")>();
  return {
    ...module,
    setGrants: vi.fn(module.setGrants),
    ensurePrivateContainerAccess: vi.fn(module.ensurePrivateContainerAccess),
  };
});
const actual = await vi.importActual<typeof import("@jeswr/pod-access")>("@jeswr/pod-access");
const CLEO = "https://cleo.example/me";
const TAVI = "https://tavi.example/me";
const folder = `${ROOT}events/e/`;
const eventUrl = `${folder}index.ttl`;
const replies = `${folder}rsvps/`;
const baseEvent = (over: Partial<EventData> = {}): EventData => ({
  name: "Supper",
  startDate: new Date("2027-01-01"),
  created: new Date(),
  modified: new Date(),
  organizer: OWNER,
  eventStatus: EVENT_STATUS.scheduled,
  visibility: "link",
  guestListVisible: false,
  publication: "published",
  ...over,
});
const invitee = (webId: string): InviteeData => ({
  webId,
  event: `${eventUrl}#it`,
  invitedAt: new Date(),
});
beforeEach(() => {
  vi.mocked(createAccessClient).mockReset();
  vi.mocked(createAccessClient).mockImplementation(actual.createAccessClient);
  vi.mocked(setGrants).mockClear();
  vi.mocked(ensurePrivateContainerAccess).mockClear();
});

/** events/e/{,index.ttl,rsvps/}, each sealed through pod-access exactly as the repository does. */
async function layout() {
  const p = pod();
  const { storage, fetch } = p;
  const s = session(fetch);
  await storage.create(ROOT, null, { kind: "container", name: "events" });
  await sealNewResource(storage, s, `${ROOT}events/`, { created: true });
  await storage.create(`${ROOT}events/`, null, { kind: "container", name: "e" });
  await sealNewResource(storage, s, folder, { created: true });
  await storage.create(folder, null, { kind: "container", name: "rsvps" });
  await sealNewResource(storage, s, replies, { created: true });
  await storage.create(folder, "", { name: "index.ttl", contentType: "text/turtle" });
  await sealNewResource(storage, s, eventUrl, { created: true });
  return { ...p, s };
}
async function policyOf(storage: StorageClient, url: string): Promise<EffectivePolicy> {
  const acl = `${url}.acl`;
  return readWac((await storage.readRdf(acl)).dataset, url, acl, "css", true);
}
const modesFor = (policy: EffectivePolicy, pick: (kind: string, webId?: string) => boolean) =>
  new Set(
    policy.grants
      .filter((g) => g.who.some((c) => c.some((s) => pick(s.kind, "webId" in s ? s.webId : ""))))
      .flatMap((g) => [...g.modes]),
  );
const publicModes = (policy: EffectivePolicy) =>
  modesFor(policy, (kind) => kind === "public" || kind === "authenticated");

describe("sealing goes through pod-access", () => {
  it("seals a container it created and verifies it owner-only", async () => {
    const { storage, fetch, writes } = pod();
    const container = (await storage.create(ROOT, null, { kind: "container", name: "events" })).url;
    await sealNewResource(storage, session(fetch), container, { created: true });
    expect(ensurePrivateContainerAccess).toHaveBeenCalledWith(
      expect.objectContaining({ webId: OWNER, storageUrl: ROOT }),
      container,
      expect.objectContaining({ created: true, storage }),
    );
    expect(writes.map((w) => w.url)).toEqual([`${container}.acl`]);
    expect(await checkOwnerOnly({ storage, url: container, ownerWebId: OWNER })).toEqual({
      private: true,
    });
  });
  it("gives a document it created its own owner-only policy, without inheritance", async () => {
    const { storage, fetch } = pod();
    await storage.create(ROOT, "", { name: "doc.ttl", contentType: "text/turtle" });
    await sealNewResource(storage, session(fetch), `${ROOT}doc.ttl`, { created: true });
    expect(setGrants).toHaveBeenCalledWith(
      [`${ROOT}doc.ttl`],
      [expect.objectContaining({ agent: { type: "webid", id: OWNER }, role: "manager" })],
      expect.objectContaining({ kind: "resource", ownOnly: true, webId: OWNER }),
    );
    const policy = await policyOf(storage, `${ROOT}doc.ttl`);
    expect(policy.grants).toHaveLength(1);
    expect(policy.grants[0]?.appliesTo).toBe("resource");
    expect(await checkOwnerOnly({ storage, url: `${ROOT}doc.ttl`, ownerWebId: OWNER })).toEqual({
      private: true,
    });
  });
  it("only verifies what it did not create, never rewriting another application's policy", async () => {
    const { storage, fetch, writes } = await layout();
    const before = await (await storage.read(`${replies}.acl`)).text();
    writes.length = 0;
    vi.mocked(setGrants).mockClear();
    await sealNewResource(storage, session(fetch), replies, { created: false });
    await sealNewResource(storage, session(fetch), eventUrl, { created: false });
    expect(setGrants).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(await (await storage.read(`${replies}.acl`)).text()).toBe(before);
  });
  it.each([
    ["container", replies],
    ["document", eventUrl],
  ])("refuses an existing %s with a public rule and leaves it unchanged", async (_kind, target) => {
    const { storage, fetch } = await layout();
    await createAccessClient({ storage }).share(
      target,
      { agent: { public: true }, modes: ["read"] },
      {},
    );
    const before = await (await storage.read(`${target}.acl`)).text();
    await expect(
      sealNewResource(storage, session(fetch), target, { created: false }),
    ).rejects.toThrow("owner-only");
    expect(await (await storage.read(`${target}.acl`)).text()).toBe(before);
  });
  it("refuses an unreadable policy rather than assuming privacy", async () => {
    const { storage, fetch } = await layout();
    const acl = `${replies}.acl`;
    const read = await storage.read(acl);
    await storage.write(
      acl,
      `${await read.text()}\n<#hostile> <http://www.w3.org/ns/auth/acl#futurePredicate> <${CLEO}> .`,
      { ifMatch: read.etag ?? "missing", contentType: "text/turtle" },
    );
    await expect(
      sealNewResource(storage, session(fetch), replies, { created: false }),
    ).rejects.toThrow("owner-only");
  });
  it.each([
    "container",
    "document",
  ])("fails closed when the %s policy cannot be written", async (kind) => {
    const { storage } = pod();
    const target = (
      kind === "container"
        ? await storage.create(ROOT, null, { kind: "container", name: "sealed" })
        : await storage.create(ROOT, "", { name: "doc.ttl", contentType: "text/turtle" })
    ).url;
    const denied = vi.fn(async () => new Response(null, { status: 403 }));
    await expect(
      sealNewResource(storage, session(denied), target, { created: true }),
    ).rejects.toThrow(/Couldn't protect the invitation storage|isn't owner-only/);
  });
  it.each(["unknown", "acp"])("refuses %s access control without any request", async (model) => {
    const { storage } = pod();
    storage.features.accessControl =
      model === "unknown"
        ? { state: "unknown", evidence: "fixture", detail: { model: "none" } }
        : { state: "available", evidence: "fixture", detail: { model: "acp" } };
    const fetch = vi.fn();
    await expect(
      sealNewResource(storage, session(fetch), `${ROOT}x/`, { created: true }),
    ).rejects.toThrow("WAC");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never writes an access document itself", () => {
    for (const file of ["access.ts", "repository.ts"]) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/writeWac|writeAcp|\$\{[^}]*\}\.(acl|acr)/);
    }
  });
});

describe("publishAccess never gives the public Read on RSVPs", () => {
  const cases = [
    ...(["link", "invitees"] as const).flatMap((visibility) =>
      [true, false].flatMap((guestListVisible) =>
        [EVENT_STATUS.scheduled, EVENT_STATUS.cancelled, EVENT_STATUS.postponed].map(
          (eventStatus) => ({ visibility, guestListVisible, eventStatus }),
        ),
      ),
    ),
  ];
  it.each(cases)("%o", async ({ visibility, guestListVisible, eventStatus }) => {
    const { storage } = await layout();
    const event = baseEvent({ visibility, guestListVisible, eventStatus });
    await publishAccess(storage, eventUrl, event, [invitee(CLEO), invitee(TAVI)]);
    const container = await policyOf(storage, replies);
    // Whoever holds the link: Append at most, never Read on the container or its replies.
    expect([...publicModes(container)].filter((mode) => mode !== "append")).toEqual([]);
    expect(publicModes(container).has("append")).toBe(
      visibility === "link" && eventStatus === EVENT_STATUS.scheduled,
    );
    // Named readers exist only for an invitee-only, visible list.
    const named = modesFor(container, (kind, webId) => kind === "agent" && webId === CLEO);
    expect(named.has("read")).toBe(visibility === "invitees" && guestListVisible);
    expect(named.has("write") || named.has("control")).toBe(false);
    // The raw replies are never granted through the invitation document either.
    const invitation = await policyOf(storage, eventUrl);
    expect(publicModes(invitation).has("read")).toBe(visibility === "link");
    // A reply written later inherits only the container's default rule, which has no public Read.
    for (const grant of container.grants)
      if (grant.who.some((c) => c.some((s) => s.kind === "public")))
        expect([...grant.modes]).toEqual(["append"]);
  });
  it("applies Read to named invitees only through an inherited rule on replies", async () => {
    const { storage } = await layout();
    await publishAccess(
      storage,
      eventUrl,
      baseEvent({ visibility: "invitees", guestListVisible: true }),
      [invitee(CLEO)],
    );
    const container = await policyOf(storage, replies);
    const grant = container.grants.find((g) =>
      g.who.some((c) =>
        c.some((s) => s.kind === "agent" && s.webId === CLEO && g.modes.has("read")),
      ),
    );
    expect(grant?.appliesTo).toBe("both");
  });
  it("skips the organiser and WebID-less invitees", async () => {
    const { storage } = await layout();
    await publishAccess(storage, eventUrl, baseEvent({ visibility: "invitees" }), [
      invitee(OWNER),
      { displayName: "Cleo", event: `${eventUrl}#it`, invitedAt: new Date() },
    ]);
    expect((await policyOf(storage, eventUrl)).grants).toHaveLength(1);
  });
  it("requires WAC", async () => {
    const { storage } = await layout();
    vi.mocked(createAccessClient).mockReturnValue({ model: () => "acp" } as AccessClient);
    await expect(publishAccess(storage, eventUrl, baseEvent(), [])).rejects.toThrow("WAC");
    await expect(revokeAccess(storage, eventUrl, baseEvent(), [])).rejects.toThrow("WAC");
    await expect(withdrawReplyRead(storage, eventUrl, baseEvent())).rejects.toThrow("WAC");
    await expect(closeReplies(storage, eventUrl, OWNER)).rejects.toThrow("WAC");
  });
  describe("fails closed when the container is readable beyond its audience", () => {
    const seed: [string, (a: AccessClient) => Promise<unknown>, Partial<EventData>][] = [
      [
        "public Read",
        (a) => a.share(replies, { agent: { public: true }, modes: ["read"] }, { inherit: true }),
        {},
      ],
      [
        "authenticated Read",
        (a) => a.share(replies, { agent: { authenticated: true }, modes: ["read"] }, {}),
        {},
      ],
      [
        "public Write",
        (a) => a.share(replies, { agent: { public: true }, modes: ["write"] }, {}),
        {},
      ],
      [
        "a group",
        (a) => a.share(replies, { agent: { group: `${ROOT}g#team` }, modes: ["read"] }, {}),
        {
          visibility: "invitees",
          guestListVisible: true,
        },
      ],
      [
        "a stranger's Read",
        (a) => a.share(replies, { agent: "https://stranger.example/me", modes: ["read"] }, {}),
        { visibility: "invitees", guestListVisible: true },
      ],
      [
        "an invitee's Read when the list is hidden",
        (a) => a.share(replies, { agent: CLEO, modes: ["read"] }, {}),
        { visibility: "invitees" },
      ],
      [
        "an invitee's Write",
        (a) => a.share(replies, { agent: CLEO, modes: ["read", "write"] }, {}),
        { visibility: "invitees", guestListVisible: true },
      ],
    ];
    it.each(seed)("%s", async (_name, share, over) => {
      const { storage } = await layout();
      await share(createAccessClient({ storage }));
      await expect(
        publishAccess(storage, eventUrl, baseEvent(over), [invitee(CLEO)]),
      ).rejects.toThrow("beyond its intended audience");
    });
  });
});

describe("revokeAccess", () => {
  it("withdraws every grant for the audience and confirms by re-reading", async () => {
    const { storage } = await layout();
    for (const [visibility, who] of [
      ["link", undefined],
      ["invitees", CLEO],
    ] as const) {
      const event = baseEvent({ visibility, guestListVisible: visibility === "invitees" });
      await publishAccess(storage, eventUrl, event, [invitee(CLEO)]);
      await revokeAccess(storage, eventUrl, event, [invitee(CLEO)]);
      for (const url of [eventUrl, replies]) {
        const policy = await policyOf(storage, url);
        expect(publicModes(policy).size).toBe(0);
        expect(modesFor(policy, (kind, webId) => kind === "agent" && webId === who).size).toBe(0);
        expect(
          modesFor(policy, (kind, webId) => kind === "agent" && webId === OWNER).has("control"),
        ).toBe(true);
      }
    }
  });
  it("tolerates a rule that was never granted", async () => {
    const { storage } = await layout();
    await revokeAccess(storage, eventUrl, baseEvent(), []);
    await revokeAccess(storage, eventUrl, baseEvent({ visibility: "invitees" }), [invitee(CLEO)]);
  });
  it("throws when it cannot confirm the withdrawal", async () => {
    const { storage } = await layout();
    await publishAccess(storage, eventUrl, baseEvent(), []);
    const write = storage.write.bind(storage);
    storage.write = async (url, ...rest) => {
      if (url.endsWith(".acl")) throw new Error("offline");
      return write(url, ...rest);
    };
    await expect(revokeAccess(storage, eventUrl, baseEvent(), [])).rejects.toThrow("confirm");
  });
});

describe("withdrawReplyRead repairs an earlier public guest list", () => {
  async function legacy(modes: ("append" | "read")[][], over: Partial<EventData> = {}) {
    const { storage } = await layout();
    const access = createAccessClient({ storage });
    for (const m of modes)
      await access.share(
        replies,
        { agent: { public: true }, modes: m },
        { inherit: m.includes("read") },
      );
    await access.share(replies, { agent: CLEO, modes: ["read"] }, { inherit: true });
    return { storage, access, event: baseEvent(over) };
  }
  const namedRead = (policy: EffectivePolicy, webId: string) =>
    modesFor(policy, (kind, id) => kind === "agent" && id === webId).has("read");
  it("removes public Read, keeps public Append and never touches a named reader", async () => {
    const { storage, event } = await legacy([["append"], ["read"]]);
    await withdrawReplyRead(storage, eventUrl, event);
    const policy = await policyOf(storage, replies);
    expect([...publicModes(policy)]).toEqual(["append"]);
    expect(namedRead(policy, CLEO)).toBe(true);
    // The organiser's own access is untouched too.
    expect(modesFor(policy, (kind, id) => kind === "agent" && id === OWNER).has("control")).toBe(
      true,
    );
  });
  it("keeps named readers for an invitee list as well", async () => {
    const { storage, event } = await legacy([["append"], ["read"]], {
      visibility: "invitees",
      guestListVisible: true,
    });
    await withdrawReplyRead(storage, eventUrl, event);
    const policy = await policyOf(storage, replies);
    expect([...publicModes(policy)]).toEqual(["append"]);
    expect(namedRead(policy, CLEO)).toBe(true);
  });
  it("re-issues a mixed Append+Read rule as Append only while replies are open", async () => {
    const { storage, event } = await legacy([["append", "read"]]);
    await withdrawReplyRead(storage, eventUrl, event);
    expect([...publicModes(await policyOf(storage, replies))]).toEqual(["append"]);
  });
  it("does not re-open replies for a closed event", async () => {
    const { storage, event } = await legacy([["append", "read"]], {
      eventStatus: EVENT_STATUS.cancelled,
    });
    await withdrawReplyRead(storage, eventUrl, event);
    expect(publicModes(await policyOf(storage, replies)).size).toBe(0);
  });
  it("refuses, changing nothing, when a public Read rule also covers the organiser or another agent", async () => {
    const { storage } = await layout();
    const revoke = vi.fn();
    const share = vi.fn();
    const grants = vi.fn();
    vi.mocked(createAccessClient).mockReturnValue({
      model: () => "wac",
      grants,
      revoke,
      share,
    } as unknown as AccessClient);
    for (const other of [OWNER, CLEO]) {
      grants.mockResolvedValue([
        { id: "#shared", agent: { public: true }, modes: ["read"] },
        { id: "#shared", agent: other, modes: ["read", "control"] },
      ]);
      await expect(withdrawReplyRead(storage, eventUrl, baseEvent())).rejects.toThrow(
        /shared with the owner or another agent/,
      );
    }
    expect(revoke).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });
  it("refuses to guess at rules it cannot identify, and fails when Read cannot be confirmed gone", async () => {
    const { storage } = await layout();
    const grants = vi.fn();
    vi.mocked(createAccessClient).mockReturnValue({
      model: () => "wac",
      grants,
      revoke: vi.fn(),
      share: vi.fn(),
    } as unknown as AccessClient);
    grants.mockResolvedValue([{ agent: { public: true }, modes: ["read"] }]);
    await expect(withdrawReplyRead(storage, eventUrl, baseEvent())).rejects.toThrow("identify");
    grants.mockResolvedValue([{ id: "#r", agent: { public: true }, modes: ["read"] }]);
    await expect(withdrawReplyRead(storage, eventUrl, baseEvent())).rejects.toThrow("confirm");
  });
  it("is a no-op, with no writes, when only named agents or the owner hold access", async () => {
    const { storage, writes } = await layout();
    await createAccessClient({ storage }).share(
      replies,
      { agent: CLEO, modes: ["read", "write"] },
      { inherit: true },
    );
    writes.length = 0;
    await withdrawReplyRead(storage, eventUrl, baseEvent());
    expect(writes).toEqual([]);
    expect(namedRead(await policyOf(storage, replies), CLEO)).toBe(true);
  });
  it("leaves a clean container alone", async () => {
    const { storage, writes } = await layout();
    writes.length = 0;
    await withdrawReplyRead(storage, eventUrl, baseEvent());
    expect(writes).toEqual([]);
  });
});

function accessFixture() {
  const access = {
    model: vi.fn().mockReturnValue("wac"),
    share: vi.fn().mockResolvedValue({}),
    grants: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(createAccessClient).mockReturnValue(access as unknown as AccessClient);
  return access;
}
const acl = `${replies}.acl`;
describe("closeReplies", () => {
  it("revokes Append by rule id and refuses unidentifiable grants before touching any rule", async () => {
    const { storage } = pod();
    const access = accessFixture();
    access.grants.mockResolvedValue([
      { id: `${acl}#append`, agent: { public: true }, modes: ["append"] },
      { id: `${acl}#read`, agent: { public: true }, modes: ["read"] },
      { id: `${acl}#owner`, agent: OWNER, modes: ["read", "write", "control", "append"] },
      { agent: OWNER, modes: ["append"] },
      { id: `${acl}#shared-owner`, agent: OWNER, modes: ["append", "write"] },
    ]);
    await closeReplies(storage, eventUrl, OWNER);
    expect(access.revoke.mock.calls).toEqual([[replies, `${acl}#append`]]);
    access.revoke.mockClear();
    access.grants.mockResolvedValue([{ agent: { public: true }, modes: ["append"] }]);
    await expect(closeReplies(storage, eventUrl, OWNER)).rejects.toThrow("identify");
    expect(access.revoke).not.toHaveBeenCalled();
  });
  it("refuses mixed non-owner Append rules before revoking any grant", async () => {
    const { storage } = pod();
    const access = accessFixture();
    for (const agent of [{ public: true }, CLEO]) {
      access.grants.mockResolvedValue([
        { id: `${acl}#append`, agent: { public: true }, modes: ["append"] },
        { id: `${acl}#mixed`, agent, modes: ["append", "read"] },
      ]);
      await expect(closeReplies(storage, eventUrl, OWNER)).rejects.toThrow("mixed");
      expect(access.revoke).not.toHaveBeenCalled();
    }
  });
  it("refuses Append rules shared with the owner before revoking any grant", async () => {
    const { storage } = pod();
    const access = accessFixture();
    for (const modes of [["append"], ["append", "read"]]) {
      access.grants.mockResolvedValue([
        { id: `${acl}#append`, agent: { public: true }, modes: ["append"] },
        { id: `${acl}#shared`, agent: OWNER, modes },
        { id: `${acl}#shared`, agent: { public: true }, modes },
      ]);
      await expect(closeReplies(storage, eventUrl, OWNER)).rejects.toThrow(/mixed|shared/);
      expect(access.revoke).not.toHaveBeenCalled();
    }
  });
});
