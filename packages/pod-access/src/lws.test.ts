// AUTHORED-BY Codex GPT-6.1-Sol
import { type AuthFetch, StorageError } from "@jeswr/storage-client";
import { createLwsBackend } from "@jeswr/storage-client/lws";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type AccessRequest, createAccessClient, type Grant, type RevocationKey } from "./index.js";

const ROOT = "https://storage.example/root/";
const ID = "https://storage.example/";
const BOB = "https://id.example/agent";
const ALICE = "https://id.example/alice";
const PURPOSE = "https://purpose.example/collaboration";
const PUBLIC = "http://xmlns.com/foaf/0.1/Agent";
const CONTEXT = "https://www.w3.org/ns/lws/v1";
const LWS = "https://www.w3.org/ns/lws#";
const MEDIA = "application/lws+json";
const EXPIRES = new Date("2030-06-09T10:00:00Z");

async function setup(identity: (() => string | null) | undefined = () => BOB) {
  const memory = createMemoryStorage({ protocol: "lws", root: ROOT, pageSize: 1 });
  const grants = (await memory.create(ROOT, null, { kind: "container" })).url;
  const requests = (await memory.create(ROOT, null, { kind: "container" })).url;
  const target = (await memory.create(ROOT, "note", { contentType: "text/plain" })).url;
  memory.features.accessControl = {
    state: "available",
    evidence: "fixture",
    detail: { model: "odrl-grants" },
  };
  for (const [key, endpoint] of [
    ["accessGrants", grants],
    ["accessRequests", requests],
  ] as const)
    memory.features[key] = {
      state: "available",
      evidence: "fixture",
      detail: { endpoint, profiles: [`${LWS}AccessProfile`] },
    };
  const storage = {
    ...memory,
    create: vi.fn(memory.create),
    read: vi.fn(memory.read),
    delete: vi.fn(memory.delete),
    head: vi.fn(memory.head),
    listAll: vi.fn(memory.listAll),
  };
  const client = createAccessClient({ storage, storageId: ID, identity });
  const policy = (agent: string = BOB, value: string[] = [target]) => ({
    type: ["AccessPolicy"],
    action: ["read"],
    assignee: agent,
    target: { type: "StorageResource", value },
  });
  const doc = (access: unknown[] = [policy()], type = "AccessGrant") => ({
    "@context": [CONTEXT],
    type: [type],
    storage: ID,
    access,
  });
  const seed = async (body: unknown = doc(), container = grants, contentType = MEDIA) =>
    (await memory.create(container, JSON.stringify(body), { contentType })).url;
  return { memory, storage, client, target, grants, requests, policy, doc, seed };
}
afterEach(() => vi.restoreAllMocks());

describe("LWS access services", () => {
  test("creates, lists and revokes through advertised slashless network service endpoints", async () => {
    const { storage: memory, target } = await setup();
    const grants = `${ROOT}grants`;
    const requests = `${ROOT}requests`;
    memory.features.accessGrants.detail.endpoint = grants;
    memory.features.accessRequests.detail.endpoint = requests;
    const records = new Map<string, { endpoint: string; body: string }>();
    const fetch = vi.fn<AuthFetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      if (method === "POST" && [grants, requests].includes(url)) {
        expect(headers.get("content-type")).toBe(MEDIA);
        const id = `${ROOT}record-${records.size}`;
        records.set(id, { endpoint: url, body: init?.body as string });
        return new Response(null, { status: 201, headers: { location: id, etag: '"record"' } });
      }
      if (method === "GET" && [grants, requests].includes(url))
        return new Response(
          JSON.stringify({
            type: "Container",
            items: [...records].filter(([, r]) => r.endpoint === url).map(([id]) => ({ id })),
          }),
          { headers: { "content-type": MEDIA } },
        );
      const record = records.get(url);
      if (method === "GET" && record)
        return new Response(record.body, { headers: { "content-type": MEDIA, etag: '"record"' } });
      if (method === "DELETE" && record) {
        expect(headers.get("if-match")).toBe('"record"');
        records.delete(url);
        return new Response(null, { status: 204 });
      }
      throw new Error("Unexpected fixture request");
    });
    const storage = createLwsBackend({ root: ROOT, storage: ID, features: memory.features, fetch });
    const client = createAccessClient({ storage, storageId: ID, identity: () => BOB });
    const request = { target, agent: BOB, modes: ["read"] as const };
    const submitted = await client.request(request);
    expect(await client.requests()).toEqual([{ ...request, id: submitted.url }]);
    const shared = await client.share(target, { agent: BOB, modes: ["read"] }, {});
    expect(await client.grants(target)).toEqual([shared]);
    await client.revoke(target, shared.id as string);
    expect(await client.grants(target)).toEqual([]);
    expect(await client.requests()).toEqual([{ ...request, id: submitted.url }]);
    expect(fetch.mock.calls.map(([url, init]) => [init?.method, String(url)])).toEqual([
      ["POST", requests],
      ["GET", requests],
      ["GET", submitted.url],
      ["POST", grants],
      ["GET", grants],
      ["GET", shared.id],
      ["GET", grants],
      ["GET", shared.id],
      ["DELETE", shared.id],
      ["GET", grants],
      ["GET", requests],
      ["GET", submitted.url],
    ]);
  });

  test("request → grant → paginated list → conditional revoke on memory storage", async () => {
    const { client, storage, memory, target, requests, grants } = await setup();
    expect(client.model()).toBe("odrl-grants");
    const req: AccessRequest = {
      target,
      agent: BOB,
      modes: ["read", "append"],
      purpose: PURPOSE,
      expires: EXPIRES,
      inbox: "https://id.example/agent/inbox/",
    };
    const submitted = await client.request(req);
    expect(storage.create).toHaveBeenLastCalledWith(requests, expect.any(String), {
      contentType: MEDIA,
    });
    expect(await client.requests()).toEqual([{ ...req, id: submitted.url }]);
    const shared = await client.share(
      target,
      { agent: BOB, modes: ["read"], purpose: PURPOSE, expires: EXPIRES },
      {},
    );
    expect(storage.create).toHaveBeenLastCalledWith(grants, expect.any(String), {
      contentType: MEDIA,
    });
    const second = await client.share(target, { agent: ALICE, modes: ["write", "delete"] }, {});
    const listed = await client.grants(target);
    expect(listed).toHaveLength(2);
    expect(listed).toEqual(expect.arrayContaining([shared, second]));
    expect(storage.read).toHaveBeenCalledWith(shared.id, { accept: MEDIA });
    const etag = (await memory.read(shared.id as string)).etag;
    await client.revoke(target, shared.id as string);
    expect(storage.delete).toHaveBeenLastCalledWith(shared.id, { ifMatch: etag });
    expect(await client.grants(target)).toEqual([second]);
    expect(await client.requests()).toEqual([{ ...req, id: submitted.url }]);
    expect(storage.head).not.toHaveBeenCalled();
  });
  test("grant JSON bytes match the specification shape with the builder's exact constraints", async () => {
    const { client, storage } = await setup();
    await client.share(
      `${ROOT}projects/`,
      { agent: BOB, modes: ["read"], purpose: PURPOSE, expires: new Date("2026-06-09T10:00:00Z") },
      {},
    );
    expect(storage.create.mock.calls[0]?.[1]).toMatchInlineSnapshot(
      `"{"@context":["https://www.w3.org/ns/lws/v1"],"type":["AccessGrant"],"storage":"https://storage.example/","access":[{"type":["AccessPolicy"],"action":["read"],"assignee":"https://id.example/agent","target":{"type":"StorageResource","value":["https://storage.example/root/projects/"]},"constraint":[{"leftOperand":"purpose","operator":"eq","rightOperand":"https://purpose.example/collaboration"},{"leftOperand":"dateTime","operator":"lteq","rightOperand":"2026-06-09T10:00:00.000Z"}]}]}"`,
    );
  });
  test("maps all actions independently, never adds delete to modify, and deduplicates modes", async () => {
    const { client, target, storage } = await setup();
    const grant = await client.share(
      target,
      { agent: { public: true }, modes: ["write", "append", "delete", "read", "read"] },
      { inherit: false },
    );
    const body = JSON.parse(storage.create.mock.calls[0]?.[1] as string);
    expect(body.access[0]).toEqual({
      type: ["AccessPolicy"],
      action: ["modify", "create", "delete", "read"],
      assignee: PUBLIC,
      target: { type: "StorageResource", value: [target] },
    });
    expect(await client.grants(target)).toEqual([grant]);
    const modify = await client.share(target, { agent: BOB, modes: ["write"] }, {});
    expect(modify.modes).toEqual(["write"]);
  });
  test("snapshots grant, request, selector and expiry before the first await; ignores caller ids", async () => {
    const { client, target } = await setup();
    const expiry = new Date(EXPIRES);
    const value: Grant = {
      agent: { public: true },
      modes: ["read"],
      purpose: PURPOSE,
      expires: expiry,
      id: "https://storage.example/existing",
    };
    const pending = client.share(target, value, {});
    (value.modes as string[]).push("delete");
    value.purpose = "https://other.example/";
    expiry.setUTCFullYear(2099);
    const shared = await pending;
    expect(shared).toMatchObject({ modes: ["read"], purpose: PURPOSE, expires: EXPIRES });
    expect(shared.id).not.toBe(value.id);
    const req: AccessRequest = { ...shared, target };
    const requested = client.request(req);
    req.target = ROOT;
    const result = await requested;
    expect(await client.requests()).toEqual([{ ...shared, target, id: result.url }]);
    const key = { public: true as const };
    const revoked = client.revoke(target, key);
    (key as { public: boolean }).public = false;
    await revoked;
    expect(await client.grants(target)).toEqual([]);
  });
  test("lists independent spec fixtures and matches exact resources without path inheritance", async () => {
    const { client, seed, policy, doc, target } = await setup();
    const p = {
      ...policy(),
      type: [`${LWS}AccessPolicy`],
      action: ["read", "read"],
      target: { type: `${LWS}StorageResource`, value: [target, ROOT] },
      constraint: [
        { leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE },
        { leftOperand: "dateTime", operator: "lteq", rightOperand: "2030-06-09T12:00:00+02:00" },
      ],
    };
    const id = await seed({ ...doc([p, policy(ALICE)]), type: [`${LWS}AccessGrant`] });
    expect(await client.grants(target)).toEqual([
      { id, agent: BOB, modes: ["read"], purpose: PURPOSE, expires: EXPIRES },
      { id, agent: ALICE, modes: ["read"] },
    ]);
    expect(await client.grants(`${target}/child`)).toEqual([]);
  });
  test("supports optional ids and notification inboxes on read", async () => {
    const { client, memory, seed, doc, requests, target } = await setup();
    const id = await seed(doc(undefined, "AccessRequest"), requests);
    await memory.write(
      id,
      JSON.stringify({
        ...doc(undefined, "AccessRequest"),
        id,
        inbox: "https://id.example/inbox/",
      }),
      { ifMatch: (await memory.read(id)).etag as string, contentType: MEDIA },
    );
    expect(await client.requests()).toEqual([
      { id, target, inbox: "https://id.example/inbox/", agent: BOB, modes: ["read"] },
    ]);
  });
  test("requests without an inbox are supported", async () => {
    const { client, target } = await setup();
    const result = await client.request({ target, agent: BOB, modes: ["read"] });
    expect(await client.requests()).toEqual([
      { target, agent: BOB, modes: ["read"], id: result.url },
    ]);
  });
  test("empty constraint arrays list as unconstrained grants and requests and allow revocation", async () => {
    const { client, storage, target, requests, seed, doc, policy } = await setup();
    const access = [{ ...policy(), constraint: [] }];
    const id = await seed(doc(access));
    const requestId = await seed(doc(access, "AccessRequest"), requests);
    expect(await client.grants(target)).toEqual([{ id, agent: BOB, modes: ["read"] }]);
    expect(await client.requests()).toEqual([
      { id: requestId, target, agent: BOB, modes: ["read"] },
    ]);
    expect(await client.effective(target)).toEqual({ me: ["read"], public: [] });
    await client.revoke(target, id);
    expect(storage.delete).toHaveBeenCalledWith(id, { ifMatch: expect.any(String) });
    expect(await client.grants(target)).toEqual([]);
  });
});

describe("type values", () => {
  describe.each(["", LWS])("namespace %j", (namespace) => {
    test.each([
      [true, false],
      [false, true],
      [true, true],
    ])("lists and revokes with singleton envelope=%s and policy=%s", async (singletonEnvelope, singletonPolicy) => {
      const { client, storage, memory, target, requests, seed, doc, policy } = await setup();
      const type = (name: string, singleton: boolean) =>
        singleton ? `${namespace}${name}` : [`${namespace}${name}`];
      const access = [{ ...policy(), type: type("AccessPolicy", singletonPolicy) }];
      const id = await seed({ ...doc(access), type: type("AccessGrant", singletonEnvelope) });
      const requestId = await seed(
        { ...doc(access), type: type("AccessRequest", singletonEnvelope) },
        requests,
      );
      expect(await client.grants(target)).toEqual([{ id, agent: BOB, modes: ["read"] }]);
      expect(await client.requests()).toEqual([
        { id: requestId, target, agent: BOB, modes: ["read"] },
      ]);
      expect(await client.effective(target)).toEqual({ me: ["read"], public: [] });
      const { etag } = await memory.read(id);
      await client.revoke(target, id);
      expect(storage.delete).toHaveBeenCalledExactlyOnceWith(id, { ifMatch: etag });
      expect(await client.grants(target)).toEqual([]);
      expect(await client.requests()).toEqual([
        { id: requestId, target, agent: BOB, modes: ["read"] },
      ]);
    });
  });

  test.each([
    [undefined, "invalid-response"],
    [null, "invalid-response"],
    [1, "invalid-response"],
    [true, "invalid-response"],
    [{}, "invalid-response"],
    [[], "invalid-response"],
    ["", "unsupported"],
    ["Unknown", "unsupported"],
  ])("rejects malformed or unsupported types %j with %s", async (value, code) => {
    for (const field of ["envelope", "policy"]) {
      const { client, storage, target, requests, seed, doc, policy } = await setup();
      const access = field === "policy" ? [{ ...policy(), type: value }] : [policy()];
      await seed({ ...doc(access), ...(field === "envelope" && { type: value }) });
      await seed(
        { ...doc(access, "AccessRequest"), ...(field === "envelope" && { type: value }) },
        requests,
      );
      await expect(client.grants(target)).rejects.toMatchObject({ code });
      await expect(client.requests()).rejects.toMatchObject({ code });
      await expect(client.revoke(target, BOB)).rejects.toMatchObject({ code });
      expect(storage.delete).not.toHaveBeenCalled();
    }
  });
});

describe("effective permissions", () => {
  test("uses only active caller/public grants, excludes purpose conditions, expiry and other callers", async () => {
    vi.spyOn(Date, "now").mockReturnValue(EXPIRES.getTime());
    const { client, target } = await setup();
    await client.share(target, { agent: BOB, modes: ["write"], expires: EXPIRES }, {});
    await client.share(
      target,
      { agent: BOB, modes: ["delete"], expires: new Date(EXPIRES.getTime() - 1) },
      {},
    );
    await client.share(target, { agent: BOB, modes: ["append"], purpose: PURPOSE }, {});
    await client.share(target, { agent: ALICE, modes: ["delete"] }, {});
    await client.share(target, { agent: { public: true }, modes: ["read"] }, {});
    expect(await client.effective(target)).toEqual({ me: ["write", "read"], public: ["read"] });
  });
  test("an empty caller grant set returns empty modes", async () => {
    const { client, target } = await setup();
    expect(await client.effective(target)).toEqual({ me: [], public: [] });
  });
  test.each([
    null,
    undefined,
  ])("unknown identity %s yields null without reading grants", async (caller) => {
    const { storage, target } = await setup();
    const client = createAccessClient({
      storage,
      storageId: ID,
      ...(caller === null && { identity: () => null }),
    });
    expect(await client.effective(target)).toBeNull();
    expect(storage.listAll).not.toHaveBeenCalled();
  });
  test("identity changes during reads discard permissions", async () => {
    const identity = vi.fn().mockReturnValueOnce(BOB).mockReturnValue(ALICE);
    const { client, target } = await setup(identity);
    expect(await client.effective(target)).toBeNull();
  });
});

describe("revocation", () => {
  test.each([
    "agent",
    "public",
    "id",
  ])("revokes by %s and preserves other grants", async (selector) => {
    const { client, target, storage } = await setup();
    const one = await client.share(
      target,
      { agent: selector === "public" ? { public: true } : BOB, modes: ["read"] },
      {},
    );
    const two = await client.share(target, { agent: ALICE, modes: ["write"] }, {});
    await client.revoke(
      target,
      selector === "public" ? { public: true } : selector === "id" ? (one.id as string) : BOB,
    );
    expect(await client.grants(target)).toEqual([two]);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    await client.revoke(target, BOB);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
  test("validates all matching records before deleting a multi-target or mixed-agent envelope", async () => {
    const { client, seed, doc, policy, target, storage } = await setup();
    await seed();
    await seed(doc([policy(BOB, [target, ROOT])]));
    await expect(client.revoke(target, BOB)).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.delete).not.toHaveBeenCalled();
  });
  test.each([
    "id",
    "agent",
    "public",
  ])("refuses %s deletion affecting other resources or co-agents", async (selector) => {
    const { client, seed, doc, policy, target, storage } = await setup();
    const agent = selector === "public" ? PUBLIC : BOB;
    const id = await seed(
      doc(selector === "id" ? [policy(agent, [target, ROOT])] : [policy(agent), policy(ALICE)]),
    );
    await expect(
      client.revoke(
        target,
        selector === "id" ? id : selector === "public" ? { public: true } : BOB,
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.delete).not.toHaveBeenCalled();
  });
  test("does not delete an id whose grant targets another resource", async () => {
    const { client, seed, doc, policy, target, storage } = await setup();
    const id = await seed(doc([policy(BOB, [ROOT])]));
    await client.revoke(target, id);
    expect(storage.delete).not.toHaveBeenCalled();
  });
  test.each([
    null,
    "",
    "  ",
    "*",
    " * ",
  ])("refuses unsafe revocation validator %s", async (etag) => {
    const { client, seed, storage, target, memory } = await setup();
    const id = await seed();
    const read = await memory.read(id);
    storage.read.mockResolvedValue({ ...read, etag });
    await expect(client.revoke(target, id)).rejects.toMatchObject({
      code: "precondition-required",
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });
  test("propagates conflicts without retrying or making later deletes", async () => {
    const { client, seed, storage, target } = await setup();
    await seed();
    await seed();
    const error = new StorageError("conflict", { url: target, method: "DELETE", status: 412 });
    storage.delete.mockRejectedValue(error);
    await expect(client.revoke(target, BOB)).rejects.toBe(error);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});

describe("fail closed before transport", () => {
  test.each(["wac", "acp", "none"] as const)("Solid %s rejects request services", async (model) => {
    const memory = createMemoryStorage();
    memory.features.accessControl.detail.model = model;
    const listAll = vi.spyOn(memory, "listAll");
    const client = createAccessClient({ storage: memory });
    await expect(client.requests()).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      client.request({ target: memory.root, agent: BOB, modes: ["read"] }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(listAll).not.toHaveBeenCalled();
  });
  test.each([
    "model-state",
    "model",
    "feature-state",
    "profile",
    "endpoint",
    "storage-id",
  ])("rejects missing evidence: %s", async (missing) => {
    const { storage, target } = await setup();
    if (missing === "model-state") storage.features.accessControl.state = "unknown";
    if (missing === "model") storage.features.accessControl.detail.model = "wac";
    if (missing === "feature-state") storage.features.accessGrants.state = "unknown";
    if (missing === "profile") storage.features.accessGrants.detail.profiles = [];
    if (missing === "endpoint") delete storage.features.accessGrants.detail.endpoint;
    const client = createAccessClient({
      storage,
      ...(missing !== "storage-id" && { storageId: ID }),
    });
    await expect(client.share(target, { agent: BOB, modes: ["read"] }, {})).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(storage.create).not.toHaveBeenCalled();
  });
  test.each([
    [],
    ["control"],
    ["use"],
    ["__proto__"],
    null,
  ])("refuses unrepresentable modes %j", async (modes) => {
    const { client, target, storage } = await setup();
    await expect(client.share(target, { agent: BOB, modes } as Grant, {})).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(storage.create).not.toHaveBeenCalled();
  });
  test.each([
    null,
    1,
    {},
    { public: false },
    { authenticated: true },
    { group: ALICE },
    { public: true, extra: true },
    PUBLIC,
  ])("refuses unsupported agent %j", async (agent) => {
    const { client, target, storage } = await setup();
    await expect(
      client.share(target, { agent, modes: ["read"] } as Grant, {}),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.create).not.toHaveBeenCalled();
  });
  test.each([
    null,
    1,
    {},
    { public: false },
    { authenticated: true },
    { public: true, extra: true },
  ])("refuses unsupported revoke selector %j", async (key) => {
    const { client, target, storage } = await setup();
    await expect(client.revoke(target, key as RevocationKey)).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(storage.listAll).not.toHaveBeenCalled();
  });
  test.each([
    "relative",
    "urn:agent:a",
    "https://a.example/a b",
    "https://user@a.example/",
    "https://:pass@a.example/",
    "https://a.example/{x}",
  ])("refuses malformed agent without echoing it: %s", async (agent) => {
    const { client, target, storage } = await setup();
    await expect(client.share(target, { agent, modes: ["read"] } as Grant, {})).rejects.toThrow(
      TypeError,
    );
    expect(storage.create).not.toHaveBeenCalled();
  });
  test.each(["target", "service"])("rejects out of scope %s before transport", async (which) => {
    const { client, target, storage } = await setup();
    if (which === "service")
      storage.features.accessGrants.detail.endpoint = "https://foreign.example/grants/";
    await expect(
      client.share(
        which === "target" ? "https://foreign.example/target" : target,
        { agent: BOB, modes: ["read"] },
        {},
      ),
    ).rejects.toMatchObject({ code: "scope", url: ROOT });
    expect(storage.create).not.toHaveBeenCalled();
  });
  test("rejects target fragments and inheritance", async () => {
    const { client, target, storage } = await setup();
    await expect(client.grants(`${target}#fragment`)).rejects.toMatchObject({ code: "scope" });
    await expect(
      client.share(target, { agent: BOB, modes: ["read"] }, { inherit: true }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.create).not.toHaveBeenCalled();
  });
  test.each([
    new Date(NaN),
    new Date("+010000-01-01T00:00:00Z"),
    new Date("-000001-01-01T00:00:00Z"),
    "2030-01-01",
    1,
  ])("rejects invalid expiry %s", async (expires) => {
    const { client, target, storage } = await setup();
    await expect(
      client.request({ target, agent: BOB, modes: ["read"], expires } as AccessRequest),
    ).rejects.toThrow(TypeError);
    expect(storage.create).not.toHaveBeenCalled();
  });
});

// Each fixture is independent of the implementation's encoder.
describe("untrusted service responses", () => {
  const changes: [string, (s: Awaited<ReturnType<typeof setup>>) => unknown, string][] = [
    ["null", () => null, "invalid-response"],
    ["scalar", () => 1, "invalid-response"],
    ["array", () => [], "invalid-response"],
    ["unknown envelope field", (s) => ({ ...s.doc(), extra: true }), "unsupported"],
    [
      "wrong context",
      (s) => ({ ...s.doc(), "@context": ["https://untrusted.example/context"] }),
      "unsupported",
    ],
    [
      "context override",
      (s) => ({ ...s.doc(), "@context": [CONTEXT, { action: "https://evil.example/action" }] }),
      "unsupported",
    ],
    ["context string", (s) => ({ ...s.doc(), "@context": CONTEXT }), "unsupported"],
    ["wrong type", (s) => ({ ...s.doc(), type: ["AccessRequest"] }), "unsupported"],
    ["wrong storage", (s) => ({ ...s.doc(), storage: ROOT }), "invalid-response"],
    ["mismatched id", (s) => ({ ...s.doc(), id: ROOT }), "invalid-response"],
    ["bad inbox", (s) => ({ ...s.doc(), inbox: 1 }), "invalid-response"],
    ["empty access", (s) => s.doc([]), "invalid-response"],
    ["missing access", (s) => ({ ...s.doc(), access: undefined }), "invalid-response"],
    ["extra policy condition", (s) => s.doc([{ ...s.policy(), duty: [] }]), "unsupported"],
    ["empty types", (s) => s.doc([{ ...s.policy(), type: [] }]), "invalid-response"],
    [
      "unknown type",
      (s) => s.doc([{ ...s.policy(), type: ["AccessPolicy", "Unknown"] }]),
      "unsupported",
    ],
    ["bad assignee", (s) => s.doc([{ ...s.policy(), assignee: "relative" }]), "invalid-response"],
    [
      "missing assignee",
      (s) => s.doc([{ ...s.policy(), assignee: undefined }]),
      "invalid-response",
    ],
    ["unknown action", (s) => s.doc([{ ...s.policy(), action: ["use"] }]), "unsupported"],
    ["numeric action", (s) => s.doc([{ ...s.policy(), action: [1] }]), "unsupported"],
    ["prototype action", (s) => s.doc([{ ...s.policy(), action: ["__proto__"] }]), "unsupported"],
    ["missing target", (s) => s.doc([{ ...s.policy(), target: undefined }]), "invalid-response"],
    [
      "unknown target type",
      (s) => s.doc([{ ...s.policy(), target: { type: "Container", value: [s.target] } }]),
      "unsupported",
    ],
    ["empty target", (s) => s.doc([s.policy(BOB, [])]), "invalid-response"],
    ["foreign target", (s) => s.doc([s.policy(BOB, ["https://foreign.example/a"])]), "scope"],
    ["null constraints", (s) => s.doc([{ ...s.policy(), constraint: null }]), "invalid-response"],
    [
      "non-array constraints",
      (s) => s.doc([{ ...s.policy(), constraint: {} }]),
      "invalid-response",
    ],
    [
      "malformed constraint after a valid constraint",
      (s) =>
        s.doc([
          {
            ...s.policy(),
            constraint: [{ leftOperand: "purpose", operator: "eq", rightOperand: PURPOSE }, null],
          },
        ]),
      "invalid-response",
    ],
    [
      "unknown constraint",
      (s) =>
        s.doc([
          {
            ...s.policy(),
            constraint: [{ leftOperand: "client", operator: "eq", rightOperand: ALICE }],
          },
        ]),
      "unsupported",
    ],
    [
      "missing constraint operator",
      (s) =>
        s.doc([{ ...s.policy(), constraint: [{ leftOperand: "purpose", rightOperand: PURPOSE }] }]),
      "unsupported",
    ],
    [
      "unsupported purpose set",
      (s) =>
        s.doc([
          {
            ...s.policy(),
            constraint: [{ leftOperand: "purpose", operator: "isAnyOf", rightOperand: [PURPOSE] }],
          },
        ]),
      "unsupported",
    ],
    [
      "invalid purpose",
      (s) =>
        s.doc([
          {
            ...s.policy(),
            constraint: [{ leftOperand: "purpose", operator: "eq", rightOperand: 1 }],
          },
        ]),
      "invalid-response",
    ],
    [
      "duplicate purpose",
      (s) =>
        s.doc([
          {
            ...s.policy(),
            constraint: Array(2).fill({
              leftOperand: "purpose",
              operator: "eq",
              rightOperand: PURPOSE,
            }),
          },
        ]),
      "unsupported",
    ],
    [
      "duplicate expiry",
      (s) =>
        s.doc([
          {
            ...s.policy(),
            constraint: Array(2).fill({
              leftOperand: "dateTime",
              operator: "lteq",
              rightOperand: EXPIRES.toISOString(),
            }),
          },
        ]),
      "unsupported",
    ],
    [
      "unsupported date operator",
      (s) =>
        s.doc([
          {
            ...s.policy(),
            constraint: [
              { leftOperand: "dateTime", operator: "gteq", rightOperand: EXPIRES.toISOString() },
            ],
          },
        ]),
      "unsupported",
    ],
  ];
  test.each(changes)("refuses %s rather than widening the grant", async (_name, change, code) => {
    const s = await setup();
    await s.seed(change(s));
    await expect(s.client.grants(s.target)).rejects.toMatchObject({ code });
    await expect(s.client.revoke(s.target, BOB)).rejects.toMatchObject({ code });
    expect(s.storage.delete).not.toHaveBeenCalled();
  });
  test.each([
    null,
    "2030-06-09",
    "2030-06-09T10:00:00",
    "2030-99-99T10:00:00Z",
    "2030-02-30T10:00:00Z",
    "2030-06-09T10:00:00+15:00",
    "2030-06-09T10:00:00.0001Z",
  ])("rejects malformed dateTime %s", async (rightOperand) => {
    const { client, seed, doc, policy, target } = await setup();
    await seed(
      doc([
        { ...policy(), constraint: [{ leftOperand: "dateTime", operator: "lteq", rightOperand }] },
      ]),
    );
    await expect(client.grants(target)).rejects.toMatchObject({ code: "invalid-response" });
  });
  test.each([
    "read",
    "create",
    "delete",
  ])("propagates storage %s failures unchanged", async (operation) => {
    const { client, storage, seed, target } = await setup();
    await seed();
    const error = new StorageError("forbidden", { method: "GET", url: target, status: 403 });
    storage[operation as "read" | "create" | "delete"].mockRejectedValue(error);
    const result =
      operation === "create"
        ? client.share(target, { agent: BOB, modes: ["read"] }, {})
        : operation === "delete"
          ? client.revoke(target, BOB)
          : client.grants(target);
    await expect(result).rejects.toBe(error);
  });
  test.each([
    "invalid-json",
    "status",
    "url",
    "media",
    "no-media",
  ])("refuses invalid read response %s", async (invalid) => {
    const { client, seed, storage, memory, target } = await setup();
    const id = await seed();
    const read = await memory.read(id);
    storage.read.mockResolvedValue({
      ...read,
      ...(invalid === "invalid-json" && { text: async () => "{" }),
      ...(invalid === "status" && { status: 304 }),
      ...(invalid === "url" && { url: ROOT }),
      ...(invalid === "media" && { contentType: "application/json" }),
      ...(invalid === "no-media" && { contentType: null }),
    });
    await expect(client.grants(target)).rejects.toMatchObject({ code: "invalid-response" });
  });
  test.each([
    "foreign",
    "container",
    "endpoint",
    "duplicate",
  ])("rejects unsafe listing entry %s", async (bad) => {
    const { client, target, storage, grants } = await setup();
    const entry = {
      url:
        bad === "foreign" ? "https://foreign.example/grant" : bad === "endpoint" ? grants : target,
      kind: bad === "container" ? ("container" as const) : ("resource" as const),
      contentType: MEDIA,
      size: null,
      modified: null,
      types: [],
    };
    storage.listAll.mockImplementation(async function* () {
      yield entry;
      if (bad === "duplicate") yield entry;
    });
    if (bad === "duplicate") {
      const { doc } = await setup();
      const read = await storage.read(target);
      storage.read.mockResolvedValue({
        ...read,
        contentType: MEDIA,
        text: async () => JSON.stringify(doc()),
      });
    }
    await expect(client.grants(target)).rejects.toMatchObject({
      code: bad === "foreign" ? "scope" : "invalid-response",
    });
  });
  test.each(["share", "request"] as const)("validates %s Location", async (op) => {
    const { client, storage, target, grants, requests } = await setup();
    storage.create.mockResolvedValue({
      url: op === "share" ? grants : requests,
      etag: null,
      created: true,
    });
    await expect(
      op === "share"
        ? client.share(target, { agent: BOB, modes: ["read"] }, {})
        : client.request({ target, agent: BOB, modes: ["read"] }),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
});

// Request-only servers need not expose controller-only grant services.
test("uses AccessRequestService independently of access-control/grant discovery", async () => {
  const { client, storage, target } = await setup();
  storage.features.accessControl.state = "unknown";
  storage.features.accessControl.detail.model = "none";
  storage.features.accessGrants.state = "unknown";
  const result = await client.request({ target, agent: BOB, modes: ["read"] });
  expect(await client.requests()).toEqual([
    { target, agent: BOB, modes: ["read"], id: result.url },
  ]);
});

test("accepts media type parameters without parsing or fetching contexts", async () => {
  const { client, seed, doc, target } = await setup();
  const id = await seed(doc(), undefined, "Application/Lws+Json; charset=utf-8");
  expect(await client.grants(target)).toEqual([{ id, agent: BOB, modes: ["read"] }]);
});

test.each(["share", "request"] as const)("refuses foreign %s Locations", async (op) => {
  const { client, storage, target } = await setup();
  storage.create.mockResolvedValue({
    url: "https://foreign.example/grant",
    etag: null,
    created: true,
  });
  await expect(
    op === "share"
      ? client.share(target, { agent: BOB, modes: ["read"] }, {})
      : client.request({ target, agent: BOB, modes: ["read"] }),
  ).rejects.toMatchObject({ code: "scope", url: ROOT });
});
