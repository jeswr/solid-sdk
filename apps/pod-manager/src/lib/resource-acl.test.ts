// AUTHORED-BY Claude Opus 5.5
//
// Security-critical: this is authorization. The Sharing panel's model runs on
// `@jeswr/pod-access/roles`; these tests drive the full read → edit → re-read
// round trip against an in-memory pod and assert the exact ACL writes
// (conditional headers, preserved grants, refusals that write nothing).

import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { type AclPod, aclPod } from "./__fixtures__/acl-pod.js";
import { NotAuthenticatedError, SharingError } from "./errors.js";
import {
  type AccessSubject,
  type ResourceAccess,
  RoleResourceSharingBackend,
  subjectKey,
  toSharingError,
  wouldLockOutOwner,
} from "./resource-acl.js";

const POD = "https://alice.example/";
const OWNER = "https://alice.example/profile/card#me";
const FRIEND = "https://bob.example/profile/card#me";
const CAROL = "https://carol.example/profile/card#me";
const NOTES = `${POD}notes/`;
const NOTE = `${NOTES}note.ttl`;
const FOAF_AGENT = "http://xmlns.com/foaf/0.1/Agent";

const PREFIXES = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
`;
const OWNER_RULE = (target: string, folder: boolean) => `
<#owner> a acl:Authorization ; acl:agent <${OWNER}> ; acl:accessTo <${target}> ;
  ${folder ? `acl:default <${target}> ;` : ""} acl:mode acl:Read, acl:Write, acl:Append, acl:Control .`;

/** The note's own ACL: owner + a viewer friend. */
const NOTE_ACL = `${PREFIXES}${OWNER_RULE(NOTE, false)}
<#friend> a acl:Authorization ; acl:agent <${FRIEND}> ; acl:accessTo <${NOTE}> ; acl:mode acl:Read .`;

/** The notes folder: owner + a friend editor + public read, all folder-wide. */
const NOTES_ACL = `${PREFIXES}${OWNER_RULE(NOTES, true)}
<#friend> a acl:Authorization ; acl:agent <${FRIEND}> ;
  acl:accessTo <${NOTES}> ; acl:default <${NOTES}> ; acl:mode acl:Read, acl:Write .
<#public> a acl:Authorization ; acl:agentClass foaf:Agent ;
  acl:accessTo <${NOTES}> ; acl:default <${NOTES}> ; acl:mode acl:Read .`;

const ROOT_ACL = `${PREFIXES}${OWNER_RULE(POD, true)}`;

function pod(acls: Record<string, string>): AclPod {
  return aclPod([POD, NOTES, NOTE], { [`${POD}.acl`]: ROOT_ACL, ...acls });
}

function backend(p: AclPod) {
  return new RoleResourceSharingBackend(OWNER, p.fetch, POD);
}

async function aclOf(p: AclPod, aclUrl: string): Promise<AclResource> {
  const doc = p.docs.get(aclUrl);
  if (!doc) throw new Error(`no ACL at ${aclUrl}`);
  const dataset = await parseRdf(doc.body, "text/turtle", { baseIRI: aclUrl });
  return new AclResource(dataset, DataFactory);
}

/** The modes each agent IRI holds on `target` in a parsed ACL (accessTo rules). */
function modesByAgent(acl: AclResource, target: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const auth of acl.authorizations) {
    if (auth.accessTo !== target) continue;
    const modes: string[] = [];
    if (auth.canRead) modes.push("read");
    if (auth.canAppend) modes.push("append");
    if (auth.canWrite) modes.push("write");
    if (auth.canReadWriteAcl) modes.push("control");
    for (const agent of auth.agent) out.set(agent, [...(out.get(agent) ?? []), ...modes]);
    for (const cls of auth.agentClass) out.set(cls, [...(out.get(cls) ?? []), ...modes]);
  }
  return out;
}

function levelOf(access: ResourceAccess, subject: AccessSubject) {
  return access.entries.find((e) => subjectKey(e.subject) === subjectKey(subject));
}

const friend: AccessSubject = { kind: "agent", id: FRIEND };
const carol: AccessSubject = { kind: "agent", id: CAROL };
const anyone: AccessSubject = { kind: "public", id: "" };

describe("RoleResourceSharingBackend.read", () => {
  it("projects the resource's own ACL onto direct role rows, owner first", async () => {
    const p = pod({ [`${NOTE}.acl`]: NOTE_ACL });
    const access = await backend(p).read(NOTE);
    expect(access.inherited).toBe(false);
    expect(access.entries.map((e) => [e.subject.id, e.level, e.source])).toEqual([
      [OWNER, "manager", "direct"],
      [FRIEND, "viewer", "direct"],
    ]);
    expect(access.entries[0].sourceUrl).toBe(`${NOTE}.acl`);
    expect(p.puts()).toHaveLength(0);
  });

  it("reports inherited rows (and their governing ACL) when the item has no own ACL", async () => {
    const p = pod({ [`${NOTES}.acl`]: NOTES_ACL });
    const access = await backend(p).read(NOTE);
    expect(access.inherited).toBe(true);
    expect(levelOf(access, friend)).toMatchObject({
      level: "editor",
      source: "inherited",
      sourceUrl: `${NOTES}.acl`,
    });
    expect(levelOf(access, anyone)).toMatchObject({ level: "viewer", source: "inherited" });
  });

  it("never rounds a partial (append-only) grant up to a role", async () => {
    const p = pod({
      [`${NOTE}.acl`]: `${NOTE_ACL}
<#carol> a acl:Authorization ; acl:agent <${CAROL}> ; acl:accessTo <${NOTE}> ; acl:mode acl:Append .`,
    });
    const access = await backend(p).read(NOTE);
    expect(levelOf(access, carol)).toBeUndefined();
    expect(access.entries).toHaveLength(2);
  });

  it("refuses origin-restricted rules rather than showing them as plain access", async () => {
    const p = pod({
      [`${NOTE}.acl`]: `${NOTE_ACL}
<#app> a acl:Authorization ; acl:agent <${CAROL}> ; acl:origin <https://app.example> ;
  acl:accessTo <${NOTE}> ; acl:mode acl:Read .`,
    });
    const error = await backend(p)
      .read(NOTE)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SharingError);
    expect((error as SharingError).code).toBe("unsupported");
  });

  it("refuses a folder whose own access differs between the folder and its contents", async () => {
    const p = pod({
      [`${NOTES}.acl`]: `${PREFIXES}${OWNER_RULE(NOTES, true)}
<#public> a acl:Authorization ; acl:agentClass foaf:Agent ; acl:accessTo <${NOTES}> ; acl:mode acl:Read .`,
    });
    const error = await backend(p)
      .read(NOTES)
      .catch((e: unknown) => e);
    expect((error as SharingError).code).toBe("partial-scope");
  });

  it("wraps transport failures as a SharingError('failed')", async () => {
    const failing = new RoleResourceSharingBackend(OWNER, async () => {
      throw new TypeError("network down");
    });
    const error = await failing.read(NOTE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SharingError);
    expect((error as SharingError).code).toBe("failed");
  });

  it("requires a signed-in WebID", () => {
    expect(() => new RoleResourceSharingBackend("", fetch)).toThrow(NotAuthenticatedError);
  });
});

describe("RoleResourceSharingBackend.setAccess", () => {
  it("adds a person with a conditional PUT and keeps everyone else", async () => {
    const p = pod({ [`${NOTE}.acl`]: NOTE_ACL });
    const b = backend(p);
    const etag = p.docs.get(`${NOTE}.acl`)?.etag;
    await b.setAccess(await b.read(NOTE), carol, "editor");

    const [put] = p.puts();
    expect(put.url).toBe(`${NOTE}.acl`);
    expect(put.headers["if-match"]).toBe(etag);
    expect(put.headers["content-type"]).toBe("text/turtle");
    const modes = modesByAgent(await aclOf(p, `${NOTE}.acl`), NOTE);
    expect(modes.get(CAROL)?.sort()).toEqual(["append", "read", "write"]);
    expect(modes.get(FRIEND)).toEqual(["read"]);
    expect(modes.get(OWNER)).toContain("control");
    expect(levelOf(await b.read(NOTE), carol)?.level).toBe("editor");
  });

  it("lowers a level (editor → viewer) without touching other rows", async () => {
    const p = pod({
      [`${NOTE}.acl`]: NOTE_ACL.replace("acl:mode acl:Read .", "acl:mode acl:Read, acl:Write ."),
    });
    const b = backend(p);
    const before = await b.read(NOTE);
    expect(levelOf(before, friend)?.level).toBe("editor");
    await b.setAccess(before, friend, "viewer");
    const modes = modesByAgent(await aclOf(p, `${NOTE}.acl`), NOTE);
    expect(modes.get(FRIEND)).toEqual(["read"]);
    expect(modes.get(OWNER)?.sort()).toEqual(["append", "control", "read", "write"]);
  });

  it("materialises inherited access into a new own ACL (If-None-Match: *) on the first change", async () => {
    const p = pod({ [`${NOTES}.acl`]: NOTES_ACL });
    const b = backend(p);
    await b.setAccess(await b.read(NOTE), carol, "viewer");

    const [put] = p.puts();
    expect(put.url).toBe(`${NOTE}.acl`);
    expect(put.headers["if-none-match"]).toBe("*");
    expect(put.headers["if-match"]).toBeUndefined();
    const after = await b.read(NOTE);
    expect(after.inherited).toBe(false);
    // Nobody loses the access they inherited.
    expect(levelOf(after, friend)?.level).toBe("editor");
    expect(levelOf(after, anyone)?.level).toBe("viewer");
    expect(levelOf(after, { kind: "agent", id: OWNER })?.level).toBe("manager");
    expect(levelOf(after, carol)).toMatchObject({ level: "viewer", source: "direct" });
    // The folder's own ACL is never edited.
    expect(p.docs.get(`${NOTES}.acl`)?.body).toBe(NOTES_ACL);
  });

  it("gives folder levels to the folder AND its contents (accessTo + default)", async () => {
    const p = pod({ [`${NOTES}.acl`]: NOTES_ACL });
    const b = backend(p);
    await b.setAccess(await b.read(NOTES), carol, "viewer");
    const acl = await aclOf(p, `${NOTES}.acl`);
    const carolRules = [...acl.authorizations].filter((a) => a.agent.has(CAROL));
    expect(carolRules).toHaveLength(1);
    expect(carolRules[0].accessTo).toBe(NOTES);
    expect(carolRules[0].default).toBe(NOTES);
    expect(carolRules[0].canRead).toBe(true);
    expect(carolRules[0].canWrite).toBe(false);
  });

  it("turns on public read for an item", async () => {
    const p = pod({ [`${NOTE}.acl`]: NOTE_ACL });
    const b = backend(p);
    await b.setAccess(await b.read(NOTE), anyone, "viewer");
    const modes = modesByAgent(await aclOf(p, `${NOTE}.acl`), NOTE);
    expect(modes.get(FOAF_AGENT)).toEqual(["read"]);
  });

  const WITH_PARTIAL = `${NOTE_ACL.replace("acl:mode acl:Read .", "acl:mode acl:Read, acl:Write .")}
<#carol> a acl:Authorization ; acl:agent <${CAROL}> ; acl:accessTo <${NOTE}> ; acl:mode acl:Append .`;

  it("keeps a partial grant it cannot show when raising someone else", async () => {
    const p = pod({ [`${NOTE}.acl`]: WITH_PARTIAL });
    const b = backend(p);
    await b.setAccess(await b.read(NOTE), friend, "manager");
    const modes = modesByAgent(await aclOf(p, `${NOTE}.acl`), NOTE);
    expect(modes.get(CAROL)).toEqual(["append"]);
    expect(modes.get(FRIEND)?.sort()).toEqual(["append", "control", "read", "write"]);
  });

  it("refuses a lowering that would silently drop a partial grant, writing nothing", async () => {
    const p = pod({ [`${NOTE}.acl`]: WITH_PARTIAL });
    const b = backend(p);
    const error = await b.setAccess(await b.read(NOTE), friend, "viewer").catch((e: unknown) => e);
    expect((error as SharingError).code).toBe("unsupported");
    expect(p.puts()).toHaveLength(0);
  });

  it("refuses a lowering against a stale snapshot as a conflict and writes nothing", async () => {
    const p = pod({
      [`${NOTE}.acl`]: NOTE_ACL.replace("acl:mode acl:Read .", "acl:mode acl:Read, acl:Write ."),
    });
    const b = backend(p);
    const stale = await b.read(NOTE);
    p.setAcl(`${NOTE}.acl`, `${p.docs.get(`${NOTE}.acl`)?.body}\n`); // a concurrent edit
    const error = await b.setAccess(stale, friend, "viewer").catch((e: unknown) => e);
    expect((error as SharingError).code).toBe("conflict");
    expect(p.puts()).toHaveLength(0);
  });

  it("refuses to downgrade your own Owner and sends no request", async () => {
    const p = pod({ [`${NOTE}.acl`]: NOTE_ACL });
    const b = backend(p);
    const access = await b.read(NOTE);
    const sent = p.requests.length;
    const error = await b
      .setAccess(access, { kind: "agent", id: OWNER }, "editor")
      .catch((e: unknown) => e);
    expect((error as SharingError).code).toBe("owner-lockout");
    expect(p.requests).toHaveLength(sent);
  });

  it("surfaces a rejected PUT (403) as a SharingError", async () => {
    const p = pod({ [`${NOTE}.acl`]: NOTE_ACL });
    const b = backend(p);
    p.failNextPuts(403);
    const error = await b.setAccess(await b.read(NOTE), carol, "viewer").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SharingError);
    expect((error as SharingError).code).toBe("invalid-response");
    expect(p.docs.get(`${NOTE}.acl`)?.body).toBe(NOTE_ACL);
  });
});

describe("RoleResourceSharingBackend.removeAccess", () => {
  it("removes a directly granted person and keeps the owner", async () => {
    const p = pod({ [`${NOTE}.acl`]: NOTE_ACL });
    const b = backend(p);
    const etag = p.docs.get(`${NOTE}.acl`)?.etag;
    await b.removeAccess(await b.read(NOTE), friend);
    expect(p.puts()[0].headers["if-match"]).toBe(etag);
    const modes = modesByAgent(await aclOf(p, `${NOTE}.acl`), NOTE);
    expect(modes.has(FRIEND)).toBe(false);
    expect(modes.get(OWNER)).toContain("control");
  });

  it("removes a partial grant too (revocation never leaves odd modes behind)", async () => {
    const p = pod({
      [`${NOTE}.acl`]: `${NOTE_ACL}
<#carol> a acl:Authorization ; acl:agent <${CAROL}> ; acl:accessTo <${NOTE}> ; acl:mode acl:Append .`,
    });
    const b = backend(p);
    await b.removeAccess(await b.read(NOTE), carol);
    expect(modesByAgent(await aclOf(p, `${NOTE}.acl`), NOTE).has(CAROL)).toBe(false);
  });

  it("refuses to remove inherited access from one item and writes nothing", async () => {
    const p = pod({ [`${NOTES}.acl`]: NOTES_ACL });
    const b = backend(p);
    const error = await b.removeAccess(await b.read(NOTE), friend).catch((e: unknown) => e);
    expect((error as SharingError).code).toBe("inherited-grant");
    expect(p.puts()).toHaveLength(0);
  });

  it("refuses to remove your own Owner", async () => {
    const p = pod({ [`${NOTE}.acl`]: NOTE_ACL });
    const b = backend(p);
    const error = await b
      .removeAccess(await b.read(NOTE), { kind: "agent", id: OWNER })
      .catch((e: unknown) => e);
    expect((error as SharingError).code).toBe("owner-lockout");
    expect(p.puts()).toHaveLength(0);
  });
});

describe("wouldLockOutOwner", () => {
  const access = (level: "viewer" | "editor" | "manager"): ResourceAccess => ({
    resourceUrl: NOTE,
    inherited: false,
    entries: [
      {
        subject: { kind: "agent", id: OWNER },
        level,
        source: "direct",
        sourceUrl: `${NOTE}.acl`,
      },
    ],
    snapshot: { url: NOTE, grants: [] } as unknown as ResourceAccess["snapshot"],
  });
  const me: AccessSubject = { kind: "agent", id: OWNER };

  it("flags removing or lowering your own Owner", () => {
    expect(wouldLockOutOwner(access("manager"), OWNER, { subject: me, remove: true })).toBe(true);
    expect(wouldLockOutOwner(access("manager"), OWNER, { subject: me, level: "editor" })).toBe(
      true,
    );
  });

  it("allows keeping Owner, changing others, or changes when you are not Owner here", () => {
    expect(wouldLockOutOwner(access("manager"), OWNER, { subject: me, level: "manager" })).toBe(
      false,
    );
    expect(wouldLockOutOwner(access("manager"), OWNER, { subject: friend, remove: true })).toBe(
      false,
    );
    expect(wouldLockOutOwner(access("editor"), OWNER, { subject: me, level: "viewer" })).toBe(
      false,
    );
  });
});

describe("toSharingError", () => {
  it("keeps SharingErrors and classifies unknown failures as 'failed'", () => {
    const own = new SharingError("conflict", "x");
    expect(toSharingError(own)).toBe(own);
    const wrapped = toSharingError(new Error("boom"));
    expect(wrapped.code).toBe("failed");
    expect(wrapped.cause).toBeInstanceOf(Error);
  });
});
