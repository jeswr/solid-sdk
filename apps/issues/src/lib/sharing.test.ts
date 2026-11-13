// AUTHORED-BY Claude Opus 5.5
import { AclResource } from "@solid/object";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  assignGroupRole,
  assignRole,
  grantPublicRead,
  listRoleAssignments,
  revokeAccess,
  revokeCopiedAccess,
  SharingError,
} from "./sharing";

const POD = "https://pod.example/alice/";
const TRACKER = `${POD}issue-tracker/`;
const RES = `${TRACKER}issues.ttl`;
const ACL_URL = `${RES}.acl`;
const OWNER = "https://pod.example/alice/profile/card#me";
const BOB = "https://pod.example/bob/profile/card#me";
const CAROL = "https://pod.example/carol/profile/card#me";
const TEAM = `${TRACKER}tracker.ttl#team`;

const ACL = "http://www.w3.org/ns/auth/acl#";
const FOAF_AGENT = "http://xmlns.com/foaf/0.1/Agent";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

/**
 * A stateful in-memory WAC pod: every non-ACL resource advertises `<url>.acl`
 * as its `rel="acl"` document; ACL documents carry ETags and PUTs enforce
 * If-Match / If-None-Match: * like CSS. The pod root carries the owner's
 * inheritable control, as a fresh CSS pod does.
 */
function aclPod(acls: Record<string, string> = {}) {
  const docs = new Map<string, { body: string; etag: string }>();
  let version = 0;
  const put = (url: string, body: string) => docs.set(url, { body, etag: `"${++version}"` });
  put(
    `${POD}.acl`,
    `@prefix acl: <${ACL}>.
<${POD}.acl#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${POD}>; acl:default <${POD}>;
  acl:mode acl:Read, acl:Write, acl:Control.`,
  );
  for (const [url, body] of Object.entries(acls)) put(url, body);
  const calls: Call[] = [];
  let failNextPut = false;
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    calls.push({
      url,
      method,
      headers,
      body: typeof init.body === "string" ? init.body : undefined,
    });
    const isAcl = url.endsWith(".acl");
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: isAcl ? {} : { link: `<${url}.acl>; rel="acl"` },
      });
    }
    const doc = docs.get(url);
    if (method === "PUT") {
      if (failNextPut) {
        failNextPut = false;
        return new Response(null, { status: 412 });
      }
      const ok = doc ? headers.get("if-match") === doc.etag : headers.get("if-none-match") === "*";
      if (!ok) return new Response(null, { status: 412 });
      put(url, String(init.body));
      return new Response(null, { status: doc ? 205 : 201 });
    }
    if (!doc) return new Response("Not found", { status: 404 });
    return new Response(doc.body, {
      status: 200,
      headers: { "content-type": "text/turtle", etag: doc.etag },
    });
  };
  return {
    impl: impl as unknown as typeof fetch,
    calls,
    puts: () => calls.filter((c) => c.method === "PUT"),
    acl: (url: string) => docs.get(url)?.body,
    failNextPut: () => {
      failNextPut = true;
    },
  };
}

/** Who holds which modes in an ACL document, read through the typed WAC classes. */
function authorizations(body: string | undefined, aclUrl: string) {
  expect(body).toBeDefined();
  const store = new Store(new Parser({ baseIRI: aclUrl }).parse(body ?? ""));
  return [...new AclResource(store, DataFactory).authorizations].map((auth) => ({
    agents: [...auth.agent],
    group: auth.agentGroup?.value,
    public: auth.accessibleToAny,
    modes: [...auth.mode].map((m) => m.replace(ACL, "")).sort(),
    accessTo: auth.accessTo,
    default: auth.default,
  }));
}

/** The union of modes a principal holds on `target` (accessTo) in an ACL document. */
function modesOf(
  body: string | undefined,
  aclUrl: string,
  principal: string,
  target: string,
): string[] {
  const modes = new Set<string>();
  for (const a of authorizations(body, aclUrl)) {
    const matches =
      a.agents.includes(principal) ||
      a.group === principal ||
      (principal === FOAF_AGENT && a.public);
    if (matches && a.accessTo === target) for (const m of a.modes) modes.add(m);
  }
  return [...modes].sort();
}

const trackerAcl = (editor: string) => `@prefix acl: <${ACL}>.
<${TRACKER}.acl#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${TRACKER}>;
  acl:default <${TRACKER}>; acl:mode acl:Read, acl:Write, acl:Control.
<${TRACKER}.acl#editor> a acl:Authorization; acl:agent <${editor}>; acl:accessTo <${TRACKER}>;
  acl:default <${TRACKER}>; acl:mode acl:Read, acl:Write, acl:Append.`;
const aclWith = (extra: string) => `@prefix acl: <${ACL}>.
<${ACL_URL}#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${RES}>;
  acl:mode acl:Read, acl:Write, acl:Control.
${extra}`;

describe("sharing via @jeswr/pod-access/roles (WAC)", () => {
  it("lists direct grants as named roles, excluding the owner and odd grants", async () => {
    const pod = aclPod({
      [ACL_URL]: aclWith(`
<${ACL_URL}#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${RES}>; acl:mode acl:Read, acl:Write.
<${ACL_URL}#carol> a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${RES}>; acl:mode acl:Write.
<${ACL_URL}#team> a acl:Authorization; acl:agentGroup <${TEAM}>; acl:accessTo <${RES}>;
  acl:mode acl:Read, acl:Write, acl:Control.`),
    });
    const assignments = await listRoleAssignments(RES, OWNER, pod.impl);
    expect(assignments).toHaveLength(2);
    expect(assignments).toContainEqual({ subject: BOB, kind: "agent", role: "editor" });
    expect(assignments).toContainEqual({ subject: TEAM, kind: "group", role: "admin" });
    // Write without Read is no role: omitted, never rounded up.
    expect(assignments.find((a) => a.subject === CAROL)).toBeUndefined();
    expect(pod.puts()).toHaveLength(0);
  });

  it("does not list access inherited from a parent folder", async () => {
    const pod = aclPod({ [`${TRACKER}.acl`]: trackerAcl(BOB) });
    // Bob inherits editor from the tracker, so the tracker lists him and the issue does not.
    expect(await listRoleAssignments(TRACKER, OWNER, pod.impl)).toContainEqual({
      subject: BOB,
      kind: "agent",
      role: "editor",
    });
    expect(await listRoleAssignments(RES, OWNER, pod.impl)).toEqual([]);
  });

  it("removes the copies a single-issue share made when someone leaves the tracker", async () => {
    const pod = aclPod({ [`${TRACKER}.acl`]: trackerAcl(BOB) });
    // Sharing one issue with Carol gives it its own ACL, copying Bob's inherited editor role.
    await assignRole(RES, OWNER, CAROL, "viewer", pod.impl);
    expect(modesOf(pod.acl(ACL_URL), ACL_URL, BOB, RES)).toContain("Write");
    const other = `${TRACKER}other.ttl`;
    await revokeAccess(TRACKER, OWNER, BOB, pod.impl);
    await revokeCopiedAccess([RES, other], OWNER, BOB, pod.impl);
    expect(modesOf(pod.acl(ACL_URL), ACL_URL, BOB, RES)).toEqual([]);
    expect(modesOf(pod.acl(ACL_URL), ACL_URL, CAROL, RES)).toEqual(["Read"]);
    // A member without its own ACL is never written.
    expect(pod.puts().some((put) => put.url === `${other}.acl`)).toBe(false);
  });

  it("creates an own ACL (If-None-Match: *) granting a viewer Read only; the owner keeps Control", async () => {
    const pod = aclPod();
    await assignRole(RES, OWNER, BOB, "viewer", pod.impl);

    const [put] = pod.puts();
    expect(put?.url).toBe(ACL_URL);
    expect(put?.headers.get("if-none-match")).toBe("*");
    expect(modesOf(pod.acl(ACL_URL), ACL_URL, BOB, RES)).toEqual(["Read"]);
    expect(modesOf(pod.acl(ACL_URL), ACL_URL, OWNER, RES)).toEqual(["Control", "Read", "Write"]);
    expect(await listRoleAssignments(RES, OWNER, pod.impl)).toEqual([
      { subject: BOB, kind: "agent", role: "viewer" },
    ]);
  });

  it("adds an editor conditionally (If-Match) and preserves other collaborators", async () => {
    const pod = aclPod({
      [ACL_URL]: aclWith(
        `<${ACL_URL}#carol> a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${RES}>; acl:mode acl:Read.`,
      ),
    });
    const before = pod.acl(ACL_URL);
    expect(before).toBeDefined();
    await assignRole(RES, OWNER, BOB, "editor", pod.impl);

    const [put] = pod.puts();
    expect(put?.headers.get("if-match")).toBe('"2"');
    const written = pod.acl(ACL_URL);
    const bob = modesOf(written, ACL_URL, BOB, RES);
    expect(bob).toContain("Read");
    expect(bob).toContain("Write");
    expect(bob).not.toContain("Control");
    expect(modesOf(written, ACL_URL, CAROL, RES)).toEqual(["Read"]);
    expect(modesOf(written, ACL_URL, OWNER, RES)).toEqual(["Control", "Read", "Write"]);
  });

  it("grants an admin Control", async () => {
    const pod = aclPod({ [ACL_URL]: aclWith("") });
    await assignRole(RES, OWNER, BOB, "admin", pod.impl);
    expect(modesOf(pod.acl(ACL_URL), ACL_URL, BOB, RES)).toEqual(
      expect.arrayContaining(["Control", "Read", "Write"]),
    );
  });

  it("lowers an existing role instead of keeping the wider one", async () => {
    const pod = aclPod({
      [ACL_URL]: aclWith(
        `<${ACL_URL}#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${RES}>; acl:mode acl:Read, acl:Write, acl:Control.`,
      ),
    });
    await assignRole(RES, OWNER, BOB, "viewer", pod.impl);
    expect(modesOf(pod.acl(ACL_URL), ACL_URL, BOB, RES)).toEqual(["Read"]);
    expect(modesOf(pod.acl(ACL_URL), ACL_URL, OWNER, RES)).toEqual(["Control", "Read", "Write"]);
  });

  it("assigns a group role through acl:agentGroup", async () => {
    const pod = aclPod({ [ACL_URL]: aclWith("") });
    await assignGroupRole(RES, OWNER, TEAM, "editor", pod.impl);
    const team = modesOf(pod.acl(ACL_URL), ACL_URL, TEAM, RES);
    expect(team).toContain("Read");
    expect(team).toContain("Write");
    expect(team).not.toContain("Control");
    expect(await listRoleAssignments(RES, OWNER, pod.impl)).toEqual([
      { subject: TEAM, kind: "group", role: "editor" },
    ]);
  });

  it("shares a container with its members (acl:accessTo + acl:default on the same rule)", async () => {
    const containerAcl = `${TRACKER}.acl`;
    const pod = aclPod({
      [containerAcl]: `@prefix acl: <${ACL}>.
<${containerAcl}#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${TRACKER}>; acl:default <${TRACKER}>;
  acl:mode acl:Read, acl:Write, acl:Control.`,
    });
    await assignRole(TRACKER, OWNER, BOB, "viewer", pod.impl);
    const bob = authorizations(pod.acl(containerAcl), containerAcl).filter((a) =>
      a.agents.includes(BOB),
    );
    expect(bob).toEqual([
      {
        agents: [BOB],
        group: undefined,
        public: false,
        modes: ["Read"],
        accessTo: TRACKER,
        default: TRACKER,
      },
    ]);
  });

  it("revokes a collaborator, keeping the owner and everyone else", async () => {
    const pod = aclPod({
      [ACL_URL]: aclWith(`
<${ACL_URL}#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${RES}>; acl:mode acl:Read.
<${ACL_URL}#carol> a acl:Authorization; acl:agent <${CAROL}>; acl:accessTo <${RES}>; acl:mode acl:Read.`),
    });
    await revokeAccess(RES, OWNER, BOB, pod.impl);
    const written = pod.acl(ACL_URL);
    // pod-access may keep the emptied rule node, but no rule grants Bob anything on the issue.
    expect(modesOf(written, ACL_URL, BOB, RES)).toEqual([]);
    expect(modesOf(written, ACL_URL, CAROL, RES)).toEqual(["Read"]);
    expect(modesOf(written, ACL_URL, OWNER, RES)).toEqual(["Control", "Read", "Write"]);
    expect(await listRoleAssignments(RES, OWNER, pod.impl)).toEqual([
      { subject: CAROL, kind: "agent", role: "viewer" },
    ]);
  });

  it("revoking someone without a direct grant writes nothing", async () => {
    const pod = aclPod({ [ACL_URL]: aclWith("") });
    await revokeAccess(RES, OWNER, BOB, pod.impl);
    expect(pod.puts()).toHaveLength(0);
  });

  it("grants public Read only, keeping the owner's control and existing grants", async () => {
    const pod = aclPod({
      [ACL_URL]: aclWith(
        `<${ACL_URL}#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${RES}>; acl:mode acl:Read, acl:Write.`,
      ),
    });
    await grantPublicRead(RES, OWNER, pod.impl);
    const written = pod.acl(ACL_URL);
    expect(modesOf(written, ACL_URL, FOAF_AGENT, RES)).toEqual(["Read"]);
    expect(modesOf(written, ACL_URL, BOB, RES)).toEqual(expect.arrayContaining(["Read", "Write"]));
    expect(modesOf(written, ACL_URL, OWNER, RES)).toEqual(["Control", "Read", "Write"]);
  });

  it("refuses a change that would lock the owner out, writing nothing", async () => {
    const pod = aclPod({ [ACL_URL]: aclWith("") });
    const error = await assignRole(RES, OWNER, OWNER, "viewer", pod.impl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SharingError);
    expect(error).toMatchObject({ code: "owner-lockout" });
    expect((error as Error).message).toMatch(/your own control/);
    expect(pod.puts()).toHaveLength(0);
  });

  it("surfaces a conditional-write conflict (412) as a SharingError and never retries", async () => {
    const pod = aclPod({ [ACL_URL]: aclWith("") });
    pod.failNextPut();
    const error = await assignRole(RES, OWNER, BOB, "viewer", pod.impl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SharingError);
    expect(error).toMatchObject({ code: "conflict", url: RES });
    expect(pod.puts()).toHaveLength(1);
    expect(pod.acl(ACL_URL)).not.toContain(BOB);
  });

  it("refuses folder rules whose folder and member scopes differ, as a SharingError", async () => {
    const containerAcl = `${TRACKER}.acl`;
    const pod = aclPod({
      [containerAcl]: `@prefix acl: <${ACL}>.
<${containerAcl}#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${TRACKER}>; acl:default <${TRACKER}>;
  acl:mode acl:Read, acl:Write, acl:Control.
<${containerAcl}#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${TRACKER}>; acl:mode acl:Read.`,
    });
    await expect(listRoleAssignments(TRACKER, OWNER, pod.impl)).rejects.toMatchObject({
      name: "SharingError",
      code: "partial-scope",
    });
    const error = await assignRole(TRACKER, OWNER, CAROL, "viewer", pod.impl).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "partial-scope" });
    expect(pod.puts()).toHaveLength(0);
  });
});
