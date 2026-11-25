// AUTHORED-BY Claude Sonnet 5.5
import type { LinkTarget, StorageClient } from "@jeswr/storage-client";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, test, vi } from "vitest";
import {
  checkOwnerOnly,
  checkOwnerOnlyAuto,
  detectAccessControl,
  isOwnerOnlyConflictError,
} from "./index.js";
import { ACL, ACP } from "./rdf.js";

const ROOT = "https://pod.example/alice/";
const FOLDER = `${ROOT}private/`;
const FILE = `${FOLDER}secret.ttl`;
const OWNER = "https://alice.example/#me";
const BOB = "https://bob.example/#me";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const PREFIX = `@prefix acl: <${ACL}>. @prefix acp: <${ACP}>. @prefix foaf: <http://xmlns.com/foaf/0.1/>.\n`;

const wac = (
  resource: string,
  selector = `acl:agent <${OWNER}>`,
  modes = "acl:Read, acl:Write, acl:Control",
  scope = "acl:accessTo",
) => `[] a acl:Authorization; ${scope} <${resource}>; ${selector}; acl:mode ${modes}.\n`;

const acp = (
  resource: string,
  dialect: "css" | "ess",
  matcher = `acp:agent <${OWNER}>`,
  scope = "acp:accessControl",
  modes = `${dialect === "css" ? "acl" : "acp"}:Read`,
) => `<> a acp:AccessControlResource; acp:resource <${resource}>; ${scope} <#control>.
<#control> acp:apply <#policy>.
<#policy> acp:allow ${modes}; acp:allOf <#matcher>.
<#matcher> ${matcher}.\n`;

type Doc = string | { text: string; contentType?: string | null; etag?: string | null } | Error;
interface Spec {
  /** Resource url to its link header targets (rel -> targets). */
  links: Record<string, Record<string, string[]>>;
  /** Access document url to content. Absent means 404. */
  docs: Record<string, Doc>;
}

/** WAC or ACP discovery metadata for resources. */
const aclLink = (url: string) => ({ acl: [`${url}.acl`] });
const acrLink = (url: string, relation = "acp") =>
  relation === "acp" ? { [`${ACP}accessControl`]: [`${url}.acr`] } : { acl: [`${url}.acr`] };

function pod(spec: Spec, overrides: { protocol?: string; root?: string } = {}) {
  const memory = createMemoryStorage({ root: ROOT });
  const root = overrides.root ?? ROOT;
  const base = {} as Awaited<ReturnType<StorageClient["head"]>>;
  const head = vi.fn(async (url: string) => {
    const doc = spec.docs[url];
    if (doc instanceof Error) throw doc;
    if (doc !== undefined)
      return {
        ...base,
        url,
        status: 200 as const,
        etag: typeof doc === "object" && "etag" in doc ? doc.etag : '"v1"',
        kind: "resource" as const,
        links: new Map<string, LinkTarget[]>(),
      };
    const rels = spec.links[url];
    if (!rels) throw new StorageError("not-found", { url, method: "HEAD", status: 404 });
    const links = new Map<string, LinkTarget[]>(
      Object.entries(rels).map(([rel, targets]) => [
        rel,
        targets.map((target) => ({ target, params: {} })),
      ]),
    );
    if (url === ROOT) links.set("type", [{ target: PIM_STORAGE, params: {} }]);
    return {
      ...base,
      url,
      status: 200 as const,
      etag: '"r"',
      kind: url.endsWith("/") ? ("container" as const) : ("resource" as const),
      links,
    };
  });
  const read = vi.fn(async (url: string) => {
    const doc = spec.docs[url] as Exclude<Doc, Error>;
    const text = typeof doc === "string" ? doc : doc.text;
    const o = typeof doc === "string" ? {} : doc;
    return {
      url,
      status: 200 as const,
      etag: o.etag === undefined ? '"v1"' : o.etag,
      contentType: o.contentType === undefined ? "text/turtle" : o.contentType,
      body: new Response(typeof doc === "string" ? PREFIX + text : text).body,
    };
  });
  const storage = {
    ...memory,
    root,
    protocol: overrides.protocol ?? "solid",
    head,
    read,
  } as unknown as StorageClient;
  return { storage, head, read, spec };
}

const options = (storage: StorageClient, url = FILE) => ({ storage, url, ownerWebId: OWNER });

/** A WAC pod where each resource advertises `<resource>.acl`. */
function wacPod(docs: Record<string, Doc>, resources = [FILE, FOLDER, ROOT]) {
  const links: Spec["links"] = {};
  for (const resource of resources) links[resource] = aclLink(resource);
  const mapped: Record<string, Doc> = {};
  for (const [resource, doc] of Object.entries(docs)) mapped[`${resource}.acl`] = doc;
  return pod({ links, docs: mapped });
}

const refusal = (reason: string) => ({
  private: false,
  reasons: [{ subject: "unknown", modes: [], reason }],
});

describe("detectAccessControl", () => {
  test("WAC from the resource's own ACL; names the deciding document", async () => {
    const { storage } = wacPod({ [FILE]: wac(FILE), [ROOT]: wac(ROOT) });
    expect(await detectAccessControl({ storage, url: FILE })).toEqual({
      model: "wac",
      decidedBy: `${FILE}.acl`,
    });
  });

  test("an absent WAC ACL is inherited from the nearest ancestor ACL", async () => {
    const { storage } = wacPod({ [ROOT]: wac(ROOT, undefined, "acl:Read", "acl:default") });
    expect(await detectAccessControl({ storage, url: FILE })).toEqual({
      model: "wac",
      decidedBy: `${ROOT}.acl`,
    });
  });

  test("nothing found up to the root is undecided", async () => {
    const { storage } = wacPod({});
    expect(await detectAccessControl({ storage, url: FILE })).toEqual({
      model: "undecided",
      reason: "no-access-document",
    });
  });

  test.each([
    ["css", "acl", "css"],
    ["ess", "acp", "ess"],
  ] as const)("ACP %s from the modes in the document, whatever the URL shape", async (dialect) => {
    // An ESS-looking URL on CSS-style content and the reverse: URLs never decide.
    const url = dialect === "css" ? `${FILE}?ext=acr` : `${FILE}.acr`;
    const { storage } = pod({
      links: { [FILE]: { [`${ACP}accessControl`]: [url] } },
      docs: { [url]: acp(FILE, dialect) },
    });
    expect(await detectAccessControl({ storage, url: FILE })).toEqual({
      model: "acp",
      dialect,
      decidedBy: url,
    });
  });

  test("ACP advertised only with rel=acl is still read from the document", async () => {
    const { storage } = pod({
      links: { [FILE]: acrLink(FILE, "acl") },
      docs: { [`${FILE}.acr`]: acp(FILE, "css") },
    });
    expect(await detectAccessControl({ storage, url: FILE })).toMatchObject({
      model: "acp",
      dialect: "css",
    });
  });

  test("a missing ACP resource is not inherited", async () => {
    const { storage } = pod({
      links: { [FILE]: acrLink(FILE), [ROOT]: acrLink(ROOT) },
      docs: { [`${ROOT}.acr`]: acp(ROOT, "css") },
    });
    expect(await detectAccessControl({ storage, url: FILE })).toEqual({
      model: "undecided",
      reason: "no-access-document",
    });
  });

  test.each([
    ["no modes", `<> a acp:AccessControlResource; acp:resource <${FILE}>.`],
    ["both vocabularies", `${acp(FILE, "css")}<#p2> acp:allow acp:Read.\n`],
    ["only unknown modes", acp(FILE, "css", undefined, undefined, "acp:Delete")],
  ])("ACP with %s: undecided dialect", async (_name, text) => {
    const { storage } = pod({
      links: { [FILE]: acrLink(FILE) },
      docs: { [`${FILE}.acr`]: text },
    });
    expect(await detectAccessControl({ storage, url: FILE })).toEqual({
      model: "undecided",
      reason: "ambiguous-dialect",
    });
  });

  test("denied modes count as dialect evidence", async () => {
    const { storage } = pod({
      links: { [FILE]: acrLink(FILE) },
      docs: {
        [`${FILE}.acr`]:
          "<#p> acp:deny acp:Write; acp:allOf <#m>. <#m> acp:agent <https://x.example/#a>.",
      },
    });
    expect(await detectAccessControl({ storage, url: FILE })).toMatchObject({ dialect: "ess" });
  });

  test("an acp:accessControl relation with a WAC document is mixed", async () => {
    const { storage } = pod({
      links: { [FILE]: acrLink(FILE) },
      docs: { [`${FILE}.acr`]: wac(FILE) },
    });
    expect(await detectAccessControl({ storage, url: FILE })).toEqual({
      model: "undecided",
      reason: "mixed-models",
    });
  });

  test("a document with ACP and WAC terms is mixed; an unrelated one is unrecognised", async () => {
    expect(
      await detectAccessControl({
        storage: wacPod({ [FILE]: wac(FILE) + acp(FILE, "css") }).storage,
        url: FILE,
      }),
    ).toEqual({ model: "undecided", reason: "mixed-models" });
    expect(
      await detectAccessControl({
        storage: wacPod({ [FILE]: "<#a> <https://x.example/p> 1." }).storage,
        url: FILE,
      }),
    ).toEqual({ model: "undecided", reason: "unrecognised-document" });
  });

  test("ACP terms in an object position show ACP", async () => {
    const { storage } = wacPod({ [FILE]: `<#a> <https://x.example/p> acp:Policy.` });
    expect(await detectAccessControl({ storage, url: FILE })).toMatchObject({
      reason: "ambiguous-dialect",
    });
  });

  test("401 and 403 on the access document are no-permission, never private", async () => {
    for (const status of [401, 403]) {
      const { storage } = wacPod({
        [FILE]: new StorageError(status === 401 ? "unauthenticated" : "forbidden", {
          url: `${FILE}.acl`,
          method: "HEAD",
          status,
        }),
      });
      expect(await detectAccessControl({ storage, url: FILE })).toEqual({
        model: "undecided",
        reason: "no-permission",
      });
      expect(await checkOwnerOnlyAuto(options(storage))).toMatchObject({
        private: false,
        reasons: [{ reason: "undecided" }],
        detected: { model: "undecided", reason: "no-permission" },
        evaluated: [],
      });
    }
  });

  test("other transport failures and unusable heads are unreadable", async () => {
    const failing = wacPod({
      [FILE]: new StorageError("server", { url: FILE, method: "HEAD", status: 500 }),
    });
    expect(await detectAccessControl({ storage: failing.storage, url: FILE })).toEqual({
      model: "undecided",
      reason: "unreadable",
    });
    const network = wacPod({ [FILE]: new StorageError("network", { url: FILE, method: "HEAD" }) });
    expect(await detectAccessControl({ storage: network.storage, url: FILE })).toEqual({
      model: "undecided",
      reason: "unreadable",
    });
    const moved = wacPod({ [FILE]: wac(FILE) });
    const original = moved.head.getMockImplementation() as (url: string) => Promise<object>;
    moved.head.mockImplementation(async (url: string) => ({
      ...(await original(url)),
      ...(url === FILE ? { url: `${FILE}-elsewhere` } : {}),
    }));
    expect(await detectAccessControl({ storage: moved.storage, url: FILE })).toEqual({
      model: "undecided",
      reason: "unreadable",
    });
  });

  test("not a Solid storage, or a URL outside the root", async () => {
    expect(
      await detectAccessControl({
        storage: pod({ links: {}, docs: {} }, { protocol: "lws" }).storage,
        url: FILE,
      }),
    ).toEqual({ model: "undecided", reason: "unsupported-protocol" });
    const { storage, head } = wacPod({ [FILE]: wac(FILE) });
    for (const url of ["https://evil.example/alice/x", `${ROOT}a/../b`, `${FILE}#frag`]) {
      expect(await detectAccessControl({ storage, url })).toEqual({
        model: "undecided",
        reason: "out-of-scope",
      });
    }
    expect(head).not.toHaveBeenCalled();
  });

  test("link headers pointing off-origin, out of storage or non-canonically are out-of-scope", async () => {
    for (const target of [
      "https://evil.example/alice/x.acl",
      "https://pod.example/other/x.acl",
      `${ROOT}a/%2e%2e/x.acl`,
    ]) {
      const { storage, read } = pod({
        links: { [FILE]: { acl: [target] } },
        docs: { [target]: wac(FILE) },
      });
      expect(await detectAccessControl({ storage, url: FILE })).toEqual({
        model: "undecided",
        reason: "out-of-scope",
      });
      expect(read).not.toHaveBeenCalled();
    }
    const inside = wacPod({ [FILE]: wac(FILE) });
    (inside.storage as { isWithinStorage: unknown }).isWithinStorage = () => false;
    expect(await detectAccessControl({ storage: inside.storage, url: FILE })).toEqual({
      model: "undecided",
      reason: "out-of-scope",
    });
  });

  test("no or several access links", async () => {
    expect(
      await detectAccessControl({
        storage: pod({ links: { [FILE]: {} }, docs: {} }).storage,
        url: FILE,
      }),
    ).toEqual({ model: "undecided", reason: "no-access-link" });
    expect(
      await detectAccessControl({
        storage: pod({
          links: { [FILE]: { acl: [`${FILE}.acl`, `${FILE}.other`] } },
          docs: {},
        }).storage,
        url: FILE,
      }),
    ).toEqual({ model: "undecided", reason: "ambiguous-link" });
  });

  describe("hostile documents", () => {
    const hostile = (doc: Doc) => wacPod({ [FILE]: doc }).storage;
    test.each([
      ["wrong content type", { text: PREFIX + wac(FILE), contentType: "text/html" }],
      ["no content type", { text: PREFIX + wac(FILE), contentType: null }],
      ["malformed turtle", { text: "<<<not turtle" }],
      ["invalid utf-8 / over 1 MiB", { text: "a".repeat(1_048_577) }],
      ["weak validator missing", { text: PREFIX + wac(FILE), etag: null }],
      ["bad validator", { text: PREFIX + wac(FILE), etag: "no-quotes" }],
      [
        "too many quads",
        {
          text: `${PREFIX}${Array.from({ length: 10_001 }, (_, i) => `<#s${i}> a <#t>.`).join("\n")}`,
        },
      ],
    ] as const)("%s is undecided, not private", async (_name, doc) => {
      const storage = hostile(doc as Doc);
      const detected = await detectAccessControl({ storage, url: FILE });
      expect(detected.model).toBe("undecided");
      const result = await checkOwnerOnlyAuto(options(storage));
      expect(result.private).toBe(false);
    });

    test("a body that does not match the revalidated validator is undecided", async () => {
      const { storage, read } = wacPod({ [FILE]: wac(FILE) });
      read.mockImplementation(async (url: string) => ({
        url,
        status: 200 as const,
        etag: '"changed"',
        contentType: "text/turtle",
        body: new Response(PREFIX + wac(FILE)).body,
      }));
      expect(await detectAccessControl({ storage, url: FILE })).toEqual({
        model: "undecided",
        reason: "invalid-document",
      });
    });

    test("relative IRIs resolving out of scope are refused by the check", async () => {
      const text = wac("../../../../escape/", `acl:agent <${OWNER}>`);
      const storage = hostile(text);
      expect(await checkOwnerOnlyAuto(options(storage))).toMatchObject({ private: false });
    });
  });
});

describe("checkOwnerOnlyAuto: WAC", () => {
  test("own ACL owner only: private, decided by the own ACL", async () => {
    const { storage } = wacPod({
      [FILE]: wac(FILE),
      [ROOT]: wac(ROOT, "acl:agentClass foaf:Agent"),
    });
    expect(await checkOwnerOnlyAuto(options(storage))).toEqual({
      private: true,
      detected: { model: "wac", decidedBy: `${FILE}.acl` },
      decidedBy: `${FILE}.acl`,
      evaluated: [`${FILE}.acl`],
    });
  });

  test("own ACL wins over a public default on the parent", async () => {
    const { storage } = wacPod({
      [FILE]: wac(FILE),
      [FOLDER]: wac(FOLDER, "acl:agentClass foaf:Agent", "acl:Read", "acl:default"),
    });
    expect((await checkOwnerOnlyAuto(options(storage))).private).toBe(true);
  });

  test("inherited ACL with acl:default and owner only: private, ancestor decides", async () => {
    const { storage } = wacPod({ [FOLDER]: wac(FOLDER, undefined, "acl:Read", "acl:default") });
    expect(await checkOwnerOnlyAuto(options(storage))).toMatchObject({
      private: true,
      decidedBy: `${FOLDER}.acl`,
      evaluated: [`${FOLDER}.acl`],
      detected: { model: "wac", decidedBy: `${FOLDER}.acl` },
    });
  });

  test("inherited ACL with acl:default granting the public: exposed, ancestor named", async () => {
    const { storage } = wacPod({
      [FOLDER]: wac(FOLDER, "acl:agentClass foaf:Agent", "acl:Read", "acl:default") + wac(FOLDER),
    });
    expect(await checkOwnerOnlyAuto(options(storage))).toMatchObject({
      private: false,
      reasons: [{ subject: "public", modes: ["read"], reason: "non-owner" }],
      decidedBy: `${FOLDER}.acl`,
    });
  });

  test("inherited ACL without acl:default: its accessTo-only public grant does not apply, but nothing is asserted private either", async () => {
    const { storage } = wacPod({
      [FOLDER]: wac(FOLDER, "acl:agentClass foaf:Agent", "acl:Read"),
      [ROOT]: wac(ROOT, undefined, "acl:Read", "acl:default"),
    });
    const result = await checkOwnerOnlyAuto(options(storage));
    expect(result).toMatchObject({ private: false, reasons: [{ reason: "unknown" }] });
    expect(result.decidedBy).toBeUndefined();
  });

  test.each([
    ["public read", "acl:agentClass foaf:Agent", "public"],
    ["authenticated agent read", "acl:agentClass acl:AuthenticatedAgent", "authenticated"],
    ["another agent", `acl:agent <${BOB}>`, "agent"],
    ["a group", "acl:agentGroup <https://groups.example/g>", "group"],
  ])("own ACL with %s is exposed", async (_name, selector, subject) => {
    const { storage } = wacPod({ [FILE]: wac(FILE) + wac(FILE, selector, "acl:Read") });
    expect(await checkOwnerOnlyAuto(options(storage))).toMatchObject({
      private: false,
      reasons: [{ subject, modes: ["read"] }],
      decidedBy: `${FILE}.acl`,
    });
  });

  test("the package's own provenance marker on a materialised rule is accepted, not refused", async () => {
    const marker = `<https://jeswr.org/ns/pod-access#materializedFrom> <${ROOT}.acl>`;
    const materialised = (selector: string) =>
      `[] a acl:Authorization; acl:accessTo <${FILE}>; ${selector}; acl:mode acl:Read; ${marker}.\n`;
    const owner = materialised(`acl:agent <${OWNER}>`);
    expect((await checkOwnerOnlyAuto(options(wacPod({ [FILE]: owner }).storage))).private).toBe(
      true,
    );
    expect(
      await checkOwnerOnlyAuto(
        options(wacPod({ [FILE]: owner + materialised("acl:agentClass foaf:Agent") }).storage),
      ),
    ).toMatchObject({ private: false, reasons: [{ subject: "public", modes: ["read"] }] });
  });

  test("a container's own acl:default applies to its members", async () => {
    const { storage } = wacPod({
      [FOLDER]: wac(FOLDER) + wac(FOLDER, "acl:agentClass foaf:Agent", "acl:Read", "acl:default"),
    });
    expect((await checkOwnerOnlyAuto(options(storage, FOLDER))).private).toBe(false);
    expect((await checkOwnerOnlyAuto(options(storage, FOLDER))).detected).toMatchObject({
      model: "wac",
    });
  });
});

describe("checkOwnerOnlyAuto: ACP", () => {
  const acpPod = (
    dialect: "css" | "ess",
    own: string,
    root = acp(ROOT, dialect, undefined, "acp:memberAccessControl"),
    folder = acp(FOLDER, dialect, undefined, "acp:memberAccessControl"),
  ) =>
    pod({
      links: { [FILE]: acrLink(FILE), [FOLDER]: acrLink(FOLDER), [ROOT]: acrLink(ROOT) },
      docs: { [`${FILE}.acr`]: own, [`${FOLDER}.acr`]: folder, [`${ROOT}.acr`]: root },
    }).storage;

  describe.each(["css", "ess"] as const)("%s", (dialect) => {
    test("owner only everywhere is private; the resource's own ACR decides", async () => {
      const result = await checkOwnerOnlyAuto(options(acpPod(dialect, acp(FILE, dialect))));
      expect(result).toMatchObject({
        private: true,
        detected: { model: "acp", dialect, decidedBy: `${FILE}.acr` },
        decidedBy: `${FILE}.acr`,
        evaluated: [`${FILE}.acr`, `${FOLDER}.acr`, `${ROOT}.acr`],
      });
    });

    test.each([
      ["public", "acp:agent acp:PublicAgent", "public"],
      ["authenticated", "acp:agent acp:AuthenticatedAgent", "authenticated"],
      ["another agent", `acp:agent <${BOB}>`, "agent"],
    ])("a %s matcher on the resource is exposed", async (_name, matcher, subject) => {
      const result = await checkOwnerOnlyAuto(
        options(acpPod(dialect, acp(FILE, dialect, matcher))),
      );
      expect(result).toMatchObject({
        private: false,
        reasons: [{ subject, modes: ["read"] }],
        decidedBy: `${FILE}.acr`,
      });
    });

    test("a public member policy on an ancestor is exposed and names that ACR", async () => {
      const result = await checkOwnerOnlyAuto(
        options(
          acpPod(
            dialect,
            acp(FILE, dialect),
            acp(ROOT, dialect, undefined, "acp:memberAccessControl"),
            acp(FOLDER, dialect, "acp:agent acp:PublicAgent", "acp:memberAccessControl"),
          ),
        ),
      );
      expect(result).toMatchObject({ private: false, decidedBy: `${FOLDER}.acr` });
    });

    test("a public policy on the resource itself only (not member) is exposed for that resource, but a member-only public policy is not applied to a file's own ACR", async () => {
      const ownPublic = await checkOwnerOnlyAuto(
        options(acpPod(dialect, acp(FILE, dialect, "acp:agent acp:PublicAgent"))),
      );
      expect(ownPublic.private).toBe(false);
    });

    test("an ancestor's resource-only policy does not apply to members", async () => {
      const result = await checkOwnerOnlyAuto(
        options(
          acpPod(
            dialect,
            acp(FILE, dialect),
            acp(ROOT, dialect, undefined, "acp:memberAccessControl"),
            acp(FOLDER, dialect, "acp:agent acp:PublicAgent", "acp:accessControl"),
          ),
        ),
      );
      expect(result.private).toBe(true);
    });
  });

  test("a missing ACR is never private", async () => {
    const storage = pod({
      links: { [FILE]: acrLink(FILE), [ROOT]: acrLink(ROOT) },
      docs: { [`${ROOT}.acr`]: acp(ROOT, "css", undefined, "acp:memberAccessControl") },
    }).storage;
    expect(await checkOwnerOnlyAuto(options(storage))).toMatchObject({
      private: false,
      reasons: [{ reason: "undecided" }],
      detected: { reason: "no-access-document" },
    });
  });
});

describe("checkOwnerOnlyAuto: document changes between detection and check", () => {
  test("is refused, with the detection reported", async () => {
    const { storage, read } = wacPod({ [FILE]: wac(FILE) });
    const original = read.getMockImplementation() as (url: string) => Promise<object>;
    let calls = 0;
    read.mockImplementation(async (url: string) => {
      calls++;
      if (calls === 1) return original(url);
      return {
        ...(await original(url)),
        body: new Response(PREFIX + acp(FILE, "css")).body,
      };
    });
    const result = await checkOwnerOnlyAuto(options(storage));
    expect(result).toEqual({
      ...refusal("unknown"),
      detected: { model: "wac", decidedBy: `${FILE}.acl` },
      evaluated: [],
    });
  });
});

describe("checkOwnerOnly explicit model and dialect", () => {
  const featuresOf = (storage: StorageClient, model: "wac" | "acp" | "none" | undefined) =>
    Object.assign(storage, {
      features: {
        ...storage.features,
        accessControl:
          model === undefined
            ? { state: "unknown", evidence: "none", detail: { model: "none" } }
            : { state: "available", evidence: "fixture", detail: { model } },
      },
    });

  test("the explicit model works without any discovered features", async () => {
    const { storage } = wacPod({ [FILE]: wac(FILE) });
    featuresOf(storage, undefined);
    expect(await checkOwnerOnly(options(storage))).toEqual(refusal("unsupported-model"));
    expect(await checkOwnerOnly({ ...options(storage), accessModel: "wac" })).toEqual({
      private: true,
    });
  });

  test("the explicit model wins over discovered features", async () => {
    const { storage } = wacPod({ [FILE]: wac(FILE) });
    featuresOf(storage, "acp");
    // Discovered ACP with no dialect is refused; the explicit WAC model wins and decides.
    expect(await checkOwnerOnly(options(storage))).toEqual(refusal("unrepresentable"));
    expect(await checkOwnerOnly({ ...options(storage), accessModel: "wac" })).toEqual({
      private: true,
    });
  });

  test("an explicit model that the document contradicts is a typed error, either way", async () => {
    const wacDocs = wacPod({ [FILE]: wac(FILE) }).storage;
    const error = await checkOwnerOnly({
      ...options(wacDocs),
      accessModel: "acp",
      acpDialect: "css",
    }).catch((e: unknown) => e);
    expect(isOwnerOnlyConflictError(error)).toBe(true);
    expect(error).toMatchObject({
      name: "OwnerOnlyConflictError",
      aspect: "model",
      explicit: "acp",
      shown: "wac",
    });
    expect(String((error as Error).message)).not.toContain(FILE);

    const acpDocs = pod({
      links: { [FILE]: acrLink(FILE) },
      docs: { [`${FILE}.acr`]: acp(FILE, "css") },
    }).storage;
    const reverse = await checkOwnerOnly({ ...options(acpDocs), accessModel: "wac" }).catch(
      (e: unknown) => e,
    );
    expect(reverse).toMatchObject({ aspect: "model", explicit: "wac", shown: "acp" });
  });

  test("an explicit WAC model on a resource advertising an ACP relation is a conflict, a discovered one a refusal", async () => {
    const storage = pod({
      links: { [FILE]: acrLink(FILE) },
      docs: { [`${FILE}.acr`]: acp(FILE, "css") },
    }).storage;
    await expect(checkOwnerOnly({ ...options(storage), accessModel: "wac" })).rejects.toMatchObject(
      {
        aspect: "model",
      },
    );
    featuresOf(storage, "wac");
    expect(await checkOwnerOnly(options(storage))).toEqual(refusal("unknown"));
  });

  test("an explicit dialect that the document contradicts is a typed error", async () => {
    const storage = pod({
      links: { [FILE]: acrLink(FILE) },
      docs: { [`${FILE}.acr`]: acp(FILE, "ess") },
    }).storage;
    await expect(
      checkOwnerOnly({ ...options(storage), accessModel: "acp", acpDialect: "css" }),
    ).rejects.toMatchObject({ aspect: "dialect", explicit: "css", shown: "ess" });
  });

  test("a discovered (not explicit) model that the document contradicts stays a refusal", async () => {
    const { storage } = wacPod({ [FILE]: acp(FILE, "css") });
    featuresOf(storage, "wac");
    expect(await checkOwnerOnly(options(storage))).toEqual(refusal("unrepresentable"));
  });

  test("conflict errors cannot be forged", () => {
    expect(isOwnerOnlyConflictError(Object.assign(new Error("x"), { aspect: "model" }))).toBe(
      false,
    );
    expect(isOwnerOnlyConflictError("x")).toBe(false);
    expect(isOwnerOnlyConflictError(null)).toBe(false);
  });
});
