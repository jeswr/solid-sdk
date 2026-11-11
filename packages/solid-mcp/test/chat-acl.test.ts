// AUTHORED-BY Codex GPT-6.1-Sol
import { serialize } from "@jeswr/rdf-serialize";
import { Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { chatAclAccess } from "../src/chat-acl.js";
import type { PodHeadResult, PodPort, PodReadResult } from "../src/pod-port.js";

const ROOT = "https://pod.example/";
const TARGET = `${ROOT}private/chats/claude/chat/m-message.ttl`;
const ACL = `${TARGET}.acl`;
const OWNER = `${ROOT}profile#me`;

async function ownerAcl(acl = ACL, target = TARGET, owner = OWNER) {
  const store = new Store();
  const auth = new Authorization(`${acl}#owner`, store, DataFactory);
  auth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
  auth.accessTo = target;
  if (target.endsWith("/")) auth.default = target;
  auth.agent.add(owner);
  auth.canRead = true;
  auth.canWrite = true;
  auth.canReadWriteAcl = true;
  return new TextEncoder().encode(await serialize([...store], { format: "text/turtle" }));
}

function fixture() {
  const read = vi.fn<PodPort["read"]>(async () => {
    throw Object.assign(new Error("missing"), { status: 404 });
  });
  const head = vi.fn<NonNullable<PodPort["head"]>>(async () => ({
    acl: ACL,
    auxiliaryResources: [ACL],
  }));
  const write = vi.fn<PodPort["write"]>(async () => ({ etag: '"saved"' }));
  const pod: PodPort = {
    root: ROOT,
    webId: OWNER,
    read,
    head,
    write,
    list: async () => [],
    delete: async () => {},
  };
  return { pod, read, head, write, access: chatAclAccess(pod) };
}

describe("narrow chat ACL capability", () => {
  it("creates only the exact advertised ACL with an atomic create condition", async () => {
    const f = fixture();
    await f.access.discover(TARGET);
    const body = await ownerAcl();
    expect(await f.access.write(ACL, body, "text/turtle", {})).toEqual({ etag: '"saved"' });
    expect(f.write).toHaveBeenCalledExactlyOnceWith(ACL, body, "text/turtle", { ifNoneMatch: "*" });
    expect(f.head).toHaveBeenCalledTimes(2);
  });

  it("has no authority over an undiscovered ACL", async () => {
    const f = fixture();
    expect(await f.access.write(ACL, await ownerAcl(), "text/turtle", {})).toBeUndefined();
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { acl: ACL },
    { acl: TARGET, auxiliaryResources: [TARGET] },
    { acl: `${ROOT}private/chats/.meta`, auxiliaryResources: [`${ROOT}private/chats/.meta`] },
    { acl: `${ROOT}private/chats/.acl?x`, auxiliaryResources: [`${ROOT}private/chats/.acl?x`] },
  ] satisfies PodHeadResult[])("rejects incomplete or unsafe metadata %j", async (metadata) => {
    const f = fixture();
    f.head.mockResolvedValue(metadata);
    await expect(f.access.discover(TARGET)).rejects.toThrow();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("refuses shared ACL bindings and association changes before mutation", async () => {
    const f = fixture();
    await f.access.discover(TARGET);
    await expect(f.access.discover(`${ROOT}private/chats/other.ttl`)).rejects.toThrow();
    f.head.mockResolvedValue({ acl: `${ACL}-changed`, auxiliaryResources: [`${ACL}-changed`] });
    await expect(f.access.write(ACL, await ownerAcl(), "text/turtle", {})).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each([
    "text/plain",
    "text/turtle",
  ])("refuses caller-selected ACL conditions or media type %s", async (contentType) => {
    const f = fixture();
    await f.access.discover(TARGET);
    await expect(
      f.access.write(ACL, await ownerAcl(), contentType, { ifMatch: '"x"' }),
    ).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("reuses an identical owner-only ACL without requiring or changing its ETag", async () => {
    const f = fixture();
    await f.access.discover(TARGET);
    const body = await ownerAcl();
    f.read.mockResolvedValue({ body, contentType: "text/turtle" });
    await f.access.write(ACL, body, "text/turtle", {});
    expect(f.write).not.toHaveBeenCalled();
  });

  it("conditionally narrows an existing dedicated ACL using its strong ETag", async () => {
    const f = fixture();
    await f.access.discover(TARGET);
    f.read.mockResolvedValue({
      body: await ownerAcl(ACL, TARGET, "https://other.example/#me"),
      contentType: "text/turtle",
      etag: '"version"',
    });
    const body = await ownerAcl();
    await f.access.write(ACL, body, "text/turtle", {});
    expect(f.write).toHaveBeenCalledExactlyOnceWith(ACL, body, "text/turtle", {
      ifMatch: '"version"',
    });
  });

  it.each([
    undefined,
    "*",
    'W/"weak"',
    '"a", "b"',
  ])("refuses replacement without a strong ETag: %s", async (etag) => {
    const f = fixture();
    await f.access.discover(TARGET);
    f.read.mockResolvedValue({
      body: await ownerAcl(ACL, TARGET, "https://other.example/#me"),
      contentType: "text/turtle",
      etag,
    });
    await expect(f.access.write(ACL, await ownerAcl(), "text/turtle", {})).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each([
    "shared",
    "alias",
    "content-type",
    "forbidden",
    "transport",
  ])("refuses unsafe existing ACLs: %s", async (kind) => {
    const f = fixture();
    await f.access.discover(TARGET);
    const existing: PodReadResult = {
      body: await ownerAcl(ACL, kind === "shared" ? `${ROOT}other` : TARGET),
      contentType: kind === "content-type" ? "application/json" : "text/turtle",
      etag: '"version"',
      ...(kind === "alias" ? { url: `${ACL}-alias` } : {}),
    };
    f.read.mockResolvedValue(existing);
    if (kind === "forbidden")
      f.read.mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    if (kind === "transport") f.read.mockRejectedValue("offline");
    await expect(f.access.write(ACL, await ownerAcl(), "text/turtle", {})).rejects.toBeDefined();
    expect(f.write).not.toHaveBeenCalled();
  });
});
