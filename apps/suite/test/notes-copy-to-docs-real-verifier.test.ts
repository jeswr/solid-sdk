// AUTHORED-BY Claude Sonnet 5.5
import { createPodClient } from "@jeswr/storage-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocsStore } from "../src/apps/docs/lib/model/store";
import {
  CopyToDocsPrivacyError,
  createNoteDocsConverter,
  createNoteDocsPrivacy,
} from "../src/apps/notes/lib/copy-to-docs";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { sessionCapabilitiesCache } from "../src/lib/session/capabilities-cache";
import "./drive-ui-dom";

// Runs the privacy gate against the REAL owner-only verifier and checker (N1, N2).
const ROOT = "https://pod.example/";
const WEBID = `${ROOT}profile/card#me`;
const SOURCE = `${ROOT}notes/media/bird.png`;
const ACL = "http://www.w3.org/ns/auth/acl#";
const wac = (resource: string, who: string, modes: string) => `
@prefix acl: <${ACL}>.
<#rule> a acl:Authorization; ${who}; acl:accessTo <${resource}>; acl:default <${resource}>;
  acl:mode ${modes}.`;
const note: StoredNote = {
  url: `${ROOT}notes/original.ttl`,
  title: "Birds",
  body: `<p>Body</p><img src="${SOURCE}" alt="Bird">`,
  labels: [],
  location: "active",
  format: "text/html",
  revisions: [],
  etag: '"v1"',
};
beforeEach(() => {
  vi.spyOn(DocsStore.prototype, "ensureRegistered").mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

async function fixture(docsAcl?: string) {
  const pod = createDemoPod({ root: ROOT });
  const put = (url: string, body: string, type: string) =>
    pod.fetch(url, { method: "PUT", body, headers: { "content-type": type } });
  await put(
    `${ROOT}.acl`,
    wac(ROOT, `acl:agent <${WEBID}>`, "acl:Read, acl:Write, acl:Control"),
    "text/turtle",
  );
  await put(SOURCE, "pixels", "image/png");
  await put(note.url, "", "text/turtle");
  // The note itself is private: only the root owner rule governs it.
  if (docsAcl) {
    await put(`${ROOT}docs/x.ttl`, "", "text/turtle");
    await pod.fetch(`${ROOT}docs/x.ttl`, { method: "DELETE" });
    await put(`${ROOT}docs/.acl`, docsAcl, "text/turtle");
  }
  const http = vi.fn<typeof fetch>((...args) => pod.fetch(...args));
  const capabilities = await sessionCapabilitiesCache({
    mode: "demo",
    storageUrl: ROOT,
    webId: WEBID,
  });
  const opened = createPodClient({ fetch: http, storage: ROOT, capabilities }).then(
    (client) => client.storage,
  );
  const dependencies = {
    fetchImpl: http,
    podRoot: ROOT,
    webId: WEBID,
    assertMovable: vi.fn(async () => {}),
    trash: vi.fn(async () => {}),
    ...createNoteDocsPrivacy({ podRoot: ROOT, webId: WEBID, openStorage: () => opened }),
  };
  const writes = () =>
    http.mock.calls.filter(([, init]) => ["PUT", "POST", "PATCH"].includes(init?.method ?? ""));
  const stored = () => pod.snapshot().resources.map(([url]) => url);
  return { dependencies, writes, stored };
}

it.each([
  "copy",
  "move",
] as const)("%s: a private note in an owner-only pod is copied with its images", async (mode) => {
  const f = await fixture();
  const result = await createNoteDocsConverter()(note, mode, f.dependencies);
  expect(result.url).toMatch(/\/docs\/[^/]+\.ttl$/);
  expect(f.stored().some((url) => /\/assets\/[^/]+\.png$/.test(url))).toBe(true);
  expect(result.data.body).toContain("/assets/");
  expect(f.dependencies.trash).toHaveBeenCalledTimes(mode === "move" ? 1 : 0);
});

it.each([
  "copy",
  "move",
] as const)("%s: a private note is refused, writing nothing, when docs/ is readable by others", async (mode) => {
  const f = await fixture(
    wac(`${ROOT}docs/`, "acl:agentClass <http://xmlns.com/foaf/0.1/Agent>", "acl:Read"),
  );
  const before = f.stored();
  await expect(createNoteDocsConverter()(note, mode, f.dependencies)).rejects.toBeInstanceOf(
    CopyToDocsPrivacyError,
  );
  expect(f.writes()).toEqual([]);
  expect(f.stored()).toEqual(before);
  expect(f.dependencies.trash).not.toHaveBeenCalled();
});

it("refuses a note shared with one person when docs/ is not owner-only, but allows a public note", async () => {
  const shared = await fixture(
    wac(`${ROOT}docs/`, "acl:agentClass <http://xmlns.com/foaf/0.1/Agent>", "acl:Read"),
  );
  const alice = "https://friend.example/profile#me";
  await shared.dependencies.fetchImpl(`${note.url}.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `${wac(note.url, `acl:agent <${alice}>`, "acl:Read")}\n<#o> a <${ACL}Authorization>; <${ACL}agent> <${WEBID}>; <${ACL}accessTo> <${note.url}>; <${ACL}mode> <${ACL}Read>, <${ACL}Write>, <${ACL}Control>.`,
  });
  await expect(createNoteDocsConverter()(note, "copy", shared.dependencies)).rejects.toBeInstanceOf(
    CopyToDocsPrivacyError,
  );
  await shared.dependencies.fetchImpl(`${note.url}.acl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `${wac(note.url, "acl:agentClass <http://xmlns.com/foaf/0.1/Agent>", "acl:Read")}\n<#o> a <${ACL}Authorization>; <${ACL}agent> <${WEBID}>; <${ACL}accessTo> <${note.url}>; <${ACL}mode> <${ACL}Read>, <${ACL}Write>, <${ACL}Control>.`,
  });
  const result = await createNoteDocsConverter()(note, "copy", shared.dependencies);
  expect(result.url).toMatch(/\/docs\/[^/]+\.ttl$/);
});
