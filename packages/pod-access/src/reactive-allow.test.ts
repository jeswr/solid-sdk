// AUTHORED-BY Claude Opus 5.5
// Reactive authentication sends each request anonymously and adds credentials only after a 401.
// A publicly readable resource answers that anonymous request at once, so its WAC-Allow `user`
// group is the anonymous view. These tests run the real Solid backend behind such a fetch and pin
// that pod-access never turns that view into the signed-in owner's denial.
import { deriveFeatures } from "@jeswr/storage-capabilities";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { describe, expect, test, vi } from "vitest";
import { createAccessClient } from "./index.js";

const ROOT = "https://pod.example/";
const NOTE = `${ROOT}note.txt`;
const ACL_URL = `${ROOT}note.txt.acl`;
const BOB = "https://bob.example/#me";
const OWNER = `${ROOT}profile/card#me`;
const ACL = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <${NOTE}>;
  acl:mode acl:Read, acl:Write, acl:Control.
<#public> a acl:Authorization; acl:agentClass <http://xmlns.com/foaf/0.1/Agent>;
  acl:accessTo <${NOTE}>; acl:mode acl:Read.
`;

/** A CSS-like pod: `note.txt` is public-read, owner-controlled; its ACL is owner-only. */
function pod(anonymousHeader = 'user="read",public="read"') {
  const requests: { method: string; url: string; authenticated: boolean }[] = [];
  let acl = ACL;
  const server = (method: string, url: string, authenticated: boolean, body?: string) => {
    if (url === NOTE && (method === "HEAD" || method === "GET")) {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "text/plain",
          link: `<http://www.w3.org/ns/ldp#Resource>; rel="type", <${ACL_URL}>; rel="acl"`,
          "wac-allow": authenticated
            ? 'user="read write append control",public="read"'
            : anonymousHeader,
        },
      });
    }
    if (url === ACL_URL) {
      if (!authenticated) return new Response(null, { status: 401 });
      if (method === "GET")
        return new Response(acl, {
          status: 200,
          headers: { "content-type": "text/turtle", etag: '"1"' },
        });
      if (method === "PUT") {
        acl = body ?? "";
        return new Response(null, { status: 205, headers: { etag: '"2"' } });
      }
    }
    return new Response(null, { status: 404 });
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ method, url, authenticated: false });
    const first = server(method, url, false, body);
    if (first.status !== 401) return first;
    requests.push({ method, url, authenticated: true });
    return server(method, url, true, body);
  });
  const features = deriveFeatures({
    protocol: "solid",
    id: ROOT,
    root: ROOT,
    owner: null,
    descriptionUrl: null,
    services: [],
    capabilities: [],
    sources: ["probe"],
    fetchedAt: 0,
    etag: null,
  });
  const storage = createSolidBackend({
    fetch,
    root: ROOT,
    features: {
      ...features,
      accessControl: { state: "available", detail: { model: "wac" }, evidence: "test" },
    },
  });
  return { storage, requests, acl: () => acl };
}

describe("public resources under reactive authentication", () => {
  test("the owner can share a public-read resource it controls", async () => {
    const { storage, requests, acl } = pod();
    const client = createAccessClient({ storage });
    await expect(client.share(NOTE, { agent: BOB, modes: ["read"] }, {})).resolves.toMatchObject({
      agent: BOB,
      modes: ["read"],
    });
    // The HEAD was answered anonymously; the ACL read and write were challenged and upgraded.
    expect(requests.filter((r) => r.url === NOTE).map((r) => r.authenticated)).toEqual([false]);
    expect(requests.some((r) => r.url === ACL_URL && r.method === "PUT" && r.authenticated)).toBe(
      true,
    );
    expect(acl()).toContain(BOB);
  });

  test("effective() reports the anonymous view as unknown, not as the owner's access", async () => {
    const { storage } = pod();
    expect(await createAccessClient({ storage }).effective(NOTE)).toBeNull();
  });

  test("an authenticated response still reports the caller's modes", async () => {
    const { storage } = pod('user="read write append control",public="read"');
    expect(await createAccessClient({ storage }).effective(NOTE)).toEqual({
      me: ["read", "write", "append", "control"],
      public: [],
    });
  });

  test("an identified requester without Control is still refused before any ACL read", async () => {
    const { storage, requests } = pod('user="read write",public="read"');
    await expect(
      createAccessClient({ storage }).share(NOTE, { agent: BOB, modes: ["read"] }, {}),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(requests.some((r) => r.url === ACL_URL)).toBe(false);
  });
});
