// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { ContactsModel } from "../src/apps/contacts/lib/model";
import { ensureBook, ensurePrivateIndex } from "../src/apps/contacts/state/recovery";
import { BOOK, GROUPS, INDEX, MemoryPod, PEOPLE, ROOT, setup } from "./contacts-support";

const WEBID = `${ROOT}profile/card#me`;
const PROFILE = `${ROOT}profile/card`;
const PREFS = `${ROOT}settings/prefs.ttl`;
const PIM = "@prefix pim: <http://www.w3.org/ns/pim/space#>.";
const SOLID = "@prefix solid: <http://www.w3.org/ns/solid/terms#>.";

describe("Contacts recoverable creation", () => {
  it("leaves existing books alone and refuses to adopt populated orphan indexes", async () => {
    const { model, pod } = await setup();
    await ensureBook(model, WEBID);
    expect(pod.writes).toEqual([]);
    pod.files.delete(BOOK);
    await expect(ensureBook(model, WEBID)).rejects.toThrow("not empty");
    expect(pod.writes).toEqual([]);
    pod.seed(PEOPLE, "");
    await expect(ensureBook(model, WEBID)).rejects.toThrow("not empty");
    expect(pod.writes).toEqual([]);
    pod.seed(GROUPS, "");
    await ensureBook(model, WEBID);
    expect(pod.writes.map((r) => r.url)).toEqual([BOOK]);
  });
  it("only creates confirmed missing indexes and never overwrites unreadable documents", async () => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    pod.fail = (url) => (url === PEOPLE ? new Response(null, { status: 403 }) : undefined);
    await expect(ensureBook(model, WEBID)).rejects.toThrow();
    expect(pod.writes).toEqual([]);
    pod.fail = undefined;
    await ensureBook(model, WEBID);
    expect(pod.writes.map((r) => r.url)).toEqual([PEOPLE, GROUPS, BOOK]);
    expect(pod.writes.every((r) => r.headers.get("if-none-match") === "*")).toBe(true);
  });
});

describe("Contacts private Type Index bootstrap", () => {
  it("creates the missing index and preferences and links the profile conditionally", async () => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    pod.seed(PROFILE, '<#me> <https://example.org/keep> "profile".');
    expect(await ensurePrivateIndex(model, WEBID)).toBe(INDEX);
    expect(pod.files.get(INDEX)?.body).toContain("TypeIndex");
    expect(pod.files.get(INDEX)?.body).toContain("UnlistedDocument");
    expect(pod.files.get(PROFILE)?.body).toContain('"profile"');
    expect(pod.files.get(PROFILE)?.body).toContain(PREFS);
    expect(pod.files.get(PREFS)?.body).toContain(INDEX);
    expect(
      pod.writes.map((r) => r.headers.get("if-none-match") ?? r.headers.get("if-match")),
    ).toEqual(["*", "*", '"1"']);
    const count = pod.writes.length;
    await ensurePrivateIndex(model, WEBID);
    expect(pod.writes).toHaveLength(count);
  });
  it("reuses custom linked documents and preserves unrelated data", async () => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    const prefs = `${ROOT}preferences/custom.ttl`;
    const index = `${ROOT}indexes/private.ttl`;
    pod.seed(PROFILE, `${PIM} <#me> pim:preferencesFile <${prefs}>.`);
    pod.seed(
      prefs,
      `${SOLID} <${WEBID}> solid:privateTypeIndex <${index}>; <https://example.org/keep> "preferences".`,
    );
    expect(await ensurePrivateIndex(model, WEBID)).toBe(index);
    expect(pod.writes.map((r) => r.url)).toEqual([index]);
    expect(pod.files.get(prefs)?.body).toContain('"preferences"');
  });
  it("reuses legacy index pointers and an existing unlinked preferences document", async () => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    const legacy = `${ROOT}old-index.ttl`;
    pod.seed(PROFILE, `${SOLID} <#me> solid:privateTypeIndex <${legacy}>.`);
    pod.seed(PREFS, '<> <https://example.org/keep> "preferences".');
    pod.seed(legacy, '<> <https://example.org/keep> "registration".');
    expect(await ensurePrivateIndex(model, WEBID)).toBe(legacy);
    expect(pod.writes.map((r) => r.url)).toEqual([PREFS, PROFILE]);
    expect(pod.files.get(PREFS)?.body).toContain('"preferences"');
    expect(pod.files.get(legacy)?.body).toContain('"registration"');
  });
  it.each([PREFS, INDEX])("never bootstraps an unreadable %s", async (unreadable) => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    pod.seed(PROFILE, "");
    pod.fail = (url) => (url === unreadable ? new Response(null, { status: 403 }) : undefined);
    await expect(ensurePrivateIndex(model, WEBID)).rejects.toThrow();
    expect(pod.writes).toEqual([]);
  });
  it.each([
    INDEX,
    PREFS,
    PROFILE,
  ])("resumes after a conditional bootstrap conflict on %s", async (conflict) => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    pod.seed(PROFILE, "");
    pod.fail = (url, method) =>
      url === conflict && method === "PUT" ? new Response(null, { status: 412 }) : undefined;
    await expect(ensurePrivateIndex(model, WEBID)).rejects.toThrow();
    pod.fail = undefined;
    expect(await ensurePrivateIndex(model, WEBID)).toBe(INDEX);
    expect(pod.files.get(PROFILE)?.body).toContain(PREFS);
  });
  it("rejects off-pod preferences and indexes before fetching them", async () => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    for (const body of [
      `${PIM} <#me> pim:preferencesFile <https://evil.example/preferences>.`,
      `${SOLID} <#me> solid:privateTypeIndex <https://evil.example/index>.`,
    ]) {
      pod.seed(PROFILE, body);
      await expect(ensurePrivateIndex(model, WEBID)).rejects.toThrow();
    }
    expect(pod.requests.some((r) => r.url.includes("evil.example"))).toBe(false);
    expect(pod.writes).toEqual([]);
  });
});
