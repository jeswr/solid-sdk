// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { AccessControlResource, AclResource, type Matcher, type Policy } from "@solid/object";
import { DataFactory, Parser, Store } from "n3";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createAccessClient,
  type AccessGrant as Grant,
  type RevocationKey,
  readAcp,
} from "./index.js";
import * as testing from "./testing.js";

const ROOT = "https://pod.example/";
const BOB = "https://bob.example/#me";
const ALICE = "https://alice.example/#me";
const GROUP = "https://group.example/#team";
const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP = "http://www.w3.org/ns/solid/acp#";
const PREFIX = `@prefix acl: <${ACL}>. @prefix acp: <${ACP}>. @prefix foaf: <http://xmlns.com/foaf/0.1/>.\n`;
const SELECTORS = [{ public: true }, { authenticated: true }] as const;

function graph(text: string, baseIRI: string) {
  return new Store(new Parser({ baseIRI }).parse(PREFIX + text));
}

async function setup(model: "wac" | "acp" = "wac", initial = "", container = false) {
  const memory = createMemoryStorage({ root: ROOT, clock: () => 0 });
  const target = container
    ? ROOT
    : (await memory.create(ROOT, "note", { name: "note.txt", contentType: "text/plain" })).url;
  const accessUrl = (
    await memory.create(ROOT, PREFIX + initial, {
      name: model === "wac" ? "note.acl" : "note.acr",
      contentType: "text/turtle",
    })
  ).url;
  const head = vi.fn(async (url: string) => {
    const result = await memory.head(url);
    return {
      ...result,
      links: new Map([
        [model === "wac" ? "acl" : `${ACP}accessControl`, [{ target: accessUrl, params: {} }]],
      ]),
    };
  });
  const storage: StorageClient = {
    ...memory,
    head,
    features: {
      ...memory.features,
      accessControl: { state: "available", detail: { model }, evidence: "test" },
    },
    readRdf: vi.fn(memory.readRdf),
    writeRdf: vi.fn(memory.writeRdf),
  };
  return {
    memory,
    storage,
    head,
    target,
    accessUrl,
    client: createAccessClient({ storage, acpDialect: "css" }),
  };
}

afterEach(() => vi.restoreAllMocks());

test("keeps the reserved testing entry point", () => expect(Object.keys(testing)).toEqual([]));

describe.each(["wac", "acp"] as const)("%s sharing", (model) => {
  test.each([false, true])("round-trips all modes and agent kinds, inherit=%s", async (inherit) => {
    const { client, target, memory, accessUrl, storage } = await setup(model, "", inherit);
    const agents: Grant["agent"][] = [BOB, { public: true }, { authenticated: true }];
    if (model === "wac") agents.push({ group: GROUP });
    const shared: Grant[] = [];
    for (const agent of agents) {
      shared.push(
        await client.share(
          target,
          { agent, modes: ["read", "write", "append", "control", "read"] },
          { inherit },
        ),
      );
    }
    expect(client.model()).toBe(model);
    expect(await client.grants(target)).toEqual(shared);
    expect(storage.writeRdf).toHaveBeenCalledTimes(agents.length);
    for (const [, , options] of vi.mocked(storage.writeRdf).mock.calls)
      expect(options.ifMatch).not.toBe("*");
    const { dataset } = await memory.readRdf(accessUrl);
    if (model === "wac") {
      for (const auth of new AclResource(dataset, DataFactory).authorizations) {
        expect(auth.accessTo).toBe(target);
        expect(auth.default).toBe(inherit ? target : undefined);
      }
    } else {
      const root = new AccessControlResource(accessUrl, dataset, DataFactory);
      expect(root.resource).toBe(target);
      expect(root.accessControl.size).toBe(3);
      expect(root.memberAccessControl.size).toBe(inherit ? 3 : 0);
      for (const control of root.accessControl) {
        expect(control.apply.size).toBe(1);
        const policy = [...control.apply][0] as Policy;
        expect(policy.allOf.size).toBe(1);
        expect(([...policy.allOf][0] as Matcher).agent.size).toBe(1);
      }
    }
    for (const grant of shared) await client.revoke(target, grant.id as string);
    expect(await client.grants(target)).toEqual([]);
  });

  test("revokes an agent across independent grants and leaves other agents", async () => {
    const { client, target } = await setup(model);
    await client.share(target, { agent: BOB, modes: ["read"] }, {});
    await client.share(target, { agent: BOB, modes: ["append"] }, {});
    const alice = await client.share(target, { agent: ALICE, modes: ["control"] }, {});
    await client.revoke(target, BOB);
    expect(await client.grants(target)).toEqual([alice]);
  });

  describe.each(SELECTORS)("revoking %j", (key) => {
    test.each([false, true])("revokes named and blank-node grants, inherit=%s", async (inherit) => {
      const targetUrl = inherit ? ROOT : `${ROOT}note.txt`;
      const other: Grant["agent"] = "public" in key ? { authenticated: true } : { public: true };
      const selector = "public" in key ? "foaf:Agent" : "acl:AuthenticatedAgent";
      const acpSelector = "public" in key ? "acp:PublicAgent" : "acp:AuthenticatedAgent";
      const initial =
        model === "wac"
          ? `<#named> a acl:Authorization; acl:accessTo <${targetUrl}>; ${inherit ? `acl:default <${targetUrl}>;` : ""}
              acl:agentClass ${selector}; acl:mode acl:Read.
            [] a acl:Authorization; acl:accessTo <${targetUrl}>; ${inherit ? `acl:default <${targetUrl}>;` : ""}
              acl:agentClass ${selector}; acl:mode acl:Append.`
          : `<> acp:resource <${targetUrl}>; acp:accessControl <#control>, _:control;
              ${inherit ? "acp:memberAccessControl <#control>, _:control;" : ""} a acp:AccessControlResource.
            <#control> acp:apply <#named>. <#named> acp:allow acl:Read; acp:allOf [acp:agent ${acpSelector}].
            _:control acp:apply [acp:allow acl:Append; acp:allOf [acp:agent ${acpSelector}]].`;
      const { client, target, storage, memory, accessUrl } = await setup(
        model,
        `${initial}\n<#unrelated> <urn:example:annotation> "keep this".`,
        inherit,
      );
      const bob = await client.share(target, { agent: BOB, modes: ["control"] }, { inherit });
      const otherGrant = await client.share(
        target,
        { agent: other, modes: ["write"] },
        {
          inherit,
        },
      );
      expect(await client.grants(target)).toEqual([
        { agent: key, modes: ["read"], id: `${accessUrl}#named` },
        { agent: key, modes: ["append"] },
        bob,
        otherGrant,
      ]);
      const before = await memory.readRdf(accessUrl);
      vi.mocked(storage.writeRdf).mockClear();
      await client.revoke(target, key);
      expect(await client.grants(target)).toEqual([bob, otherGrant]);
      expect(storage.writeRdf).toHaveBeenCalledExactlyOnceWith(accessUrl, expect.anything(), {
        ifMatch: before.etag,
      });
      const after = (await memory.readRdf(accessUrl)).dataset;
      for (const q of before.dataset.match(DataFactory.namedNode(`${accessUrl}#unrelated`)))
        expect(after.has(q)).toBe(true);
      if (model === "acp") {
        const root = new AccessControlResource(accessUrl, after, DataFactory);
        expect(root.accessControl.size).toBe(2);
        expect(root.memberAccessControl.size).toBe(inherit ? 2 : 0);
      }
      vi.mocked(storage.writeRdf).mockClear();
      await client.revoke(target, key);
      expect(storage.writeRdf).not.toHaveBeenCalled();
    });

    test("snapshots the selector before storage reads", async () => {
      const { client, target } = await setup(model);
      await client.share(target, { agent: key, modes: ["read"] }, {});
      const input = { ...key };
      const pending = client.revoke(target, input);
      Object.assign(input, "public" in key ? { public: false } : { authenticated: false });
      await pending;
      expect(await client.grants(target)).toEqual([]);
    });
  });

  test.each([ALICE, ...SELECTORS])("leaves an unmatched revoke %j unwritten", async (key) => {
    const { client, target, storage } = await setup(model);
    await client.share(target, { agent: BOB, modes: ["read"] }, {});
    vi.mocked(storage.writeRdf).mockClear();
    await client.revoke(target, key);
    expect(storage.writeRdf).not.toHaveBeenCalled();
    expect(await client.grants(target)).toHaveLength(1);
  });
  test("prioritizes a grant id over the same IRI used as another grant's agent", async () => {
    const { client, target } = await setup(model);
    const first = await client.share(target, { agent: BOB, modes: ["read"] }, {});
    const second = await client.share(target, { agent: first.id as string, modes: ["read"] }, {});
    await client.revoke(target, first.id as string);
    expect(await client.grants(target)).toEqual([second]);
  });

  test("requires a container to inherit", async () => {
    const { client, target, storage } = await setup(model);
    await expect(
      client.share(target, { agent: BOB, modes: ["read"] }, { inherit: true }),
    ).rejects.toThrow("container");
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });

  test("preserves unconnected RDF", async () => {
    const initial = '<#unrelated> <urn:example:annotation> "keep this".';
    const { client, target, memory, accessUrl } = await setup(model, initial);
    const before = [...(await memory.readRdf(accessUrl)).dataset];
    const grant = await client.share(target, { agent: BOB, modes: ["read"] }, {});
    await client.revoke(target, grant.id as string);
    const after = (await memory.readRdf(accessUrl)).dataset;
    for (const q of before) expect(after.has(q)).toBe(true);
  });

  test("propagates a stale access document ETag without retry", async () => {
    const { client, storage, target, memory, accessUrl } = await setup(model);
    vi.mocked(storage.writeRdf).mockImplementationOnce(async (...args) => {
      const latest = await memory.head(accessUrl);
      await memory.write(accessUrl, PREFIX, {
        contentType: "text/turtle",
        ifMatch: latest.etag as string,
      });
      return memory.writeRdf(...args);
    });
    await expect(client.share(target, { agent: BOB, modes: ["read"] }, {})).rejects.toMatchObject({
      code: "precondition-failed",
      status: 412,
    });
    expect(storage.writeRdf).toHaveBeenCalledTimes(1);
    expect(storage.readRdf).toHaveBeenCalledTimes(1);
    expect(await client.grants(target)).toEqual([]);
  });
});

test("WAC serialization matches an independent ACL fixture and byte snapshot", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
  const { client, target, accessUrl, memory } = await setup("wac", "", true);
  const grant = await client.share(target, { agent: BOB, modes: ["read"] }, { inherit: true });
  const expected = graph(
    `<${grant.id}> a acl:Authorization; acl:accessTo <${target}>; acl:default <${target}>; acl:agent <${BOB}>; acl:mode acl:Read.`,
    accessUrl,
  );
  const actual = await memory.readRdf(accessUrl);
  expect(actual.dataset.size).toBe(expected.size);
  for (const q of expected) expect(actual.dataset.has(q)).toBe(true);
  expect(await (await memory.read(accessUrl)).text()).toMatchInlineSnapshot(`
"<https://pod.example/note.acl#grant-00000000-0000-4000-8000-000000000000> a <http://www.w3.org/ns/auth/acl#Authorization>;
    <http://www.w3.org/ns/auth/acl#accessTo> <https://pod.example/>;
    <http://www.w3.org/ns/auth/acl#default> <https://pod.example/>;
    <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Read>;
    <http://www.w3.org/ns/auth/acl#agent> <https://bob.example/#me>.
"
`);
});

test("ACP serialization matches an independent simplest-policy fixture and byte snapshot", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
  const { client, target, accessUrl, memory } = await setup("acp", "", true);
  const { id } = await client.share(
    target,
    { agent: { public: true }, modes: ["read"] },
    { inherit: true },
  );
  const expected = graph(
    `<${accessUrl}> a acp:AccessControlResource; acp:resource <${target}>; acp:accessControl <${id}-control>; acp:memberAccessControl <${id}-control>.
    <${id}-control> a acp:AccessControl; acp:apply <${id}>.
    <${id}> a acp:Policy; acp:allow acl:Read; acp:allOf <${id}-matcher>.
    <${id}-matcher> a acp:Matcher; acp:agent acp:PublicAgent.`,
    accessUrl,
  );
  const actual = await memory.readRdf(accessUrl);
  expect(actual.dataset.size).toBe(expected.size);
  for (const q of expected) expect(actual.dataset.has(q)).toBe(true);
  expect(await (await memory.read(accessUrl)).text()).toMatchInlineSnapshot(`
"<https://pod.example/note.acr> a <http://www.w3.org/ns/solid/acp#AccessControlResource>;
    <http://www.w3.org/ns/solid/acp#resource> <https://pod.example/>;
    <http://www.w3.org/ns/solid/acp#accessControl> <https://pod.example/note.acr#grant-00000000-0000-4000-8000-000000000000-control>;
    <http://www.w3.org/ns/solid/acp#memberAccessControl> <https://pod.example/note.acr#grant-00000000-0000-4000-8000-000000000000-control>.
<https://pod.example/note.acr#grant-00000000-0000-4000-8000-000000000000-control> a <http://www.w3.org/ns/solid/acp#AccessControl>;
    <http://www.w3.org/ns/solid/acp#apply> <https://pod.example/note.acr#grant-00000000-0000-4000-8000-000000000000>.
<https://pod.example/note.acr#grant-00000000-0000-4000-8000-000000000000> a <http://www.w3.org/ns/solid/acp#Policy>;
    <http://www.w3.org/ns/solid/acp#allOf> <https://pod.example/note.acr#grant-00000000-0000-4000-8000-000000000000-matcher>;
    <http://www.w3.org/ns/solid/acp#allow> <http://www.w3.org/ns/auth/acl#Read>.
<https://pod.example/note.acr#grant-00000000-0000-4000-8000-000000000000-matcher> a <http://www.w3.org/ns/solid/acp#Matcher>;
    <http://www.w3.org/ns/solid/acp#agent> <http://www.w3.org/ns/solid/acp#PublicAgent>.
"
`);
});

test("reads WAC multi-target and default-only authorizations, omits unrelated rules", async () => {
  const { client, target } = await setup(
    "wac",
    `
    <#multi> a acl:Authorization; acl:accessTo <https://pod.example/other>, <https://pod.example/note.txt>; acl:agent <${BOB}>, <${ALICE}>; acl:mode acl:Read.
    <#default> a acl:Authorization; acl:default <https://pod.example/note.txt>; acl:agentGroup <${GROUP}>; acl:mode acl:Append.
    <#other> a acl:Authorization; acl:accessTo <https://pod.example/other>; acl:agent <${BOB}>; acl:mode acl:Write.`,
  );
  expect((await client.grants(target)).map(({ agent }) => agent)).toEqual([
    BOB,
    ALICE,
    { group: GROUP },
  ]);
});

test("WAC revoke preserves co-agents and group selectors", async () => {
  const { client, target } = await setup(
    "wac",
    `<#both> a acl:Authorization; acl:accessTo <https://pod.example/note.txt>; acl:agent <${BOB}>, <${ALICE}>; acl:agentGroup <${GROUP}>; acl:mode acl:Read.`,
  );
  await client.revoke(target, BOB);
  expect((await client.grants(target)).map(({ agent }) => agent)).toEqual([
    ALICE,
    { group: GROUP },
  ]);
  await client.revoke(target, GROUP);
  expect((await client.grants(target)).map(({ agent }) => agent)).toEqual([ALICE]);
});

describe.each(SELECTORS)("WAC revoking %j", (key) => {
  test.each([
    "accessTo",
    "default",
  ])("preserves co-selectors on a blank-node %s rule", async (predicate) => {
    const other = "public" in key ? { authenticated: true } : { public: true };
    const { client, target } = await setup(
      "wac",
      `[] a acl:Authorization; acl:${predicate} <https://pod.example/note.txt>;
        acl:agent <${BOB}>; acl:agentGroup <${GROUP}>;
        acl:agentClass foaf:Agent, acl:AuthenticatedAgent; acl:mode acl:Read.`,
    );
    await client.revoke(target, key);
    expect((await client.grants(target)).map(({ agent }) => agent)).toEqual([
      BOB,
      other,
      { group: GROUP },
    ]);
  });

  test.each(["accessTo", "default"])("refuses to change a shared %s rule", async (predicate) => {
    const { client, target, storage, memory, accessUrl } = await setup(
      "wac",
      `[] a acl:Authorization; acl:accessTo <https://pod.example/note.txt>;
        acl:${predicate} <https://pod.example/other>; acl:agentClass foaf:Agent, acl:AuthenticatedAgent;
        acl:mode acl:Read.`,
    );
    const before = await (await memory.read(accessUrl)).text();
    await expect(client.revoke(target, key)).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.writeRdf).not.toHaveBeenCalled();
    expect(await (await memory.read(accessUrl)).text()).toBe(before);
  });
});

test("WAC id revoke removes only this resource's targets from a shared rule", async () => {
  const { client, target, accessUrl, memory } = await setup(
    "wac",
    `<#shared> a acl:Authorization; acl:accessTo <https://pod.example/note.txt>, <https://pod.example/other>; acl:agent <${BOB}>; acl:mode acl:Read.`,
  );
  await client.revoke(target, `${accessUrl}#shared`);
  expect(await client.grants(target)).toEqual([]);
  const rules = [
    ...new AclResource((await memory.readRdf(accessUrl)).dataset, DataFactory).authorizations,
  ];
  expect(rules[0]?.accessTo).toBe(`${ROOT}other`);
});

test("refuses agent revoke that would change another resource's shared WAC rule", async () => {
  const { client, target, storage } = await setup(
    "wac",
    `<#shared> a acl:Authorization; acl:accessTo <https://pod.example/note.txt>, <https://pod.example/other>; acl:agent <${BOB}>; acl:mode acl:Read.`,
  );
  await expect(client.revoke(target, BOB)).rejects.toMatchObject({ code: "unsupported" });
  expect(storage.writeRdf).not.toHaveBeenCalled();
});

test("anonymous WAC grants revoke by agent without exposing unstable blank-node ids", async () => {
  const { client, target } = await setup(
    "wac",
    `[] a acl:Authorization; acl:accessTo <https://pod.example/note.txt>; acl:agent <${BOB}>; acl:mode acl:Read.`,
  );
  expect(await client.grants(target)).toEqual([{ agent: BOB, modes: ["read"] }]);
  await client.revoke(target, BOB);
  expect(await client.grants(target)).toEqual([]);
});

describe("capabilities and effective access", () => {
  test.each([
    "wac",
    "acp",
    "odrl-grants",
    "none",
  ] as const)("reports advertised model %s", async (model) => {
    const { storage } = await setup();
    storage.features.accessControl.detail.model = model;
    expect(createAccessClient({ storage }).model()).toBe(model);
  });
  test.each(["unknown", "unavailable"] as const)("reports none when %s", async (state) => {
    const { storage } = await setup();
    storage.features.accessControl.state = state;
    expect(createAccessClient({ storage }).model()).toBe("none");
  });
  test.each([
    "odrl-grants",
    "none",
  ] as const)("rejects unsupported model %s before IO", async (model) => {
    const { storage, head, target } = await setup();
    storage.features.accessControl.detail.model = model;
    const client = createAccessClient({ storage });
    await expect(client.grants(target)).rejects.toMatchObject({
      code: "unsupported",
      feature: "accessControl",
    });
    expect(head).not.toHaveBeenCalled();
  });
  test("refuses LWS operations before IO", async () => {
    const storage = createMemoryStorage({ protocol: "lws" });
    const head = vi.spyOn(storage, "head");
    const client = createAccessClient({ storage });
    await expect(client.effective(storage.root)).rejects.toMatchObject({ code: "unsupported" });
    await expect(client.grants(storage.root)).rejects.toMatchObject({ code: "unsupported" });
    expect(head).not.toHaveBeenCalled();
  });
  test("effective uses only head.allow and does not infer implied or public modes", async () => {
    const { client, target, head, storage } = await setup();
    head.mockResolvedValue({
      ...(await storage.head(target)),
      allow: { read: false, write: true, append: false, control: true },
    });
    expect(await client.effective(target)).toEqual({ me: ["write", "control"], public: [] });
    expect(storage.readRdf).not.toHaveBeenCalled();
    head.mockResolvedValue({ ...(await storage.head(target)), allow: null });
    expect(await client.effective(target)).toBeNull();
  });
});

describe("conditional writes and discovery", () => {
  test.each([
    "acl",
    `${ACP}accessControl`,
  ])("discovers ACP through rel=%s and conditionally edits its advertised ACR", async (rel) => {
    const { client, target, head, accessUrl, storage } = await setup(
      "acp",
      `<> acp:resource <https://pod.example/note.txt>; acp:accessControl <#control>.
        <#control> acp:apply <#policy>. <#policy> acp:allow acl:Read; acp:allOf <#matcher>.
        <#matcher> acp:agent <${BOB}>.`,
    );
    head.mockResolvedValue({
      ...(await head(target)),
      links: new Map([[rel, [{ target: accessUrl, params: {} }]]]),
    });
    const etag = (await storage.readRdf(accessUrl)).etag;
    expect(await client.grants(target)).toEqual([
      { agent: BOB, modes: ["read"], id: `${accessUrl}#policy` },
    ]);
    const grant = await client.share(target, { agent: ALICE, modes: ["append"] }, {});
    expect(storage.writeRdf).toHaveBeenLastCalledWith(accessUrl, expect.anything(), {
      ifMatch: etag,
    });
    expect(await client.grants(target)).toContainEqual(grant);
    await client.revoke(target, `${accessUrl}#policy`);
    expect(await client.grants(target)).toEqual([grant]);
    expect(storage.writeRdf).toHaveBeenCalledTimes(2);
  });
  test("refuses ACP links advertising competing access documents across relations", async () => {
    const { client, target, head, accessUrl, storage } = await setup("acp");
    head.mockResolvedValue({
      ...(await head(target)),
      links: new Map([
        ["acl", [{ target: accessUrl, params: {} }]],
        [`${ACP}accessControl`, [{ target: `${ROOT}other.acr`, params: {} }]],
      ]),
    });
    await expect(client.grants(target)).rejects.toMatchObject({ code: "invalid-response" });
    expect(storage.readRdf).not.toHaveBeenCalled();
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
  test.each([
    "share",
    "revoke",
  ] as const)("refuses %s when WAC-Allow denies Control", async (operation) => {
    const { client, target, storage, head } = await setup();
    head.mockResolvedValue({
      ...(await head(target)),
      allow: { read: true, write: true, append: true, control: false },
    });
    const result =
      operation === "share"
        ? client.share(target, { agent: BOB, modes: ["read"] }, {})
        : client.revoke(target, BOB);
    await expect(result).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(storage.readRdf).not.toHaveBeenCalled();
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
  test("defers authorization to the server when WAC-Allow is absent, preserves forbidden mapping", async () => {
    const { client, target, storage, head, accessUrl } = await setup();
    head.mockResolvedValue({ ...(await head(target)), allow: null });
    const denied = new StorageError("forbidden", { status: 403, method: "PUT", url: accessUrl });
    vi.mocked(storage.writeRdf).mockRejectedValue(denied);
    await expect(client.share(target, { agent: BOB, modes: ["read"] }, {})).rejects.toBe(denied);
  });
  test.each([null, "", "  ", "*"])("refuses a missing or unsafe ETag %s", async (etag) => {
    const { client, target, storage } = await setup();
    vi.mocked(storage.readRdf).mockResolvedValue({
      ...(await storage.readRdf(`${ROOT}note.acl`)),
      etag,
    });
    await expect(client.share(target, { agent: BOB, modes: ["read"] }, {})).rejects.toMatchObject({
      code: "precondition-required",
    });
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
  describe.each(["wac", "acp"] as const)("%s access links", (model) => {
    test.each([undefined, []])("refuses absent access links %s", async (links) => {
      const { client, target, head, storage } = await setup(model);
      head.mockResolvedValue({
        ...(await head(target)),
        links: links ? new Map([["acl", links]]) : new Map(),
      });
      await expect(client.grants(target)).rejects.toMatchObject({ code: "unsupported" });
      expect(storage.readRdf).not.toHaveBeenCalled();
    });
  });
  test("refuses ambiguous access links", async () => {
    const { client, target, head, accessUrl } = await setup();
    head.mockResolvedValue({
      ...(await head(target)),
      links: new Map([
        [
          "acl",
          [
            { target: accessUrl, params: {} },
            { target: accessUrl, params: {} },
          ],
        ],
      ]),
    });
    await expect(client.grants(target)).rejects.toMatchObject({ code: "invalid-response" });
  });
  test("refuses foreign access links without fetching or disclosing them", async () => {
    const { client, target, head, storage } = await setup();
    head.mockResolvedValue({
      ...(await head(target)),
      links: new Map([
        ["acl", [{ target: "https://synthetic:credential@foreign.example/acl", params: {} }]],
      ]),
    });
    const error = await client.grants(target).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "scope", url: target });
    expect(String(error)).not.toContain("synthetic");
    expect(storage.readRdf).not.toHaveBeenCalled();
  });
  test.each([
    "not-found",
    "not-rdf",
    "network",
    "forbidden",
  ] as const)("propagates document %s instead of replacing it", async (code) => {
    const { client, target, storage, accessUrl } = await setup();
    const error = new StorageError(code, { method: "GET", url: accessUrl });
    vi.mocked(storage.readRdf).mockRejectedValue(error);
    await expect(client.share(target, { agent: BOB, modes: ["read"] }, {})).rejects.toBe(error);
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
  test.each([
    true,
    false,
  ])("refuses an unexpected 304 or named graph, 304=%s", async (notModified) => {
    const { client, target, storage, accessUrl } = await setup();
    vi.mocked(storage.readRdf).mockResolvedValue({
      url: accessUrl,
      etag: '"1"',
      contentType: "text/turtle",
      notModified,
      dataset: notModified
        ? new Store()
        : new Store(
            new Parser({ format: "application/trig" }).parse("<urn:g> { <urn:s> <urn:p> <urn:o> }"),
          ),
    });
    await expect(client.grants(target)).rejects.toMatchObject({ code: "invalid-response" });
  });
});

describe("grant validation", () => {
  test.each([
    { purpose: "test" },
    { expires: new Date() },
  ])("refuses unsupported constraints %s before IO", async (constraint) => {
    const { client, target, head } = await setup();
    await expect(
      client.share(target, { agent: BOB, modes: ["read"], ...constraint }, {}),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(head).not.toHaveBeenCalled();
  });
  test.each([
    [],
    ["admin"],
    ["delete"],
    ["__proto__"],
    null,
  ])("refuses malformed modes %s before IO", async (modes) => {
    const { client, target, head } = await setup();
    await expect(client.share(target, { agent: BOB, modes } as Grant, {})).rejects.toThrow(
      TypeError,
    );
    expect(head).not.toHaveBeenCalled();
  });
  test.each([
    null,
    123,
    {},
    { public: false },
    { authenticated: false },
    { group: 1 },
    { public: true, group: GROUP },
    "relative",
    "https://synthetic:credential@agent.example/",
    "https://agent.example/a b",
    "https://agent.example/a\u0000b",
    "https://agent.example/a\u007fb",
    "https://agent.example/<injection>",
    { group: "relative" },
  ])("refuses malformed agent %s before IO", async (agent) => {
    const { client, target, head } = await setup();
    await expect(client.share(target, { agent, modes: ["read"] } as Grant, {})).rejects.toThrow(
      TypeError,
    );
    expect(head).not.toHaveBeenCalled();
  });
  test("refuses ACP group grants before IO", async () => {
    const { client, target, head } = await setup("acp");
    await expect(
      client.share(target, { agent: { group: GROUP }, modes: ["read"] }, {}),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(head).not.toHaveBeenCalled();
  });
  test.each([
    "PublicAgent",
    "AuthenticatedAgent",
    "OwnerAgent",
    "CreatorAgent",
  ])("rejects reserved ACP agent IRI %s passed as an ordinary WebID", async (name) => {
    const { client, target, head } = await setup("acp");
    await expect(
      client.share(target, { agent: `${ACP}${name}`, modes: ["read"] }, {}),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(head).not.toHaveBeenCalled();
  });
  test("snapshots inheritance before storage reads", async () => {
    const { client, target, memory, accessUrl } = await setup("wac", "", true);
    const options = { inherit: false };
    const pending = client.share(target, { agent: BOB, modes: ["read"] }, options);
    options.inherit = true;
    await pending;
    const authorizations = [
      ...new AclResource((await memory.readRdf(accessUrl)).dataset, DataFactory).authorizations,
    ];
    expect(authorizations[0]?.default).toBeUndefined();
  });
  test("snapshots caller data before the first await and never overwrites a caller-supplied id", async () => {
    const { client, target } = await setup();
    const grant: Grant = { agent: { group: GROUP }, modes: ["read"], id: "urn:existing-rule" };
    const pending = client.share(target, grant, {});
    (grant.agent as { group: string }).group = BOB;
    (grant.modes as string[]).push("control");
    const shared = await pending;
    expect(shared).toMatchObject({ agent: { group: GROUP }, modes: ["read"] });
    expect(shared.id).not.toBe(grant.id);
    expect(await client.grants(target)).toEqual([shared]);
  });
});

describe.each(["wac", "acp"] as const)("%s revocation validation", (model) => {
  test.each([
    null,
    123,
    {},
    { public: false },
    { authenticated: false },
    { group: GROUP },
    { public: true, authenticated: true },
  ])("refuses malformed selector %j before IO", async (key) => {
    const { client, target, head, storage } = await setup(model);
    await expect(client.revoke(target, key as RevocationKey)).rejects.toThrow(TypeError);
    expect(head).not.toHaveBeenCalled();
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
});

describe("untrusted access graphs", () => {
  describe.each(["access", "memberAccess"])("ESS acp:%s", (predicate) => {
    test.each([
      "grants",
      "share",
      "revoke agent",
      "revoke id",
    ])("refuses %s without changing Control policies", async (operation) => {
      const { storage, target, memory, accessUrl } = await setup(
        "acp",
        `<> a acp:AccessControlResource; acp:${predicate} <#policy>.
        <#policy> acp:allow acp:Read, acp:Write; acp:allOf <#matcher>.
        <#matcher> acp:agent <${BOB}>.`,
      );
      const before = await (await memory.read(accessUrl)).text();
      const neutral = readAcp((await memory.readRdf(accessUrl)).dataset, target, accessUrl, "ess");
      expect(neutral.grants[0]?.modes).toEqual(new Set(["control"]));
      const client = createAccessClient({ storage, acpDialect: "ess" });
      const result =
        operation === "grants"
          ? client.grants(target)
          : operation === "share"
            ? client.share(target, { agent: ALICE, modes: ["read"] }, {})
            : client.revoke(target, operation === "revoke id" ? `${accessUrl}#policy` : BOB);
      await expect(result).rejects.toMatchObject({ code: "unsupported" });
      expect(storage.writeRdf).not.toHaveBeenCalled();
      expect(await (await memory.read(accessUrl)).text()).toBe(before);
    });
  });
  describe.each(["<#root>", "_:root"])("resource-less ACP root %s", (root) => {
    test.each([
      "grants",
      "share",
      "revoke",
    ])("refuses %s rather than ignoring the root", async (operation) => {
      const { target, storage, memory, accessUrl } = await setup(
        "acp",
        `${root} a acp:AccessControlResource; acp:accessControl <#control>.
        <#control> acp:apply <#policy>. <#policy> acp:allow acp:Read; acp:allOf [acp:agent <${BOB}>].`,
      );
      const client = createAccessClient({ storage, acpDialect: "ess" });
      expect(
        readAcp((await memory.readRdf(accessUrl)).dataset, target, accessUrl, "ess").grants[0]
          ?.modes,
      ).toEqual(new Set(["read"]));
      const before = await (await memory.read(accessUrl)).text();
      await expect(
        operation === "grants"
          ? client.grants(target)
          : operation === "share"
            ? client.share(target, { agent: ALICE, modes: ["read"] }, {})
            : client.revoke(target, BOB),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(storage.writeRdf).not.toHaveBeenCalled();
      expect(await (await memory.read(accessUrl)).text()).toBe(before);
    });
  });
  test.each([
    ['acl:mode "Read"', "invalid-response"],
    ["acl:mode <urn:unknown>", "unsupported"],
    ['acl:mode acl:Read; acl:agent "literal"', "invalid-response"],
    ["acl:mode acl:Read; acl:agentClass <urn:unknown>", "unsupported"],
    ["acl:mode acl:Read; acl:origin <https://app.example/>", "unsupported"],
    ['acl:mode acl:Read; acl:accessTo "bad"', "invalid-response"],
  ])("fails closed on WAC %s", async (clause, code) => {
    const { client, target } = await setup(
      "wac",
      `<#rule> a acl:Authorization; acl:accessTo <https://pod.example/note.txt>; acl:agent <${BOB}>; ${clause}.`,
    );
    await expect(client.grants(target)).rejects.toMatchObject({ code });
  });
  test.each([
    ["acp:deny acl:Read; acp:allOf <#matcher>", `acp:agent <${BOB}>`, "unsupported"],
    ["acp:anyOf <#matcher>", `acp:agent <${BOB}>`, "unsupported"],
    ["acp:noneOf <#matcher>", `acp:agent <${BOB}>`, "unsupported"],
    ["acp:allOf <#matcher>, <#second>", `acp:agent <${BOB}>`, "unsupported"],
    [
      "acp:allOf <#matcher>",
      `acp:agent <${BOB}>; acp:client <https://app.example/>`,
      "unsupported",
    ],
    ["acp:allOf <#matcher>", `acp:agent <${BOB}>, <${ALICE}>`, "unsupported"],
    ["acp:allOf <#matcher>", "acp:agent acp:OwnerAgent", "unsupported"],
    ["acp:allOf <#matcher>", "acp:agent acp:CreatorAgent", "unsupported"],
    ["acp:allOf <#matcher>", 'acp:agent "bad"', "invalid-response"],
    ["acp:allOf <#matcher>; <urn:unknown> true", `acp:agent <${BOB}>`, "unsupported"],
  ])("fails closed on ACP %s / %s", async (clause, matcher, code) => {
    const { client, target } = await setup(
      "acp",
      `<> a acp:AccessControlResource; acp:resource <https://pod.example/note.txt>; acp:accessControl <#control>.
      <#control> acp:apply <#policy>. <#policy> acp:allow acl:Read; ${clause}. <#matcher> ${matcher}.`,
    );
    await expect(client.grants(target)).rejects.toMatchObject({ code });
  });
  test.each([
    BOB,
    ...SELECTORS,
  ])("refuses revocation by %j in a multi-policy ACP control", async (key) => {
    const agent =
      typeof key === "string"
        ? `<${key}>`
        : "public" in key
          ? "acp:PublicAgent"
          : "acp:AuthenticatedAgent";
    const { client, target, storage, memory, accessUrl } = await setup(
      "acp",
      `<> acp:resource <https://pod.example/note.txt>; acp:accessControl <#control>. <#control> acp:apply <#one>, <#two>.
      <#one> acp:allow acl:Read; acp:allOf <#bob>. <#two> acp:allow acl:Write; acp:allOf <#alice>.
      <#bob> acp:agent ${agent}. <#alice> acp:agent <${ALICE}>.`,
    );
    const before = await (await memory.read(accessUrl)).text();
    await expect(client.revoke(target, key)).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.writeRdf).not.toHaveBeenCalled();
    expect(await (await memory.read(accessUrl)).text()).toBe(before);
  });
  test("refuses ambiguous ACP roots", async () => {
    const { client, target } = await setup(
      "acp",
      "<#one> acp:resource <https://pod.example/note.txt>. <#two> acp:resource <https://pod.example/note.txt>.",
    );
    await expect(client.grants(target)).rejects.toMatchObject({ code: "invalid-response" });
  });
  describe.each(["<>", "<#root>", "_:root"])("ACP root %s", (root) => {
    describe.each([
      ["<https://pod.example/note.txt>, <https://pod.example/other>", "unsupported"],
      ["<https://pod.example/other>, <https://pod.example/note.txt>", "unsupported"],
      ['<https://pod.example/note.txt>, "literal"', "invalid-response"],
      ['"literal", <https://pod.example/note.txt>', "invalid-response"],
      ["<https://pod.example/note.txt>, []", "invalid-response"],
      ["[], <https://pod.example/note.txt>", "invalid-response"],
    ])("associations %s", (associations, code) => {
      test.each([
        "grants",
        "share",
        "revoke by agent",
        "revoke by id",
      ])("refuses %s and preserves all RDF", async (operation) => {
        const { client, target, storage, memory, accessUrl } = await setup(
          "acp",
          `${root} a acp:AccessControlResource; acp:resource ${associations};
            acp:accessControl <#control>; acp:memberAccessControl <#control>.
          <#control> acp:apply <#policy>. <#policy> acp:allow acl:Read; acp:allOf <#matcher>.
          <#matcher> acp:agent <${BOB}>.`,
        );
        const before = await (await memory.read(accessUrl)).text();
        const result =
          operation === "grants"
            ? client.grants(target)
            : operation === "share"
              ? client.share(target, { agent: ALICE, modes: ["write"] }, {})
              : client.revoke(target, operation === "revoke by id" ? `${accessUrl}#policy` : BOB);
        await expect(result).rejects.toMatchObject({ code });
        expect(storage.writeRdf).not.toHaveBeenCalled();
        expect(await (await memory.read(accessUrl)).text()).toBe(before);
      });
    });
  });
  test("refuses to repurpose a conflicting ACP root", async () => {
    const { client, target, storage } = await setup(
      "acp",
      "<> acp:resource <https://pod.example/other>.",
    );
    await expect(client.share(target, { agent: BOB, modes: ["read"] }, {})).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
  test.each([
    BOB,
    ...SELECTORS,
  ])("revoke by %j preserves another resource and shared ACP definitions", async (key) => {
    const agent =
      typeof key === "string"
        ? `<${key}>`
        : "public" in key
          ? "acp:PublicAgent"
          : "acp:AuthenticatedAgent";
    const initial = `<> acp:resource <https://pod.example/note.txt>; acp:accessControl <#control>; acp:memberAccessControl <#control>.
      <#foreign> acp:resource <https://pod.example/other>; acp:accessControl <#control>.
      <#control> acp:apply <#policy>. <#policy> acp:allow acl:Read; acp:allOf <#matcher>. <#matcher> acp:agent ${agent}.`;
    const { client, target, memory, accessUrl } = await setup("acp", initial);
    const before = (await memory.readRdf(accessUrl)).dataset;
    await client.revoke(target, key);
    expect(await client.grants(target)).toEqual([]);
    const dataset = (await memory.readRdf(accessUrl)).dataset;
    const foreign = new AccessControlResource(`${accessUrl}#foreign`, dataset, DataFactory);
    expect(foreign.accessControl.size).toBe(1);
    expect([...foreign.accessControl][0]?.apply.size).toBe(1);
    expect(dataset.size).toBe(before.size - 2);
    for (const q of before) {
      if (
        q.subject.value === accessUrl &&
        ["accessControl", "memberAccessControl"].some((name) => q.predicate.value === ACP + name)
      )
        continue;
      expect(dataset.has(q)).toBe(true);
    }
  });
  test("reads anonymous ACP policies without unstable ids", async () => {
    const { client, target } = await setup(
      "acp",
      `<> acp:resource <https://pod.example/note.txt>; acp:accessControl [acp:apply [acp:allow acl:Read; acp:allOf [acp:agent <${BOB}>]]].`,
    );
    expect(await client.grants(target)).toEqual([{ agent: BOB, modes: ["read"] }]);
    await client.revoke(target, BOB);
    expect(await client.grants(target)).toEqual([]);
  });
});

describe("trusted ACP dialect selection", () => {
  test("accepts a typed resource-less canonical ESS root", async () => {
    const { storage, target } = await setup(
      "acp",
      `<> a acp:AccessControlResource; acp:accessControl <#control>.
      <#control> acp:apply <#policy>. <#policy> acp:allow acp:Read; acp:allOf [acp:agent <${BOB}>].`,
    );
    const client = createAccessClient({ storage, acpDialect: "ess" });
    expect(await client.grants(target)).toHaveLength(1);
    await client.revoke(target, BOB);
    expect(await client.grants(target)).toEqual([]);
  });
  test.each([
    "css",
    "ess",
  ] as const)("refuses unestablished canonical root placement on %s", async (acpDialect) => {
    const { storage, target } = await setup("acp", "<> acp:accessControl <#control>.");
    await expect(
      createAccessClient({ storage, acpDialect }).revoke(target, BOB),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
  test("refuses ACR-self Control policies alongside a resource root", async () => {
    const { storage, target } = await setup(
      "acp",
      `<> acp:resource <https://pod.example/note.txt>.
      <#self> acp:resource <>; acp:accessControl <#control>.
      <#control> acp:apply <#policy>. <#policy> acp:allow acp:Read, acp:Write; acp:allOf [acp:agent <${BOB}>].`,
    );
    await expect(
      createAccessClient({ storage, acpDialect: "ess" }).revoke(target, BOB),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
  test.each([
    undefined,
    "unrecognised",
  ])("refuses dialect %s before IO, regardless of editable RDF", async (acpDialect) => {
    const { storage, target, head } = await setup("acp", "<> a acp:AccessControlResource.");
    const client = createAccessClient({ storage, acpDialect: acpDialect as "css" });
    await expect(client.share(target, { agent: BOB, modes: ["read"] }, {})).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(client.grants(target)).rejects.toMatchObject({ code: "unsupported" });
    await expect(client.revoke(target, BOB)).rejects.toMatchObject({ code: "unsupported" });
    expect(head).not.toHaveBeenCalled();
  });
  test.each([
    "css",
    "ess",
  ] as const)("writes active %s resource modes using the translation core", async (acpDialect) => {
    const { storage, target, memory, accessUrl } = await setup("acp", "", true);
    const client = createAccessClient({ storage, acpDialect });
    const grant = await client.share(
      target,
      { agent: BOB, modes: ["read", "write", "append"] },
      { inherit: true },
    );
    const dataset = (await memory.readRdf(accessUrl)).dataset;
    const policy = readAcp(dataset, target, accessUrl, acpDialect);
    expect(policy.grants.map((g) => ({ modes: g.modes, scope: g.appliesTo }))).toEqual([
      { modes: new Set(["read", "write", "append"]), scope: "resource" },
      { modes: new Set(["read", "write", "append"]), scope: "members" },
    ]);
    expect(await client.grants(target)).toEqual([grant]);
    await client.revoke(target, BOB);
    expect(await client.grants(target)).toEqual([]);
  });
  test("refuses ESS Control before IO rather than writing inactive resource Control", async () => {
    const { storage, target, head } = await setup("acp");
    await expect(
      createAccessClient({ storage, acpDialect: "ess" }).share(
        target,
        { agent: BOB, modes: ["control"] },
        {},
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(head).not.toHaveBeenCalled();
  });
  test.each(["acl:Read", "acp:Control"])("refuses inactive ESS resource modes %s", async (mode) => {
    const { storage, target } = await setup(
      "acp",
      `<> acp:resource <https://pod.example/note.txt>; acp:accessControl <#control>.
      <#control> acp:apply <#policy>. <#policy> acp:allow ${mode}; acp:allOf [acp:agent <${BOB}>].`,
    );
    const client = createAccessClient({ storage, acpDialect: "ess" });
    await expect(client.grants(target)).rejects.toMatchObject({ code: "unsupported" });
    await expect(client.revoke(target, BOB)).rejects.toMatchObject({ code: "unsupported" });
    expect(storage.writeRdf).not.toHaveBeenCalled();
  });
});
