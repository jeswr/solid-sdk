// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect, vi } from "vitest";
import {
  ROLES,
  ROLE_PRESETS,
  accessForRole,
  capabilitiesForRole,
  roleHasCapability,
  roleForAccess,
  assignRole,
  assignGroupRole,
  listRoleAssignments,
  type Role,
} from "./roles";

const RES = "http://localhost:3000/alice/issue-tracker/issues.ttl";
const ACL_URL = "http://localhost:3000/alice/issue-tracker/issues.ttl.acl";
const OWNER = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";

interface Call {
  url: string;
  method: string;
  body?: string;
}

function router(aclBody?: string) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: u, method, body: init?.body as string | undefined });
    if (u === RES) return new Response("", { status: 200, headers: { link: `<${ACL_URL}>; rel="acl"` } });
    if (u === ACL_URL) {
      if (method === "GET") {
        if (aclBody === undefined) return new Response("Not found", { status: 404 });
        return new Response(aclBody, { status: 200, headers: { "content-type": "text/turtle", etag: '"a1"' } });
      }
      return new Response(null, { status: 205 });
    }
    return new Response("Not found", { status: 404 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const aclWith = (extra: string) => `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${RES}>;
  acl:mode acl:Read, acl:Write, acl:Control.
${extra}`;

describe("F7 role model — role → capability mapping", () => {
  it("exposes three presets coarse→fine", () => {
    expect(ROLES.map((r) => r.role)).toEqual(["viewer", "editor", "admin"]);
  });

  it("maps each role to the right WAC mode bundle", () => {
    expect(accessForRole("viewer")).toEqual({ read: true, write: false, control: false });
    expect(accessForRole("editor")).toEqual({ read: true, write: true, control: false });
    expect(accessForRole("admin")).toEqual({ read: true, write: true, control: true });
  });

  it("accessForRole returns a copy (mutating it never corrupts the preset)", () => {
    const a = accessForRole("admin");
    a.control = false;
    expect(ROLE_PRESETS.admin.access.control).toBe(true); // preset intact
  });

  it("maps each role to its app-level capabilities", () => {
    expect(capabilitiesForRole("viewer")).toEqual(["read"]);
    expect(capabilitiesForRole("editor")).toEqual(["read", "comment", "edit"]);
    expect(capabilitiesForRole("admin")).toEqual(["read", "comment", "edit", "share"]);
  });

  it("roleHasCapability matches the capability lists", () => {
    expect(roleHasCapability("viewer", "read")).toBe(true);
    expect(roleHasCapability("viewer", "edit")).toBe(false);
    expect(roleHasCapability("editor", "edit")).toBe(true);
    expect(roleHasCapability("editor", "share")).toBe(false);
    expect(roleHasCapability("admin", "share")).toBe(true);
  });

  it("capabilities escalate monotonically (every coarser role's caps ⊆ finer role's)", () => {
    const caps = (r: Role) => new Set(capabilitiesForRole(r));
    const viewer = caps("viewer");
    const editor = caps("editor");
    const admin = caps("admin");
    for (const c of viewer) expect(editor.has(c)).toBe(true);
    for (const c of editor) expect(admin.has(c)).toBe(true);
  });
});

describe("F7 roleForAccess — the inverse of the role→WAC map", () => {
  it("inverts each canonical role bundle", () => {
    expect(roleForAccess(accessForRole("viewer"))).toBe("viewer");
    expect(roleForAccess(accessForRole("editor"))).toBe("editor");
    expect(roleForAccess(accessForRole("admin"))).toBe("admin");
  });

  it("round-trips for all three roles", () => {
    for (const { role } of ROLES) {
      expect(roleForAccess(accessForRole(role))).toBe(role);
    }
  });

  it("an empty (revoked) access maps to no role", () => {
    expect(roleForAccess({ read: false, write: false, control: false })).toBeUndefined();
  });

  it("never PROMOTES: control/write without read degrade, not promote", () => {
    // A malformed grant that lacks read must not be read as more than it confers.
    expect(roleForAccess({ read: false, write: true, control: true })).toBeUndefined();
    expect(roleForAccess({ read: false, write: false, control: true })).toBeUndefined();
  });
});

describe("F7 assignRole — applies roles via the WAC accessors (never hand-built ACL)", () => {
  it("assigning 'viewer' grants read-only, owner keeps control", async () => {
    const { impl, calls } = router(undefined);
    await assignRole(RES, OWNER, BOB, "viewer", impl);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toContain(BOB);
    expect(put.body).toContain("acl#Read");
    expect(put.body).not.toContain(`<${RES}>; acl:mode acl:Read, acl:Write`); // bob isn't write
    expect(put.body).toContain(OWNER);
    expect(put.body).toContain("acl#Control"); // owner retains control
  });

  it("assigning 'editor' grants read+write", async () => {
    const { impl, calls } = router(undefined);
    await assignRole(RES, OWNER, BOB, "editor", impl);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toContain("acl#Write");
    expect(put.body).toContain("acl#Read");
  });

  it("assigning 'admin' grants control too", async () => {
    const { impl, calls } = router(undefined);
    await assignRole(RES, OWNER, BOB, "admin", impl);
    const put = calls.find((c) => c.method === "PUT")!;
    // Two Control authorizations now: the owner's and bob's.
    expect((put.body!.match(/acl#Control/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("assignGroupRole grants a group its role via acl:agentGroup", async () => {
    const groupIri = "http://localhost:3000/alice/issue-tracker/tracker.ttl#team";
    const { impl, calls } = router(undefined);
    await assignGroupRole(RES, OWNER, groupIri, "editor", impl);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toContain("agentGroup");
    expect(put.body).toContain(groupIri);
    expect(put.body).toContain("acl#Write");
  });
});

describe("F7 listRoleAssignments — reads grants back as named roles", () => {
  it("maps an agent's read+write grant to the 'editor' role", async () => {
    const { impl } = router(
      aclWith(`<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${RES}>; acl:mode acl:Read, acl:Write.`),
    );
    const assignments = await listRoleAssignments(RES, OWNER, impl);
    expect(assignments).toEqual([{ subject: BOB, kind: "agent", role: "editor" }]);
  });

  it("maps a read-only grant to 'viewer' and a group grant to its role", async () => {
    const groupIri = "http://localhost:3000/alice/issue-tracker/tracker.ttl#team";
    const { impl } = router(
      aclWith(
        `<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${RES}>; acl:mode acl:Read.
<#g0> a acl:Authorization; acl:agentGroup <${groupIri}>; acl:accessTo <${RES}>; acl:mode acl:Read, acl:Write, acl:Control.`,
      ),
    );
    const assignments = await listRoleAssignments(RES, OWNER, impl);
    expect(assignments).toContainEqual({ subject: BOB, kind: "agent", role: "viewer" });
    expect(assignments).toContainEqual({ subject: groupIri, kind: "group", role: "admin" });
  });

  it("excludes the owner (they are filtered out by listGrants)", async () => {
    const { impl } = router(aclWith(""));
    const assignments = await listRoleAssignments(RES, OWNER, impl);
    expect(assignments.find((a) => a.subject === OWNER)).toBeUndefined();
  });
});
