// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { describe, expect, it, vi } from "vitest";
import { ContactsWriteError, PartialWriteError } from "../src/apps/contacts/lib/model";
import {
  ContactsController,
  mapContacts,
  writeMessage,
} from "../src/apps/contacts/state/controller";
import {
  ALICE,
  BOOK,
  FRIENDS,
  GROUPS,
  INDEX,
  MemoryIntentStorage,
  PEOPLE,
  PM,
  ROOT,
  setup,
  VCARD_PREFIX,
} from "./contacts-support";

const WEBID = `${ROOT}profile/card#me`;
async function controllerSetup() {
  const { pod } = await setup();
  pod.seed(
    PEOPLE,
    `${VCARD_PREFIX} <${ALICE}#this> vcard:fn "Alice"; vcard:inAddressBook <${BOOK}#this>.`,
  );
  pod.seed(
    `${ROOT}profile/card`,
    `@prefix solid: <http://www.w3.org/ns/solid/terms#>. <#me> solid:privateTypeIndex <${INDEX}>.`,
  );
  pod.seed(
    INDEX,
    `@prefix solid: <http://www.w3.org/ns/solid/terms#>. @prefix vcard: <http://www.w3.org/2006/vcard/ns#>. <#book> a solid:TypeRegistration; solid:forClass vcard:AddressBook; solid:instance <${BOOK}#this>. <#pm> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instance <${PM}#it>.`,
  );
  const errors = vi.fn();
  const storage = new MemoryIntentStorage();
  const controller = new ContactsController(pod.fetch, ROOT, WEBID, errors, () => storage);
  await controller.refresh();
  expect(controller.getSnapshot().status, String(controller.getSnapshot().error)).toBe("ready");
  return { controller, pod, errors, storage };
}
describe("Contacts reads and discovery", () => {
  it("bounds per-person reads to six while preserving index order", async () => {
    let active = 0;
    let max = 0;
    const result = await mapContacts(
      Array.from({ length: 20 }, (_, i) => i),
      async (i) => {
        max = Math.max(max, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return i * 2;
      },
    );
    expect(max).toBe(6);
    expect(result).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
    expect(await mapContacts([], async (x) => x)).toEqual([]);
    await expect(
      mapContacts([1], async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");
  });
  it("loads the book, indexed documents, labels and PM candidates and notifies subscribers", async () => {
    const { controller } = await controllerSetup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    await controller.refresh();
    expect(controller.getSnapshot().data.book?.url).toBe(BOOK);
    expect(controller.getSnapshot().data.people).toHaveLength(1);
    expect(controller.getSnapshot().data.groups[0]?.data.name).toBe("Friends");
    expect(controller.getSnapshot().data.flat).toHaveLength(1);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    await controller.refresh(false);
    expect(listener).toHaveBeenCalledOnce();
  });
  it("follows the preferences document and falls back to the conventional book when the index is absent", async () => {
    const { controller, pod } = await controllerSetup();
    pod.seed(
      `${ROOT}profile/card`,
      `@prefix pim: <http://www.w3.org/ns/pim/space#>. <#me> pim:preferencesFile <${ROOT}settings/prefs.ttl>.`,
    );
    pod.seed(
      `${ROOT}settings/prefs.ttl`,
      `@prefix solid: <http://www.w3.org/ns/solid/terms#>. <${WEBID}> solid:privateTypeIndex <${INDEX}>.`,
    );
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("ready");
    pod.files.delete(INDEX);
    await controller.refresh();
    expect(controller.getSnapshot().data.book?.url).toBe(BOOK);
    expect(controller.getSnapshot().data.flat).toEqual([]);
    pod.files.delete(BOOK);
    await controller.refresh();
    expect(controller.getSnapshot().data.book).toBeNull();
  });
  it("uses default private index paths and handles an empty index", async () => {
    const { controller, pod } = await controllerSetup();
    pod.seed(`${ROOT}profile/card`, "");
    pod.seed(INDEX, "");
    await controller.refresh();
    expect(controller.getSnapshot().data.book?.url).toBe(BOOK);
  });
  it("does not turn unreadable discovery or book documents into empty books", async () => {
    const { controller, pod } = await controllerSetup();
    for (const url of [INDEX, BOOK, ALICE]) {
      pod.fail = (target) => (target === url ? new Response(null, { status: 403 }) : undefined);
      await controller.refresh();
      expect(controller.getSnapshot().status).toBe("error");
      expect(controller.getSnapshot().data.people).toEqual([]);
    }
    pod.fail = undefined;
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("ready");
    pod.seed(
      `${ROOT}profile/card`,
      `@prefix solid: <http://www.w3.org/ns/solid/terms#>. <#me> solid:privateTypeIndex <https://evil.example/index>.`,
    );
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("error");
    expect(pod.requests.some((r) => r.url.includes("evil.example"))).toBe(false);
  });
  it("fences stale successful and failed refreshes", async () => {
    const { controller } = await controllerSetup();
    const original = controller.model.loadAddressBook.bind(controller.model);
    let resolve!: (value: Awaited<ReturnType<typeof original>>) => void;
    vi.spyOn(controller.model, "loadAddressBook").mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const stale = controller.refresh(false);
    await controller.refresh(false);
    const current = controller.getSnapshot();
    resolve(await original());
    await stale;
    expect(controller.getSnapshot()).toBe(current);
    let reject!: (error: unknown) => void;
    vi.spyOn(controller.model, "loadAddressBook").mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const failure = controller.refresh(false);
    await controller.refresh(false);
    const next = controller.getSnapshot();
    reject(new Error("stale"));
    await failure;
    expect(controller.getSnapshot()).toBe(next);
  });
});
describe("Contacts optimistic conditional mutations", () => {
  it("creates and updates contacts, preserving identity, projections and conditional IO", async () => {
    const { controller, pod } = await controllerSetup();
    const created = controller.create({
      name: "Mira Quill",
      emails: ["mailto:mira@example.org"],
      phones: ["tel:+12025550101"],
      organization: "Observatory",
      note: "Hello",
    });
    expect(controller.getSnapshot().saving).toBe(true);
    expect(controller.getSnapshot().data.people.at(-1)?.data.name).toBe("Mira Quill");
    await controller.refresh(); // Live notifications cannot overwrite an optimistic mutation.
    await created;
    const person = controller.getSnapshot().data.people.find((p) => p.data.name === "Mira Quill");
    expect(person).toBeDefined();
    const id = `${person?.url}#this`;
    const updated = controller.update(id, { name: "Mira Vale", note: "Updated" });
    expect(controller.getSnapshot().data.people.find((p) => p.url === person?.url)?.data.note).toBe(
      "Updated",
    );
    await updated;
    expect((await controller.model.loadContact(id)).data).toMatchObject({
      name: "Mira Vale",
      note: "Updated",
      organization: "Observatory",
      emails: ["mailto:mira@example.org"],
      phones: ["tel:+12025550101"],
    });
    expect(
      pod.writes.every(
        (write) => write.headers.has("if-match") || write.headers.get("if-none-match") === "*",
      ),
    ).toBe(true);
    expect(controller.getSnapshot().saving).toBe(false);
    await controller.update(id, { note: undefined, organization: undefined });
    const cleared = (await controller.model.loadContact(id)).data;
    expect(cleared.note).toBeUndefined();
    expect(cleared.organization).toBeUndefined();
  });
  it("creates, renames, adds/removes membership and deletes a label optimistically", async () => {
    const { controller } = await controllerSetup();
    const created = controller.createLabel("Family");
    expect(controller.getSnapshot().data.groups.at(-1)?.data.name).toBe("Family");
    await created;
    const group = controller.getSnapshot().data.groups.find((g) => g.data.name === "Family");
    const id = `${group?.url}#this`;
    const rename = controller.renameLabel(id, "Book club");
    expect(controller.getSnapshot().data.groups.at(-1)?.data.name).toBe("Book club");
    await rename;
    const add = controller.setLabel(`${ALICE}#this`, id, true);
    expect(controller.getSnapshot().data.groups.at(-1)?.data.members).toEqual([`${ALICE}#this`]);
    await add;
    await controller.setLabel(`${ALICE}#this`, id, true);
    expect((await controller.model.loadGroup(id)).data.members).toEqual([`${ALICE}#this`]);
    const remove = controller.setLabel(`${ALICE}#this`, id, false);
    expect(controller.getSnapshot().data.groups.at(-1)?.data.members).toEqual([]);
    await remove;
    const deletion = controller.deleteLabel(id);
    expect(controller.getSnapshot().data.groups.some((g) => g.url === group?.url)).toBe(false);
    await deletion;
  });
  it("deletes then re-creates the same contact and its surviving memberships", async () => {
    const { controller } = await controllerSetup();
    const person = controller.getSnapshot().data.people[0];
    if (!person) throw new Error("fixture");
    await controller.createLabel("Unrelated");
    const deletion = controller.delete(`${ALICE}#this`);
    expect(controller.getSnapshot().data.people).toEqual([]);
    expect(controller.getSnapshot().data.groups[0]?.data.members).toEqual([]);
    await deletion;
    const undo = controller.restore(person, [
      `${FRIENDS}#this`,
      "https://missing.example/group#this",
    ]);
    expect(controller.getSnapshot().data.people).toHaveLength(1);
    expect(controller.getSnapshot().data.groups[0]?.data.members).toContain(`${ALICE}#this`);
    await undo;
    expect((await controller.model.loadContact(ALICE)).data).toEqual(person.data);
    expect(
      isomorphic([...(await controller.model.loadContact(ALICE)).dataset], [...person.dataset]),
    ).toBe(true);
    expect((await controller.model.loadGroup(FRIENDS)).data.members).toContain(`${ALICE}#this`);
  });
  it.each([
    412, 503,
  ])("repairs memberships and the index after a final DELETE %s, preserving current person RDF", async (status) => {
    const { controller, pod } = await controllerSetup();
    const original = pod.files.get(ALICE)?.body as string;
    pod.fail = (url, method) => {
      if (url !== ALICE || method !== "DELETE") return undefined;
      // A concurrent writer may have changed the document before the failed DELETE.
      pod.seed(ALICE, original.replace('"Alice"', '"Alice changed elsewhere"'), '"new"');
      return new Response(null, { status });
    };
    await expect(controller.delete(`${ALICE}#this`)).rejects.toBeInstanceOf(ContactsWriteError);
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().data.people[0]?.data.name).toBe("Alice changed elsewhere");
    expect(
      (await controller.model.loadPeople(await controller.model.loadAddressBook())).data[0]?.name,
    ).toBe("Alice changed elsewhere");
    expect((await controller.model.loadGroup(FRIENDS)).data.members).toContain(`${ALICE}#this`);
    expect(pod.writes.filter((r) => r.url === ALICE && r.method === "PUT")).toEqual([]);
  });
  it("retains recovery through a failed repair and retries it before rendering the list", async () => {
    const { controller, pod } = await controllerSetup();
    let removedIndex = false;
    pod.fail = (url, method) => {
      if (url === PEOPLE && method === "PUT") {
        if (removedIndex) return new Response(null, { status: 503 });
        removedIndex = true;
      }
      return url === ALICE && method === "DELETE" ? new Response(null, { status: 503 }) : undefined;
    };
    await expect(controller.delete(`${ALICE}#this`)).rejects.toThrow();
    expect(controller.getSnapshot().status).toBe("error");
    pod.fail = undefined;
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().data.people[0]?.url).toBe(ALICE);
    expect(controller.getSnapshot().data.groups[0]?.data.members).toContain(`${ALICE}#this`);
  });
  it("repairs only completed membership removals when the people-index write fails", async () => {
    const { controller, pod } = await controllerSetup();
    pod.fail = (url, method) =>
      url === PEOPLE && method === "PUT" ? new Response(null, { status: 412 }) : undefined;
    await expect(controller.delete(`${ALICE}#this`)).rejects.toBeInstanceOf(ContactsWriteError);
    expect(controller.getSnapshot().data.people).toHaveLength(1);
    expect(controller.getSnapshot().data.groups[0]?.data.members).toContain(`${ALICE}#this`);
  });
  it("repairs memberships the model removed even when they were absent from the last UI snapshot", async () => {
    const { controller, pod } = await controllerSetup();
    const actualGroup = pod.files.get(FRIENDS)?.body as string;
    pod.seed(FRIENDS, `${VCARD_PREFIX} <#this> a vcard:Group; vcard:fn "Friends".`);
    await controller.refresh(false);
    expect(controller.getSnapshot().data.groups[0]?.data.members ?? []).toEqual([]);
    pod.seed(FRIENDS, actualGroup);
    pod.fail = (url, method) =>
      url === ALICE && method === "DELETE" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.delete(`${ALICE}#this`)).rejects.toThrow();
    expect(controller.getSnapshot().data.groups[0]?.data.members).toContain(`${ALICE}#this`);
  });
  it("rolls back an unstarted delete and refuses Undo over an occupied document", async () => {
    const { controller, pod } = await controllerSetup();
    const person = controller.getSnapshot().data.people[0];
    if (!person) throw new Error("fixture");
    pod.fail = (url, method) =>
      url === FRIENDS && method === "PUT" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.delete(`${ALICE}#this`)).rejects.toBeInstanceOf(ContactsWriteError);
    expect(controller.getSnapshot().data.people[0]?.url).toBe(ALICE);
    pod.fail = undefined;
    const writesBeforeUndo = pod.writes.length;
    await expect(controller.restore(person, [])).rejects.toMatchObject({ status: 412 });
    expect(
      isomorphic([...(await controller.model.loadContact(ALICE)).dataset], [...person.dataset]),
    ).toBe(true);
    expect(pod.writes).toHaveLength(writesBeforeUndo);
  });
  it("Undo preserves UID, custom properties, contact-point metadata and unrelated RDF", async () => {
    const { controller, pod } = await controllerSetup();
    pod.seed(
      ALICE,
      `${pod.files.get(ALICE)?.body}\n${VCARD_PREFIX} <#this> vcard:hasEmail [ a vcard:Home; vcard:value <mailto:second@example.org>; <https://example.org/pref> 2 ]; vcard:bday "2000-01-02". <#unrelated> <https://example.org/note> "keep".`,
    );
    await controller.refresh(false);
    const person = controller.getSnapshot().data.people[0];
    if (!person) throw new Error("fixture");
    await controller.delete(`${ALICE}#this`);
    await controller.restore(person, [`${FRIENDS}#this`]);
    const restored = await controller.model.loadContact(ALICE);
    expect(isomorphic([...restored.dataset], [...person.dataset])).toBe(true);
    expect(
      [
        ...restored.dataset.match(
          null,
          DataFactory.namedNode("http://www.w3.org/2006/vcard/ns#hasUID"),
        ),
      ][0]?.object.value,
    ).toBe("urn:uuid:alice");
  });
  it("repairs deletions in books that omit the conventional index link", async () => {
    const { controller, pod } = await controllerSetup();
    pod.seed(
      BOOK,
      (pod.files.get(BOOK)?.body ?? "").replace("vcard:nameEmailIndex <people.ttl>;", ""),
    );
    await controller.refresh();
    pod.fail = (url, method) =>
      url === ALICE && method === "DELETE" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.delete(`${ALICE}#this`)).rejects.toThrow();
    expect(controller.getSnapshot().data.people[0]?.url).toBe(ALICE);
    expect(controller.getSnapshot().data.groups[0]?.data.members).toContain(`${ALICE}#this`);
  });
  it("retains Undo's dataset through a failed index repair and merges unrelated memberships", async () => {
    const { controller, pod } = await controllerSetup();
    const person = controller.getSnapshot().data.people[0];
    if (!person) throw new Error("fixture");
    await controller.delete(`${ALICE}#this`);
    pod.fail = (url, method) =>
      url === PEOPLE && method === "PUT" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.restore(person, [`${FRIENDS}#this`])).rejects.toThrow();
    expect(controller.getSnapshot().status).toBe("error");
    expect(
      isomorphic([...(await controller.model.loadContact(ALICE)).dataset], [...person.dataset]),
    ).toBe(true);
    pod.seed(
      FRIENDS,
      `${VCARD_PREFIX} <#this> a vcard:Group; vcard:fn "Friends"; vcard:hasMember <${ROOT}contacts/people/other.ttl#this>.`,
    );
    pod.fail = undefined;
    await controller.refresh();
    expect(controller.getSnapshot().data.groups[0]?.data.members).toEqual([
      `${ROOT}contacts/people/other.ttl#this`,
      `${ALICE}#this`,
    ]);
    expect(controller.getSnapshot().data.people[0]?.url).toBe(ALICE);
  });
  it("rolls back failures without discarding newer field changes, and continues its queue", async () => {
    const { controller, pod, errors } = await controllerSetup();
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const real = controller.model.updateContact.bind(controller.model);
    vi.spyOn(controller.model, "updateContact")
      .mockImplementationOnce(async () => {
        await blocked;
        throw new ContactsWriteError(412, ALICE, '"new"');
      })
      .mockImplementation(real);
    const failed = controller.update(`${ALICE}#this`, { name: "Failed name" });
    const newer = controller.update(`${ALICE}#this`, { note: "Keep this note" });
    expect(controller.getSnapshot().data.people[0]?.data).toMatchObject({
      name: "Failed name",
      note: "Keep this note",
    });
    release();
    await expect(failed).rejects.toBeInstanceOf(ContactsWriteError);
    await newer;
    expect(controller.getSnapshot().data.people[0]?.data).toMatchObject({
      name: "Alice",
      note: "Keep this note",
    });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"));
    pod.fail = (url, method) =>
      url === ALICE && method === "PUT" ? new Response(null, { status: 500 }) : undefined;
    const a = controller.update(`${ALICE}#this`, { name: "A" });
    const b = controller.update(`${ALICE}#this`, { name: "B" });
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    expect(controller.getSnapshot().data.people[0]?.data.name).toBe("Alice");
  });
  it("reconciles partial writes rather than fabricating rollback on the server", async () => {
    const { controller, pod } = await controllerSetup();
    pod.fail = (url, method) =>
      url === PEOPLE && method === "PUT" ? new Response(null, { status: 412 }) : undefined;
    await expect(
      controller.update(`${ALICE}#this`, { name: "Persisted person" }),
    ).rejects.toBeInstanceOf(PartialWriteError);
    expect(controller.getSnapshot().data.people[0]?.data.name).toBe("Persisted person");
  });
  it("clears stale data when reconciliation is unreadable and supports retry", async () => {
    const { controller, pod } = await controllerSetup();
    pod.fail = (url, method) =>
      url === BOOK && method === "GET" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.update(`${ALICE}#this`, { note: "Saved" })).rejects.toThrow();
    expect(controller.getSnapshot().status).toBe("error");
    expect(controller.getSnapshot().saving).toBe(false);
    pod.fail = undefined;
    await controller.refresh();
    expect(controller.getSnapshot().data.people[0]?.data.note).toBe("Saved");
  });
  it("reports missing contacts, labels and books without issuing destructive writes", async () => {
    const { controller, pod } = await controllerSetup();
    await expect(controller.update("missing", { name: "X" })).rejects.toThrow(
      "Contact no longer exists",
    );
    await expect(controller.delete("missing")).rejects.toThrow("Contact no longer exists");
    await expect(controller.renameLabel("missing", "X")).rejects.toThrow("Label no longer exists");
    await expect(controller.setLabel(`${ALICE}#this`, "missing", true)).rejects.toThrow(
      "Label no longer exists",
    );
    await expect(controller.setLabel("missing", `${FRIENDS}#this`, true)).rejects.toThrow(
      "Contact no longer exists",
    );
    pod.files.delete(BOOK);
    await controller.refresh();
    await expect(controller.create({ name: "Missing book" })).rejects.toThrow(
      "Create an address book first",
    );
  });
  it("creates and registers a missing book and can retry registration after a partial operation", async () => {
    const { controller, pod } = await controllerSetup();
    pod.files.delete(BOOK);
    pod.files.delete(PEOPLE);
    pod.files.delete(`${ROOT}contacts/groups.ttl`);
    await controller.refresh();
    pod.fail = (url, method) =>
      url === INDEX && method === "PUT" ? new Response(null, { status: 412 }) : undefined;
    await expect(controller.createBook()).rejects.toThrow();
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().data.registrationPending).toBe(true);
    expect(pod.files.has(BOOK)).toBe(true);
    pod.fail = undefined;
    await controller.createBook();
    expect(pod.files.get(INDEX)?.body).toContain("contacts-");
    expect(controller.getSnapshot().data.registrationPending).toBe(false);
  });
  it.each([
    GROUPS,
    BOOK,
  ])("resumes book creation after failing %s without re-creating indexes", async (failedUrl) => {
    const { controller, pod } = await controllerSetup();
    for (const url of [BOOK, PEOPLE, GROUPS, INDEX]) pod.files.delete(url);
    await controller.refresh();
    pod.fail = (url, method) =>
      url === failedUrl && method === "PUT" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.createBook()).rejects.toThrow();
    expect(controller.getSnapshot().data.book).toBeNull();
    const peopleEtag = pod.files.get(PEOPLE)?.etag;
    pod.fail = undefined;
    await controller.createBook();
    expect(pod.files.get(PEOPLE)?.etag).toBe(peopleEtag);
    expect(controller.getSnapshot().data.book?.url).toBe(BOOK);
    expect(pod.files.get(INDEX)?.body).toContain("UnlistedDocument");
    expect(pod.files.get(`${ROOT}settings/prefs.ttl`)?.body).toContain(INDEX);
    expect(pod.files.get(`${ROOT}profile/card`)?.body).toContain("preferencesFile");
  });
  it("tolerates a genuinely missing linked preferences document during discovery", async () => {
    const { controller, pod } = await controllerSetup();
    pod.seed(
      `${ROOT}profile/card`,
      `@prefix pim: <http://www.w3.org/ns/pim/space#>. <#me> pim:preferencesFile <${ROOT}settings/prefs.ttl>.`,
    );
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("ready");
  });
  it.each([
    PEOPLE,
    PM,
  ])("resumes a partial migration after failing %s with exactly one destination", async (failedUrl) => {
    const { controller, pod } = await controllerSetup();
    pod.fail = (url, method) =>
      url === failedUrl && method === (url === PM ? "DELETE" : "PUT")
        ? new Response(null, { status: 503 })
        : undefined;
    expect(await controller.migrate()).toEqual({ moved: 0, failed: 1 });
    expect(pod.files.has(PM)).toBe(true);
    const destinations = () =>
      pod.writes.filter((r) => r.method === "PUT" && r.headers.get("if-none-match") === "*");
    expect(destinations()).toHaveLength(1);
    pod.fail = undefined;
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("ready");
    expect(destinations()).toHaveLength(1);
    expect(
      controller.getSnapshot().data.people.filter((p) => p.data.name === "Pat Morgan"),
    ).toHaveLength(1);
    expect(pod.files.has(PM)).toBe(false);
  });
  it("keeps a changed migration source safe and resumes an unstarted destination", async () => {
    const { controller, pod } = await controllerSetup();
    let first = true;
    pod.fail = (url, method) => {
      if (method === "PUT" && url.includes("/people/") && first) {
        first = false;
        return new Response(null, { status: 503 });
      }
      if (url === PM && method === "DELETE") return new Response(null, { status: 503 });
      return undefined;
    };
    expect(await controller.migrate()).toEqual({ moved: 0, failed: 1 });
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("error");
    pod.seed(
      PM,
      `${pod.files.get(PM)?.body}\n<#it> <https://example.org/changed> "new data".`,
      '"changed"',
    );
    pod.fail = undefined;
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("ready");
    expect(pod.files.has(PM)).toBe(true);
    expect(
      pod.writes
        .filter((r) => r.headers.get("if-none-match") === "*" && r.method === "PUT")
        .map((r) => r.url),
    ).toEqual([expect.any(String), expect.any(String)]);
    expect(
      (await controller.model.loadPeople(await controller.model.loadAddressBook())).data,
    ).toHaveLength(2);
  });
  it("migrates sources sequentially, preserves fields, and reports partial failures", async () => {
    const { controller, pod } = await controllerSetup();
    pod.seed(
      `${ROOT}contacts/legacy2.ttl`,
      `${VCARD_PREFIX} <#it> a vcard:Individual; vcard:fn "Second"; vcard:hasEmail <mailto:second@example.org>.`,
    );
    pod.seed(
      INDEX,
      `${pod.files.get(INDEX)?.body}\n@prefix solid: <http://www.w3.org/ns/solid/terms#>. @prefix vcard: <http://www.w3.org/2006/vcard/ns#>. <#second> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instance <${ROOT}contacts/legacy2.ttl#it>.`,
    );
    await controller.refresh();
    pod.fail = (url, method) =>
      url === `${ROOT}contacts/legacy2.ttl` && method === "GET"
        ? new Response(null, { status: 503 })
        : undefined;
    expect(await controller.migrate()).toEqual({ moved: 1, failed: 1 });
    expect(pod.files.has(PM)).toBe(false);
    expect(pod.files.has(`${ROOT}contacts/legacy2.ttl`)).toBe(true);
    pod.fail = undefined;
    await controller.refresh();
    expect(await controller.migrate()).toEqual({ moved: 1, failed: 0 });
  });
  it("handles group documents without members during every optimistic membership operation", async () => {
    const { controller } = await controllerSetup();
    const person = controller.getSnapshot().data.people[0];
    if (!person) throw new Error("fixture");
    const group = { url: FRIENDS, dataset: new Store(), etag: '"1"', data: { name: "Friends" } };
    vi.spyOn(controller.model, "loadGroup").mockResolvedValue(group);
    await controller.refresh(false);
    const set = vi.spyOn(controller.model, "setGroupMembers").mockResolvedValue();
    await controller.setLabel(`${ALICE}#this`, `${FRIENDS}#this`, true);
    expect(set).toHaveBeenCalledWith(group, [`${ALICE}#this`]);
    await controller.delete(`${ALICE}#this`);
    await controller.restore(person, [`${FRIENDS}#this`]);
  });
  it("classifies nested conflicts and ordinary failures without exposing personal data", () => {
    expect(
      writeMessage(new PartialWriteError(["url"], new ContactsWriteError(412, "secret", null))),
    ).toContain("changed elsewhere");
    expect(writeMessage(new Error("secret"))).not.toContain("secret");
    expect(writeMessage(new ContactsWriteError(500, "secret", null))).toContain("Could not save");
  });
});
