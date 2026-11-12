// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { LinkTarget, ReadResult, StorageClient } from "@jeswr/storage-client";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { checkOwnerOnly, type OwnerOnlyOptions, type OwnerOnlyResult } from "./index.js";
import { ACL, ACP } from "./rdf.js";

const ROOT = "https://pod.example/alice/";
const FOLDER = `${ROOT}private/`;
const FILE = `${FOLDER}secret.ttl`;
const OWNER = "https://alice.example/#me";
const BOB = "https://bob.example/#me";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const ACCEPT = { accept: "text/turtle, application/ld+json;q=0.9" };
const PREFIX = `@prefix acl: <${ACL}>. @prefix acp: <${ACP}>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.`;

function wac(
  resource: string,
  selector = `acl:agent <${OWNER}>`,
  modes = "acl:Read, acl:Write, acl:Control",
  scope = "acl:accessTo",
) {
  return `[] a acl:Authorization; ${scope} <${resource}>; ${selector}; acl:mode ${modes}.`;
}

function acp(
  resource: string,
  dialect: "css" | "ess",
  matcher = `acp:agent <${OWNER}>`,
  modes = `${dialect === "css" ? "acl" : "acp"}:Read`,
  scope = "acp:accessControl",
) {
  return `<> a acp:AccessControlResource; acp:resource <${resource}>;
    ${scope} <#control>.
    <#control> acp:apply <#policy>.
    <#policy> acp:allow ${modes}; acp:allOf <#matcher>.
    <#matcher> ${matcher}.`;
}

// StorageClient supplies real RDF parsing through its memory backend. Only discovery is
// injected: every authorization/policy fixture is independent of pod-access's writers.
// ROOT is the real pim:Storage; `root` selects a caller-supplied (possibly sub-)root.
async function fixture(
  model: "wac" | "acp" = "wac",
  docs: Record<string, string | undefined> = { [FILE]: wac(FILE) },
  dialect: "css" | "ess" = "css",
  url = FILE,
  root = ROOT,
) {
  const memory = createMemoryStorage({ root: ROOT });
  if (root !== ROOT)
    await memory.create(ROOT, null, { kind: "container", name: root.slice(ROOT.length, -1) });
  const rootPolicy = model === "wac" ? wac(ROOT) : acp(ROOT, dialect);
  const endpoints = new Map<string, string>();
  for (const [resource, content] of Object.entries({ [ROOT]: rootPolicy, ...docs })) {
    const name = `document-${endpoints.size}.${model === "wac" ? "acl" : "acr"}`;
    const endpoint = `${root}${name}`;
    endpoints.set(resource, endpoint);
    if (content !== undefined)
      await memory.create(root, PREFIX + content, { name, contentType: "text/turtle" });
  }
  const base = await memory.head(ROOT);
  const storage: StorageClient = {
    ...memory,
    root,
    features: {
      ...memory.features,
      accessControl: { state: "available", detail: { model }, evidence: "fixture" },
    },
    head: vi.fn(async (resource: string) => {
      if ([...endpoints.values()].includes(resource) || resource.endsWith(".missing.acl"))
        return memory.head(resource);
      const links = new Map<string, LinkTarget[]>([
        ["acl", [{ target: endpoints.get(resource) ?? `${resource}.missing.acl`, params: {} }]],
      ]);
      if (resource === ROOT) links.set("type", [{ target: PIM_STORAGE, params: {} }]);
      return {
        ...base,
        url: resource,
        kind: resource.endsWith("/") ? ("container" as const) : ("resource" as const),
        links,
      };
    }),
    read: vi.fn(memory.read),
    readRdf: vi.fn(memory.readRdf),
    writeRdf: vi.fn(memory.writeRdf),
  };
  const options: OwnerOnlyOptions = { storage, url, ownerWebId: OWNER, acpDialect: dialect };
  return { storage, options, endpoints, memory };
}

function refusal(reason = "unrepresentable") {
  return { private: false, reasons: [{ subject: "unknown", modes: [], reason }] };
}

function withBody(read: ReadResult, content: string | Uint8Array): ReadResult {
  return { ...read, body: new Response(content).body };
}

/** Override only the HEAD of `target`; every other HEAD keeps the fixture's behaviour. */
function headOf(storage: StorageClient, target: string, patch: Partial<ReadResult>) {
  const original = vi.mocked(storage.head).getMockImplementation();
  vi.mocked(storage.head).mockImplementation(async (url, opts) => {
    const head = await (original as StorageClient["head"])(url, opts);
    return url === target ? { ...head, ...patch } : head;
  });
}

test("exports a typed storage-based API and accepts arbitrary owner modes", async () => {
  expectTypeOf(checkOwnerOnly).parameter(0).toEqualTypeOf<OwnerOnlyOptions>();
  expectTypeOf(checkOwnerOnly).returns.toEqualTypeOf<Promise<OwnerOnlyResult>>();
  const { options, storage } = await fixture();
  expect(await checkOwnerOnly(options)).toEqual({ private: true });
  expect(storage.read).toHaveBeenCalledTimes(1);
  expect(storage.read).toHaveBeenCalledWith(expect.any(String), ACCEPT);
  expect(storage.readRdf).not.toHaveBeenCalled();
  expect(storage.head).toHaveBeenCalledWith(FILE, { revalidate: true });
  expect(storage.writeRdf).not.toHaveBeenCalled();
});

describe("WAC effective grants without role projection", () => {
  test.each(["Read", "Append", "Write", "Control"])("owner may hold only %s", async (mode) => {
    const { options } = await fixture("wac", { [FILE]: wac(FILE, undefined, `acl:${mode}`) });
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
  });
  test.each([
    ["acl:Read, acl:Append", ["read", "append"]],
    ["acl:Control", ["control"]],
    ["acl:Write", ["write", "append"]],
    ["acl:Append", ["append"]],
  ])("refuses public %s", async (raw, modes) => {
    const { options } = await fixture("wac", {
      [FILE]: wac(FILE) + wac(FILE, "acl:agentClass foaf:Agent", raw as string),
    });
    expect(await checkOwnerOnly(options)).toEqual({
      private: false,
      reasons: [{ subject: "public", modes, reason: "non-owner" }],
    });
  });

  test.each([
    [`acl:agent <${BOB}>`, "agent"],
    [`acl:agent <${OWNER}>, <${BOB}>`, "agent"],
    ["acl:agentClass acl:AuthenticatedAgent", "authenticated"],
    ["acl:agentGroup <https://groups.example/team>", "group"],
    [`acl:agent <${BOB}>; acl:origin <https://app.example>`, "origin/client-scoped"],
    ["acl:agentClass foaf:Agent; acl:origin <https://app.example>", "origin/client-scoped"],
  ])("refuses %s", async (selector, subject) => {
    const { options } = await fixture("wac", { [FILE]: wac(FILE, selector, "acl:Read") });
    expect(await checkOwnerOnly(options)).toEqual({
      private: false,
      reasons: [{ subject, modes: ["read"], reason: "non-owner" }],
    });
  });

  test.each([
    `acl:agent <${OWNER}>, <${OWNER}>`,
    `acl:agent <${OWNER}>; acl:origin <https://app.example>`,
  ])("accepts owner selectors %s", async (selector) => {
    const { options } = await fixture("wac", { [FILE]: wac(FILE, selector) });
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
  });

  test.each([false, true])("resolves the nearest default (public=%s)", async (publicGrant) => {
    const selector = publicGrant ? "acl:agentClass foaf:Agent" : `acl:agent <${OWNER}>`;
    const { options, storage, endpoints } = await fixture("wac", {
      [FILE]: undefined,
      [FOLDER]: wac(FOLDER, selector, "acl:Read", "acl:default") + wac(FOLDER),
      [ROOT]: wac(ROOT, "acl:agentClass foaf:Agent", "acl:Control", "acl:default"),
    });
    expect((await checkOwnerOnly(options)).private).toBe(!publicGrant);
    expect(vi.mocked(storage.read).mock.calls.map(([url]) => url)).not.toContain(
      endpoints.get(ROOT),
    );
  });

  test("continues across absent ancestor ACLs to the root default", async () => {
    const { options } = await fixture("wac", {
      [FILE]: undefined,
      [FOLDER]: undefined,
      [ROOT]: wac(ROOT, `acl:agent <${OWNER}>`, "acl:Read", "acl:default"),
    });
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
  });

  test("refuses an ancestor ACL with no applicable defaults", async () => {
    const { options } = await fixture("wac", {
      [FILE]: undefined,
      [FOLDER]: wac(FOLDER),
      [ROOT]: wac(ROOT, "acl:agentClass foaf:Agent", "acl:Read", "acl:default"),
    });
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
  });

  test("WAC needs no ACP dialect assertion", async () => {
    const { options } = await fixture();
    delete options.acpDialect;
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
  });

  test("own ACL replaces public ancestor defaults", async () => {
    const { options, storage } = await fixture("wac", {
      [FILE]: wac(FILE),
      [ROOT]: wac(ROOT, "acl:agentClass foaf:Agent", "acl:Read", "acl:default"),
    });
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
    expect(storage.head).toHaveBeenCalledTimes(2);
  });

  test("checks member defaults for containers, while file checks select resource scope", async () => {
    const docs = {
      [FOLDER]: wac(FOLDER) + wac(FOLDER, "acl:agentClass foaf:Agent", "acl:Read", "acl:default"),
    };
    const folder = await fixture("wac", docs, "css", FOLDER);
    expect((await checkOwnerOnly(folder.options)).private).toBe(false);
    const file = await fixture("wac", {
      [FILE]: wac(FILE) + wac(FILE, "acl:agentClass foaf:Agent", "acl:Read", "acl:default"),
    });
    expect(await checkOwnerOnly(file.options)).toEqual({ private: true });
  });

  test.each([
    wac(FILE, `acl:agent <${OWNER}>`, "acl:Delete"),
    wac(FILE, `acl:agent <${OWNER}>`, "<urn:unknown>"),
    wac(FILE, `acl:agent <${OWNER}>`, '"Read"'),
    wac(FILE, 'acl:agent "not-an-IRI"'),
    wac(FILE, "acl:agentClass <urn:unknown>"),
    wac(FILE, `acl:agent <${OWNER}>; acl:unknown <urn:constraint>`),
    wac(FILE).replace("a acl:Authorization; ", ""),
    wac(FILE, `acl:agent <${OWNER}>`, "acl:Read", "acl:defaultForNew"),
    `${wac(FILE)}<> acp:resource <urn:mixed>.`,
    `${wac(FILE)}<> a acp:AccessControlResource.`,
  ])("refuses unrepresentable RDF %s", async (text) => {
    const { options } = await fixture("wac", { [FILE]: text });
    expect(await checkOwnerOnly(options)).toEqual(refusal());
  });

  test("reports an authorization with no representable subject as unknown", async () => {
    const { options } = await fixture("wac", {
      [FILE]: `[] a acl:Authorization; acl:accessTo <${FILE}>; acl:mode acl:Read.`,
    });
    expect(await checkOwnerOnly(options)).toEqual({
      private: false,
      reasons: [{ subject: "unknown", modes: ["read"], reason: "unknown" }],
    });
  });

  test("refuses documents with no represented grants", async () => {
    const { options } = await fixture("wac", { [FILE]: "<> <urn:annotation> <urn:value>." });
    expect(await checkOwnerOnly(options)).toEqual(refusal());
  });

  test("refuses an untyped public rule beside a typed owner rule", async () => {
    const untyped = wac(FILE, "acl:agentClass foaf:Agent", "acl:Read").replace(
      "a acl:Authorization; ",
      "",
    );
    const { options } = await fixture("wac", { [FILE]: wac(FILE) + untyped });
    expect(await checkOwnerOnly(options)).toEqual(refusal());
  });

  test.each([
    ["host case", FILE.replace("pod.example", "POD.example")],
    ["scheme case", FILE.replace("https:", "HTTPS:")],
    ["default port", FILE.replace("pod.example", "pod.example:443")],
  ])("refuses a public accessTo naming the resource by %s", async (_, target) => {
    const { options } = await fixture("wac", {
      [FILE]: wac(FILE) + wac(target, "acl:agentClass foaf:Agent", "acl:Read"),
    });
    expect(await checkOwnerOnly(options)).toEqual(refusal());
  });

  test("refuses a public inherited default naming the ancestor non-canonically", async () => {
    const { options } = await fixture("wac", {
      [FILE]: undefined,
      [FOLDER]:
        wac(FOLDER, `acl:agent <${OWNER}>`, "acl:Read", "acl:default") +
        wac(
          FOLDER.replace("pod.example", "Pod.Example"),
          "acl:agentClass foaf:Agent",
          "acl:Read",
          "acl:default",
        ),
    });
    expect(await checkOwnerOnly(options)).toEqual(refusal());
  });

  test("ignores an inert zero-mode authorization alongside the owner", async () => {
    const { options } = await fixture("wac", {
      [FILE]: `${wac(FILE)}[] a acl:Authorization; acl:accessTo <${FILE}>; acl:agentClass foaf:Agent.`,
    });
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
  });
});

describe.each(["css", "ess"] as const)("ACP %s", (dialect) => {
  test.each(["Read", "Append", "Write"])("owner may hold only %s", async (mode) => {
    const prefix = dialect === "css" ? "acl" : "acp";
    const { options } = await fixture(
      "acp",
      { [ROOT]: acp(ROOT, dialect, undefined, `${prefix}:${mode}`) },
      dialect,
      ROOT,
    );
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
  });
  test("accepts owner-only resource and inherited member policies", async () => {
    const { options } = await fixture(
      "acp",
      {
        [FILE]: acp(FILE, dialect),
        [FOLDER]: acp(
          FOLDER,
          dialect,
          `acp:agent <${OWNER}>`,
          undefined,
          "acp:memberAccessControl",
        ),
      },
      dialect,
    );
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
  });

  test.each([
    ["acp:agent acp:PublicAgent", "public"],
    ["acp:agent acp:AuthenticatedAgent", "authenticated"],
    [`acp:agent <${OWNER}>, <${BOB}>`, "agent"],
    [`acp:agent <${BOB}>`, "agent"],
  ])("refuses matcher %s", async (matcher, subject) => {
    const { options } = await fixture("acp", { [FILE]: acp(FILE, dialect, matcher) }, dialect);
    if (dialect === "ess" && matcher.includes(",")) {
      expect(await checkOwnerOnly(options)).toEqual(refusal());
      return;
    }
    expect(await checkOwnerOnly(options)).toEqual({
      private: false,
      reasons: [{ subject, modes: ["read"], reason: "non-owner" }],
    });
  });

  test.each([
    "Read, PREFIX:Append",
    "Append",
    "Write",
    "Control",
  ])("refuses partial non-owner modes %s", async (raw) => {
    const prefix = dialect === "css" ? "acl" : "acp";
    const modes = `${prefix}:${raw.replace("PREFIX", prefix)}`;
    const { options } = await fixture(
      "acp",
      {
        [FILE]: acp(FILE, dialect, "acp:agent acp:PublicAgent", modes),
      },
      dialect,
    );
    const result = await checkOwnerOnly(options);
    expect(result.private).toBe(false);
    if (!result.private) {
      if (dialect === "ess" && raw === "Control") expect(result).toEqual(refusal());
      else expect(result.reasons[0]?.subject).toBe("public");
    }
  });

  test("denials and exclusions never justify accepting a public grant", async () => {
    const prefix = dialect === "css" ? "acl" : "acp";
    const text =
      acp(FILE, dialect, "acp:agent acp:PublicAgent") +
      `<#policy> acp:deny ${prefix}:Read; acp:noneOf [acp:agent <${BOB}>].`;
    const { options } = await fixture("acp", { [FILE]: text }, dialect);
    expect((await checkOwnerOnly(options)).private).toBe(false);
  });

  test.each(["client", "issuer", "vc"])("refuses non-owner %s constraints", async (attribute) => {
    const { options } = await fixture(
      "acp",
      {
        [FILE]: acp(
          FILE,
          dialect,
          `acp:agent acp:PublicAgent; acp:${attribute} <https://app.example/>`,
        ),
      },
      dialect,
    );
    const result = await checkOwnerOnly(options);
    expect(result.private).toBe(false);
    if (!result.private)
      expect(result.reasons[0]?.subject).toBe(
        dialect === "css" && attribute !== "vc" ? "origin/client-scoped" : "unknown",
      );
    expect(JSON.stringify(result)).not.toContain("https://app.example/");
  });

  test("ancestor member grants remain effective despite an own owner-only ACR", async () => {
    const { options } = await fixture(
      "acp",
      {
        [FILE]: acp(FILE, dialect),
        [FOLDER]: acp(
          FOLDER,
          dialect,
          "acp:agent acp:PublicAgent",
          undefined,
          "acp:memberAccessControl",
        ),
      },
      dialect,
    );
    expect((await checkOwnerOnly(options)).private).toBe(false);
  });

  test("checks the own container's member policies", async () => {
    const { options } = await fixture(
      "acp",
      {
        [FOLDER]: acp(
          FOLDER,
          dialect,
          "acp:agent acp:PublicAgent",
          undefined,
          "acp:memberAccessControl",
        ),
      },
      dialect,
      FOLDER,
    );
    expect((await checkOwnerOnly(options)).private).toBe(false);
  });

  test("refuses a missing own ACR", async () => {
    const { options } = await fixture("acp", { [FILE]: undefined }, dialect);
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
  });

  test("refuses a missing inherited ACR", async () => {
    const { options } = await fixture(
      "acp",
      { [FILE]: acp(FILE, dialect), [FOLDER]: undefined },
      dialect,
    );
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
  });

  test("refuses a matcherless policy beside the owner policy", async () => {
    const prefix = dialect === "css" ? "acl" : "acp";
    const text = `${acp(FILE, dialect)} <> acp:accessControl <#c2>. <#c2> acp:apply <#p2>.
      <#p2> acp:allow ${prefix}:Read.`;
    const { options } = await fixture("acp", { [FILE]: text }, dialect);
    expect(await checkOwnerOnly(options)).toEqual(refusal());
  });

  test("refuses an own ACR naming the resource non-canonically", async () => {
    const text = acp(FILE, dialect).replace(
      `acp:resource <${FILE}>`,
      `acp:resource <${FILE.replace("pod.example", "POD.example")}>`,
    );
    const { options } = await fixture("acp", { [FILE]: text }, dialect);
    expect(await checkOwnerOnly(options)).toEqual(refusal());
  });

  test("never examines policies above a caller-supplied sub-root", async () => {
    // The real pim:Storage root publishes a public member policy. A sub-root is refused
    // rather than stopping the ancestor walk below it.
    const docs = {
      [ROOT]: acp(ROOT, dialect, "acp:agent acp:PublicAgent", undefined, "acp:memberAccessControl"),
      [FOLDER]: acp(FOLDER, dialect, undefined, undefined, "acp:memberAccessControl"),
      [FILE]: acp(FILE, dialect),
    };
    const sub = await fixture("acp", docs, dialect, FILE, FOLDER);
    expect(await checkOwnerOnly(sub.options)).toEqual(refusal("not-storage-root"));
    const real = await fixture("acp", docs, dialect);
    expect((await checkOwnerOnly(real.options)).private).toBe(false);
  });

  test("rejects unknown modes and policies lacking positive matchers", async () => {
    for (const text of [
      acp(FILE, dialect, undefined, "acp:Delete"),
      acp(FILE, dialect).replace("acp:allOf <#matcher>", "acp:noneOf <#matcher>"),
    ]) {
      const { options } = await fixture("acp", { [FILE]: text }, dialect);
      expect(await checkOwnerOnly(options)).toEqual(refusal());
    }
  });
});

test.each(["css", "ess"] as const)("%s refuses too-complex policies", async (dialect) => {
  const agents = Array.from({ length: 9 }, (_, i) => `<https://agent.example/${i}>`).join(", ");
  const text = acp(FILE, dialect).replace(
    "acp:allOf <#matcher>",
    `acp:allOf [acp:agent ${agents}], [acp:agent ${agents}]`,
  );
  const { options } = await fixture("acp", { [FILE]: text }, dialect);
  expect(await checkOwnerOnly(options)).toEqual(refusal());
});

test("ESS supports implicit canonical roots and refuses dropped resource Control", async () => {
  const accepted = await fixture(
    "acp",
    { [ROOT]: acp(ROOT, "ess").replace(`acp:resource <${ROOT}>;`, "") },
    "ess",
    ROOT,
  );
  expect(await checkOwnerOnly(accepted.options)).toEqual({ private: true });
  const refusedControl = await fixture(
    "acp",
    { [FILE]: acp(FILE, "ess", "acp:agent acp:PublicAgent", "acp:Control") },
    "ess",
  );
  expect(await checkOwnerOnly(refusedControl.options)).toEqual(refusal());
});

test("ESS refuses a dropped non-owner Control grant despite owner access", async () => {
  const text = `${acp(FILE, "ess")} <> acp:accessControl <#c2>. <#c2> acp:apply <#p2>.
    <#p2> acp:allow acp:Control; acp:allOf <#m2>. <#m2> acp:agent <${BOB}>.`;
  const { options } = await fixture("acp", { [FOLDER]: acp(FOLDER, "ess"), [FILE]: text }, "ess");
  expect(await checkOwnerOnly(options)).toEqual(refusal());
});

describe("the storage root must be a real pim:Storage", () => {
  test.each([
    ["no type", undefined],
    ["another type", "http://www.w3.org/ns/ldp#BasicContainer"],
  ])("refuses a root with %s", async (_, type) => {
    const { options, storage } = await fixture("acp", { [ROOT]: acp(ROOT, "css") }, "css", ROOT);
    const head = await storage.head(ROOT);
    const links = new Map(head.links);
    if (type) links.set("type", [{ target: type, params: {} }]);
    else links.delete("type");
    headOf(storage, ROOT, { links });
    expect(await checkOwnerOnly(options)).toEqual(refusal("not-storage-root"));
    expect(storage.read).not.toHaveBeenCalled();
  });

  test("WAC refuses reaching a sub-root but accepts a nearer own ACL", async () => {
    const reaching = await fixture(
      "wac",
      { [FILE]: undefined, [FOLDER]: wac(FOLDER, undefined, "acl:Read", "acl:default") },
      "css",
      FILE,
      FOLDER,
    );
    expect(await checkOwnerOnly(reaching.options)).toEqual(refusal("not-storage-root"));
    const own = await fixture("wac", { [FILE]: wac(FILE) }, "css", FILE, FOLDER);
    expect(await checkOwnerOnly(own.options)).toEqual({ private: true });
  });
});

test("ESS ACR management by a non-owner fails closed", async () => {
  const text = `<> a acp:AccessControlResource; acp:resource <${ROOT}>; acp:access <#policy>.
    <#policy> acp:allow acp:Read, acp:Write; acp:allOf [acp:agent acp:PublicAgent].`;
  const { options } = await fixture("acp", { [ROOT]: text }, "ess", ROOT);
  expect(await checkOwnerOnly(options)).toEqual({
    private: false,
    reasons: [{ subject: "public", modes: ["control"], reason: "non-owner" }],
  });
});

test.each(["Read", "Write"])("ESS partial ACR management %s is unrepresentable", async (mode) => {
  const text = `<> a acp:AccessControlResource; acp:resource <${ROOT}>; acp:access <#policy>.
    <#policy> acp:allow acp:${mode}; acp:allOf [acp:agent acp:PublicAgent].`;
  const { options } = await fixture("acp", { [ROOT]: text }, "ess", ROOT);
  expect(await checkOwnerOnly(options)).toEqual(refusal());
});

describe("discovery and transport fail closed", () => {
  test("a GET 404 after a present ACL HEAD never falls back to private defaults", async () => {
    const { storage, options } = await fixture("wac", {
      [FILE]: wac(FILE),
      [FOLDER]: wac(FOLDER, `acl:agent <${OWNER}>`, "acl:Read", "acl:default"),
    });
    vi.mocked(storage.read).mockRejectedValue(
      new StorageError("not-found", {
        url: FILE,
        method: "GET",
        status: 404,
      }),
    );
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
    expect(storage.head).not.toHaveBeenCalledWith(FOLDER, { revalidate: true });
  });

  test("an unreadable ACL HEAD never falls back to private defaults", async () => {
    const { storage, options, endpoints } = await fixture("wac", {
      [FILE]: wac(FILE),
      [FOLDER]: wac(FOLDER, `acl:agent <${OWNER}>`, "acl:Read", "acl:default"),
    });
    const head = await storage.head(FILE);
    vi.mocked(storage.head).mockImplementation(async (url) => {
      if (url === endpoints.get(FILE))
        throw new StorageError("forbidden", { url, method: "HEAD", status: 403 });
      return head;
    });
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
    expect(storage.read).not.toHaveBeenCalled();
  });

  test.each([
    null,
    "",
    " ",
    "*",
    "bad-validator",
  ])("refuses unusable access HEAD validator %s", async (etag) => {
    const { options, storage, endpoints } = await fixture();
    const ownHead = await storage.head(FILE);
    const accessHead = await storage.head(endpoints.get(FILE) as string);
    vi.mocked(storage.head).mockImplementation(async (url) =>
      url === FILE ? ownHead : { ...accessHead, etag },
    );
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
    expect(storage.read).not.toHaveBeenCalled();
  });

  test.each(["redirect", "partial"])("refuses %s access document HEAD", async (issue) => {
    const { options, storage, endpoints } = await fixture();
    const ownHead = await storage.head(FILE);
    const accessHead = await storage.head(endpoints.get(FILE) as string);
    vi.mocked(storage.head).mockImplementation(async (url) =>
      url === FILE
        ? ownHead
        : {
            ...accessHead,
            ...(issue === "redirect" ? { url: ROOT } : { status: 206 as const }),
          },
    );
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
  });

  test.each([401, 403, 404, 410, 500])("unreadable ACL status %s", async (status) => {
    const { storage, options } = await fixture();
    vi.mocked(storage.read).mockRejectedValue(
      new StorageError("forbidden", { url: "urn:redacted", method: "GET", status }),
    );
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
  });

  test.each([
    new Error("secret policy text"),
    new StorageError("network", { url: FILE, method: "GET" }),
  ])("network errors never become private", async (error) => {
    const { storage, options } = await fixture();
    vi.mocked(storage.head).mockRejectedValue(error);
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
  });

  test.each(["lws", "none", "unavailable"])("unsupported model %s", async (kind) => {
    const { storage, options } = await fixture();
    if (kind === "lws") Object.assign(storage, { protocol: "lws" });
    else if (kind === "none")
      Object.assign(storage.features, {
        accessControl: { state: "available", detail: { model: "none" } },
      });
    else Object.assign(storage.features, { accessControl: { state: "unavailable" } });
    expect(await checkOwnerOnly(options)).toEqual(refusal("unsupported-model"));
    expect(storage.head).not.toHaveBeenCalled();
  });

  test("ACP requires an explicit trusted dialect", async () => {
    const { options, storage } = await fixture("acp", { [FILE]: acp(FILE, "css") });
    delete options.acpDialect;
    expect(await checkOwnerOnly(options)).toEqual(refusal());
    expect(storage.head).not.toHaveBeenCalled();
  });

  test("refuses contradictory WAC capability and ACP discovery", async () => {
    const { options, storage } = await fixture();
    const head = await storage.head(FILE);
    // Both relations name the same readable ACL, so only the model contradiction refuses.
    headOf(storage, FILE, {
      links: new Map([...head.links, [`${ACP}accessControl`, head.links.get("acl") ?? []]]),
    });
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
    expect(storage.read).not.toHaveBeenCalled();
  });

  test("reads ESS query-addressed access documents", async () => {
    const { options, storage, memory, endpoints } = await fixture(
      "acp",
      { [ROOT]: acp(ROOT, "ess") },
      "ess",
      ROOT,
    );
    const head = await storage.head(ROOT);
    const read = await memory.read(endpoints.get(ROOT) as string);
    const endpoint = `${ROOT}?ext=acr`;
    vi.mocked(storage.head).mockImplementation(async (url) =>
      url === ROOT
        ? {
            ...head,
            links: new Map([
              ["acl", [{ target: endpoint, params: {} }]],
              ["type", [{ target: PIM_STORAGE, params: {} }]],
            ]),
          }
        : { ...head, url, etag: read.etag },
    );
    vi.mocked(storage.read).mockResolvedValue({ ...read, url: endpoint });
    // Preserve absolute resource binding; the parser still sees the independently authored graph.
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
    expect(storage.read).toHaveBeenCalledWith(endpoint, ACCEPT);
  });

  test.each([
    "urn:owner",
    "https://user:secret@example/#me",
    "invalid",
    "https://exa mple/#me",
  ])("invalid owner %s", async (ownerWebId) => {
    const { options } = await fixture();
    expect(await checkOwnerOnly({ ...options, ownerWebId })).toEqual(refusal("unknown"));
  });

  test.each([
    "missing",
    "multiple",
    "outside",
    "storage-scope",
    "redirect",
    "partial-head",
  ])("refuses %s discovery", async (issue) => {
    const { options, storage } = await fixture();
    const head = await storage.head(FILE);
    const links = new Map(head.links);
    if (issue === "missing") links.clear();
    if (issue === "multiple")
      links.set("acl", [
        { target: `${ROOT}a.acl`, params: {} },
        { target: `${ROOT}b.acl`, params: {} },
      ]);
    if (issue === "outside")
      links.set("acl", [{ target: "https://other.example/access", params: {} }]);
    if (issue === "storage-scope") storage.isWithinStorage = () => false;
    // Only the resource HEAD changes: the advertised ACL stays readable and owner-only.
    headOf(storage, FILE, {
      links,
      ...(issue === "redirect" ? { url: ROOT } : {}),
      ...(issue === "partial-head" ? { status: 206 as const } : {}),
    });
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
    expect(storage.read).not.toHaveBeenCalled();
  });

  test("accepts ACP relation links and duplicate references to one endpoint", async () => {
    const { options, storage } = await fixture("acp", { [ROOT]: acp(ROOT, "css") }, "css", ROOT);
    const head = await storage.head(ROOT);
    const accessHead = await storage.head(head.links.get("acl")?.[0]?.target as string);
    vi.mocked(storage.head).mockImplementation(async (url) =>
      url === ROOT
        ? {
            ...head,
            links: new Map([
              [`${ACP}accessControl`, head.links.get("acl") ?? []],
              ["type", [{ target: PIM_STORAGE, params: {} }]],
            ]),
          }
        : accessHead,
    );
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
    vi.mocked(storage.head).mockImplementation(async (url) =>
      url === ROOT
        ? {
            ...head,
            links: new Map([...head.links, [`${ACP}accessControl`, head.links.get("acl") ?? []]]),
          }
        : accessHead,
    );
    expect(await checkOwnerOnly(options)).toEqual({ private: true });
  });

  test.each([
    "empty",
    "304",
    "206",
    "wrong-url",
    "untyped",
    "not-rdf",
    "invalid-utf8",
    "too-many-quads",
    "stale-etag",
  ])("refuses %s representations", async (issue) => {
    const { options, storage, endpoints } = await fixture();
    let read = await storage.read(endpoints.get(FILE) as string);
    if (issue === "empty") read = withBody(read, "");
    if (issue === "304") read.status = 304;
    if (issue === "206") read.status = 206;
    if (issue === "wrong-url") read.url = ROOT;
    if (issue === "untyped") read.contentType = null;
    if (issue === "not-rdf") read.contentType = "text/plain";
    if (issue === "invalid-utf8") read = withBody(read, new Uint8Array([0x3c, 0xff, 0x3e]));
    if (issue === "too-many-quads") {
      const objects = Array.from({ length: 10_001 }, (_, i) => `<urn:o${i}>`).join(", ");
      read = withBody(read, `${PREFIX}${wac(FILE)} <urn:s> <urn:p> ${objects}.`);
    }
    if (issue === "stale-etag") read.etag = '"stale-private-policy"';
    vi.mocked(storage.read).mockResolvedValue(read);
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
  });

  test.each([
    [1_048_576, true],
    [1_048_577, false],
  ])("caps access documents at 1 MiB (%s bytes)", async (size, accepted) => {
    const text = wac(FILE);
    const padding = "x".repeat(size - Buffer.byteLength(PREFIX + text) - 3);
    const { options } = await fixture("wac", { [FILE]: `${text}\n#${padding}\n` });
    expect(await checkOwnerOnly(options)).toEqual(
      accepted ? { private: true } : refusal("unknown"),
    );
  });

  test("refuses named graphs through the existing RDF parser", async () => {
    const { options, storage, memory, endpoints } = await fixture();
    const original = await storage.read(endpoints.get(FILE) as string);
    const graph = await memory.create(ROOT, `${PREFIX}<urn:graph> { ${wac(FILE)} }`, {
      name: "graph.trig",
      contentType: "application/trig",
    });
    const read = await memory.read(graph.url);
    vi.mocked(storage.read).mockImplementation(async (url) => ({
      ...read,
      url,
      etag: original.etag,
    }));
    expect(await checkOwnerOnly(options)).toEqual(refusal());
  });

  test("no ancestor ACL establishes no privacy evidence", async () => {
    const { options } = await fixture("wac", {
      [FILE]: undefined,
      [FOLDER]: undefined,
      [ROOT]: undefined,
    });
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
  });

  test("bounds ancestor traversal", async () => {
    const url = `${ROOT}${"child/".repeat(65)}file`;
    const { options, storage } = await fixture("wac", {}, "css", url);
    expect(await checkOwnerOnly(options)).toEqual(refusal("unknown"));
    expect(storage.head).toHaveBeenCalledTimes(128);
  });
});
