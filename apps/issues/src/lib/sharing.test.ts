import { describe, it, expect, vi } from "vitest";
import { listCollaborators, listGrants, setAccess, setGroupAccess, removeAccess, grantPublicRead } from "./sharing";

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
    if (u === RES) {
      // Advertise the ACL document location.
      return new Response("", { status: 200, headers: { link: `<${ACL_URL}>; rel="acl"` } });
    }
    if (u === ACL_URL) {
      if (method === "GET") {
        if (aclBody === undefined) return new Response("Not found", { status: 404 });
        return new Response(aclBody, { status: 200, headers: { "content-type": "text/turtle", etag: '"a1"' } });
      }
      return new Response(null, { status: 205 }); // PUT
    }
    return new Response("Not found", { status: 404 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const aclWith = (extra: string) => `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${RES}>;
  acl:mode acl:Read, acl:Write, acl:Control.
${extra}`;

describe("sharing (WAC)", () => {
  it("lists named collaborators with merged modes, excluding the owner", async () => {
    const { impl } = router(
      aclWith(`<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${RES}>; acl:mode acl:Read, acl:Write.`),
    );
    const collaborators = await listCollaborators(RES, OWNER, impl);
    expect(collaborators).toEqual([{ webId: BOB, access: { read: true, write: true, control: false } }]);
  });

  it("creates an ACL granting owner control + collaborator read when none exists", async () => {
    const { impl, calls } = router(undefined); // 404 → no acl yet
    await setAccess(RES, OWNER, BOB, { read: true, write: false, control: false }, impl);

    const put = calls.find((c) => c.method === "PUT" && c.url === ACL_URL)!;
    expect(put.body).toContain(OWNER);
    expect(put.body).toContain("acl#Control"); // owner retains control
    expect(put.body).toContain(BOB);
    expect(put.body).toContain("acl#Read");
  });

  it("preserves other collaborators when granting access", async () => {
    const carol = "http://localhost:3000/carol/profile/card#me";
    const { impl, calls } = router(
      aclWith(`<#carol> a acl:Authorization; acl:agent <${carol}>; acl:accessTo <${RES}>; acl:mode acl:Read.`),
    );
    await setAccess(RES, OWNER, BOB, { read: true, write: true, control: false }, impl);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toContain(carol); // existing collaborator kept
    expect(put.body).toContain(BOB); // new one added
    expect(put.body).toContain(OWNER);
  });

  it("grants and lists access for a group (acl:agentGroup), preserving the owner", async () => {
    const groupIri = "http://localhost:3000/alice/issue-tracker/tracker.ttl#team";
    const { impl, calls } = router(undefined);
    await setGroupAccess(RES, OWNER, groupIri, { read: true, write: true, control: false }, impl);

    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toContain("agentGroup");
    expect(put.body).toContain(groupIri);
    expect(put.body).toContain(OWNER);
    expect(put.body).toContain("acl#Control");

    // And reading it back surfaces the group grant.
    const { impl: impl2 } = router(
      aclWith(
        `<#g0> a acl:Authorization; acl:agentGroup <${groupIri}>; acl:accessTo <${RES}>; acl:mode acl:Read, acl:Write.`,
      ),
    );
    const grants = await listGrants(RES, OWNER, impl2);
    expect(grants.groups).toEqual([{ groupIri, access: { read: true, write: true, control: false } }]);
  });

  it("grants public read while keeping the owner in control", async () => {
    const { impl, calls } = router(undefined);
    await grantPublicRead(RES, OWNER, impl);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toContain("foaf/0.1/Agent"); // acl:agentClass foaf:Agent → public
    expect(put.body).toContain("acl#Read");
    expect(put.body).toContain(OWNER);
    expect(put.body).toContain("acl#Control");
  });

  it("removes a collaborator but keeps the owner", async () => {
    const { impl, calls } = router(
      aclWith(`<#bob> a acl:Authorization; acl:agent <${BOB}>; acl:accessTo <${RES}>; acl:mode acl:Read.`),
    );
    await removeAccess(RES, OWNER, BOB, impl);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).not.toContain(BOB);
    expect(put.body).toContain(OWNER);
    expect(put.body).toContain("acl#Control");
  });
});
