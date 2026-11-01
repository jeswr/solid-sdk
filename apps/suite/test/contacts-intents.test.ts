// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { describe, expect, it, vi } from "vitest";
import { openDocument, saveDocument } from "../src/apps/contacts/lib/model/intent";
import { PartialWriteError } from "../src/apps/contacts/lib/model/transport";
import { ContactsController } from "../src/apps/contacts/state/controller";
import { type DeleteToken, IntentRunner, newIntent } from "../src/apps/contacts/state/intents";
import { type Intent, IntentJournal } from "../src/apps/contacts/state/journal";
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
const PROFILE = `${ROOT}profile/card`;
const PREFS = `${ROOT}settings/prefs.ttl`;
async function harness() {
  const { pod } = await setup();
  pod.seed(
    PEOPLE,
    `${VCARD_PREFIX} <${ALICE}#this> vcard:fn "Alice"; vcard:inAddressBook <${BOOK}#this>.`,
  );
  pod.seed(
    PROFILE,
    `@prefix solid: <http://www.w3.org/ns/solid/terms#>. <#me> solid:privateTypeIndex <${INDEX}>.`,
  );
  pod.seed(
    INDEX,
    `@prefix solid: <http://www.w3.org/ns/solid/terms#>. @prefix vcard: <http://www.w3.org/2006/vcard/ns#>. <#book> a solid:TypeRegistration; solid:forClass vcard:AddressBook; solid:instance <${BOOK}#this>. <#pm> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instance <${PM}#it>.`,
  );
  const storage = new MemoryIntentStorage();
  const errors = vi.fn();
  const deleted = vi.fn<(token: DeleteToken) => void>();
  const fresh = () =>
    new ContactsController(pod.fetch, ROOT, WEBID, errors, () => storage, deleted);
  const controller = fresh();
  await controller.refresh();
  const intents = () => [...storage.values.values()].map((value) => JSON.parse(value) as Intent);
  return { pod, storage, errors, deleted, fresh, controller, intents };
}
function ready(controller: ContactsController) {
  expect(controller.getSnapshot().status, String(controller.getSnapshot().error)).toBe("ready");
}

describe("Contacts durable intent recovery across controller lifetimes", () => {
  it.each([
    "412",
    "lost-person-response",
  ])("CON-01: recovers an unindexed creation (%s) at its original URL and UID", async (failure) => {
    const { pod, controller, fresh, intents, storage } = await harness();
    const destination = `${ROOT}contacts/people/new.ttl`;
    let journalAtFirstWrite: Intent | undefined;
    pod.fail = (url, method) => {
      if (method === "PUT" && url === destination) {
        journalAtFirstWrite = intents()[0];
        if (failure === "lost-person-response") {
          pod.seed(destination, pod.requests.at(-1)?.body as string, '"created"');
          throw new Error("connection lost after PUT");
        }
      }
      if (url === PEOPLE && method === "PUT") return new Response(null, { status: 412 });
      return undefined;
    };
    await expect(controller.create({ name: "Mira", note: "Keep" }, destination)).rejects.toThrow();
    expect(journalAtFirstWrite).toMatchObject({
      kind: "create",
      destination,
      completed: [],
      bookUrl: BOOK,
    });
    expect(journalAtFirstWrite?.person?.turtle).toContain("urn:uuid:");
    expect(pod.files.has(destination)).toBe(true);
    expect(controller.getSnapshot().status).toBe("error");
    pod.fail = undefined;
    const reopened = fresh();
    expect(reopened.getSnapshot().status).toBe("loading");
    await reopened.refresh();
    ready(reopened);
    expect(
      reopened.getSnapshot().data.people.filter((person) => person.url === destination),
    ).toHaveLength(1);
    expect((await reopened.model.loadContact(destination)).data.note).toBe("Keep");
    expect(pod.writes.filter((write) => write.url === destination)).toHaveLength(1);
    expect(storage.length).toBe(0);
    await fresh().refresh();
    expect(pod.writes.filter((write) => write.url === destination)).toHaveLength(1);
  });

  it("persists failed-delete repairs, their RDF and fresh memberships before any destructive write", async () => {
    const { pod, controller, fresh, intents, storage, deleted } = await harness();
    await controller.update(`${ALICE}#this`, { note: "Latest confirmed note" });
    const confirmed = await controller.model.loadContact(ALICE);
    let removed = false;
    pod.fail = (url, method) => {
      if (url === FRIENDS && method === "PUT") {
        expect(intents()[0]).toMatchObject({ kind: "delete", labels: [FRIENDS] });
        expect(intents()[0]?.person?.turtle).toContain("Latest confirmed note");
      }
      if (url === PEOPLE && method === "PUT") {
        if (removed) return new Response(null, { status: 503 });
        removed = true;
      }
      return url === ALICE && method === "DELETE" ? new Response(null, { status: 503 }) : undefined;
    };
    await expect(controller.delete(`${ALICE}#this`)).rejects.toThrow();
    expect(controller.getSnapshot().status).toBe("error");
    expect(intents()[0]).toMatchObject({ phase: "rollback", completed: [FRIENDS, "index"] });
    // A second mount must stay in error while the repair still cannot finish.
    const reopened = fresh();
    await reopened.refresh();
    expect(reopened.getSnapshot().status).toBe("error");
    pod.fail = undefined;
    const recovered = fresh();
    await recovered.refresh();
    ready(recovered);
    expect(recovered.getSnapshot().data.people[0]?.data.note).toBe("Latest confirmed note");
    expect(recovered.getSnapshot().data.groups[0]?.data.members).toContain(`${ALICE}#this`);
    expect(
      isomorphic([...(await recovered.model.loadContact(ALICE)).dataset], [...confirmed.dataset]),
    ).toBe(true);
    expect(deleted).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
  });

  it("returns Undo's serialized confirmed snapshot after queued edits settle, and restores it from a fresh controller", async () => {
    const { controller, fresh, pod } = await harness();
    pod.seed(ALICE, `${pod.files.get(ALICE)?.body}\n<#extra> <https://example.org/custom> "keep".`);
    await controller.refresh();
    const stale = controller.getSnapshot().data.people[0];
    const update = controller.update(`${ALICE}#this`, {
      note: "Saved immediately before deletion",
    });
    const deletion = controller.delete(`${ALICE}#this`);
    await update;
    const token = await deletion;
    expect(token.person.turtle).toContain("Saved immediately before deletion");
    expect(stale?.data.note).not.toBe("Saved immediately before deletion");
    const reopened = fresh();
    await reopened.refresh();
    await reopened.undo(token);
    ready(reopened);
    const restored = await reopened.model.loadContact(ALICE);
    expect(restored.data.note).toBe("Saved immediately before deletion");
    expect(restored.dataset.match(DataFactory.namedNode(`${ALICE}#extra`)).size).toBe(1);
    expect((await reopened.model.loadGroup(FRIENDS)).data.members).toContain(`${ALICE}#this`);
  });

  it("treats a DELETE persisted before throwing as absence after remount, with actionable Undo of the latest RDF", async () => {
    const { controller, pod, fresh, deleted, storage } = await harness();
    const update = controller.update(`${ALICE}#this`, { note: "Newest note" });
    let deletedAtServer = false;
    pod.fail = (url, method) => {
      if (url !== ALICE) return undefined;
      if (method === "DELETE") {
        pod.files.delete(ALICE);
        deletedAtServer = true;
        throw new Error("lost DELETE response");
      }
      if (method === "GET" && deletedAtServer) return new Response(null, { status: 503 });
      return undefined;
    };
    const deletion = controller.delete(`${ALICE}#this`);
    await update;
    await expect(deletion).rejects.toThrow();
    expect(controller.getSnapshot().status).toBe("error");
    expect(storage.length).toBe(1);
    pod.fail = undefined;
    const reopened = fresh();
    await reopened.refresh();
    ready(reopened);
    expect(reopened.getSnapshot().data.people).toEqual([]);
    expect(deleted).toHaveBeenCalledOnce();
    const token = deleted.mock.calls[0]?.[0] as DeleteToken;
    expect(token.person.turtle).toContain("Newest note");
    expect(storage.length).toBe(0);
    await reopened.undo(token);
    expect((await reopened.model.loadContact(ALICE)).data.note).toBe("Newest note");
    expect((await reopened.model.loadGroup(FRIENDS)).data.members).toContain(`${ALICE}#this`);
  });

  it.each([
    PEOPLE,
    PM,
  ])("reopens a migration failed at %s without minting another destination", async (failedUrl) => {
    const { pod, controller, fresh, intents, storage } = await harness();
    pod.fail = (url, method) =>
      url === failedUrl && method === (url === PM ? "DELETE" : "PUT")
        ? new Response(null, { status: 503 })
        : undefined;
    expect(await controller.migrate()).toEqual({ moved: 0, failed: 1 });
    const pending = intents()[0] as Intent;
    expect(pending).toMatchObject({ kind: "migrate", source: { url: PM } });
    const reopened = fresh();
    await reopened.refresh();
    expect(reopened.getSnapshot().status).toBe("error");
    expect(intents()[0]?.destination).toBe(pending.destination);
    pod.fail = undefined;
    await reopened.refresh();
    ready(reopened);
    expect(
      reopened.getSnapshot().data.people.filter((person) => person.data.name === "Pat Morgan"),
    ).toHaveLength(1);
    expect(pod.files.has(PM)).toBe(false);
    expect(
      pod.writes.filter((write) => write.method === "PUT" && write.url === pending.destination),
    ).toHaveLength(1);
    expect(storage.length).toBe(0);
    expect(await reopened.migrate()).toEqual({ moved: 0, failed: 0 });
  });

  it.each([
    GROUPS,
    BOOK,
    INDEX,
    PREFS,
    PROFILE,
  ])("resumes address-book bootstrap failed at %s across a fresh controller", async (failedUrl) => {
    const { controller, pod, fresh, storage } = await harness();
    for (const url of [BOOK, PEOPLE, GROUPS, INDEX]) pod.files.delete(url);
    pod.seed(PROFILE, "");
    await controller.refresh();
    pod.fail = (url, method) =>
      url === failedUrl && method === "PUT" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.createBook()).rejects.toThrow();
    expect(storage.length).toBe(1);
    const peopleEtag = pod.files.get(PEOPLE)?.etag;
    pod.fail = undefined;
    const reopened = fresh();
    await reopened.refresh();
    ready(reopened);
    expect(reopened.getSnapshot().data.book?.url).toBe(BOOK);
    expect(reopened.getSnapshot().data.registrationPending).toBe(false);
    expect(pod.files.get(PEOPLE)?.etag).toBe(peopleEtag);
    expect(pod.files.get(PROFILE)?.body).toContain("preferencesFile");
    expect(pod.files.get(INDEX)?.body).toContain("contacts-");
    expect(storage.length).toBe(0);
  });

  it("replays a partially completed Undo after remount without replacing RDF or unrelated memberships", async () => {
    const { controller, pod, fresh, storage } = await harness();
    const token = await controller.delete(`${ALICE}#this`);
    pod.fail = (url, method) =>
      url === PEOPLE && method === "PUT" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.undo(token)).rejects.toThrow();
    const etag = pod.files.get(ALICE)?.etag;
    pod.fail = undefined;
    const reopened = fresh();
    await reopened.refresh();
    ready(reopened);
    expect(pod.files.get(ALICE)?.etag).toBe(etag);
    expect((await reopened.model.loadGroup(FRIENDS)).data.members).toContain(`${ALICE}#this`);
    expect(storage.length).toBe(0);
  });

  it("does not replay another WebID's or book's intents", async () => {
    const { controller, storage } = await harness();
    const other = new IntentJournal("https://other.example/#me", BOOK, vi.fn(), () => storage);
    storage.setItem(`${other.prefix}invalid`, "invalid JSON");
    const anotherBook = new IntentJournal(WEBID, `${ROOT}other/book.ttl`, vi.fn(), () => storage);
    storage.setItem(`${anotherBook.prefix}invalid`, "invalid JSON");
    await controller.refresh();
    ready(controller);
    expect(storage.length).toBe(2);
  });

  it("replays an interrupted delete and the completed notification checkpoint without re-deleting a restored person", async () => {
    const { controller, fresh, storage, deleted } = await harness();
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => storage);
    const saved = await saveDocument(await controller.model.loadContact(ALICE));
    const intent = newIntent("delete", BOOK, ALICE, { person: saved, labels: [FRIENDS] });
    journal.put(intent);
    const reopened = fresh();
    await reopened.refresh();
    ready(reopened);
    expect(reopened.getSnapshot().data.people).toEqual([]);
    expect(deleted).toHaveBeenCalledOnce();
    await reopened.undo(deleted.mock.calls[0]?.[0] as DeleteToken);
    intent.completed = ["done"];
    journal.put(intent); // Simulates a lost journal-removal acknowledgement.
    const another = fresh();
    await another.refresh();
    ready(another);
    expect((await another.model.loadContact(ALICE)).data.name).toBe("Alice");
    expect(deleted).toHaveBeenCalledTimes(2);
  });

  it("finishes a rollback whose person vanished meanwhile and ignores labels never removed", async () => {
    const { controller, pod, storage } = await harness();
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => storage);
    const person = await saveDocument(await controller.model.loadContact(ALICE));
    const intent = newIntent("delete", BOOK, ALICE, { person, labels: [FRIENDS] });
    intent.phase = "rollback";
    intent.repairs = [];
    const deleted = vi.fn();
    const runner = new IntentRunner(controller.model, WEBID, deleted);
    journal.put(intent);
    await runner.run(journal, intent);
    expect((await controller.model.loadGroup(FRIENDS)).data.members).toContain(`${ALICE}#this`);
    expect(deleted).not.toHaveBeenCalled();
    const vanished = newIntent("delete", BOOK, ALICE, { person, labels: [FRIENDS] });
    vanished.phase = "rollback";
    pod.files.delete(ALICE);
    journal.put(vanished);
    await runner.run(journal, vanished);
    expect(deleted).toHaveBeenCalledOnce();
    expect(
      (await controller.model.loadPeople(await controller.model.loadAddressBook())).data,
    ).toEqual([]);
    expect(storage.length).toBe(0);
  });

  it("registers an existing book, and retains transport-confirmed partial steps", async () => {
    const { controller, storage, pod } = await harness();
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => storage);
    const runner = new IntentRunner(controller.model, WEBID, vi.fn());
    const intent = newIntent("book", BOOK, INDEX);
    journal.put(intent);
    await runner.run(journal, intent);
    expect(pod.files.get(INDEX)?.body).toContain("contacts-");
    const plan = await controller.model.planContact(
      await controller.model.loadAddressBook(),
      { name: "Mira" },
      `${ROOT}contacts/people/mira.ttl`,
    );
    const create = newIntent("create", BOOK, plan.document.url, {
      person: await saveDocument(plan.document),
    });
    const commit = controller.model.transport.commit.bind(controller.model.transport);
    vi.spyOn(controller.model.transport, "commit").mockImplementationOnce(async (changes) => {
      await commit(changes);
      throw new PartialWriteError([plan.document.url], new Error("lost outer response"));
    });
    await expect(runner.run(journal, create)).rejects.toBeInstanceOf(PartialWriteError);
    expect(journal.list()[0]?.completed).toContain(plan.document.url);
    await runner.run(journal, journal.list()[0] as Intent);
    expect(storage.length).toBe(0);
  });

  it("retries an in-flight create by its durable destination before a refresh, including unrelated records", async () => {
    const { controller, storage, pod } = await harness();
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => storage);
    const destination = `${ROOT}contacts/people/mira.ttl`;
    const book = await controller.model.loadAddressBook();
    const plan = await controller.model.planContact(book, { name: "Mira" }, destination);
    const unrelated = newIntent("book", BOOK, INDEX);
    unrelated.completed = ["done"];
    journal.put(unrelated);
    journal.put(
      newIntent("create", BOOK, `${ROOT}contacts/people/another.ttl`, {
        person: await saveDocument(
          (
            await controller.model.planContact(
              book,
              { name: "Another" },
              `${ROOT}contacts/people/another.ttl`,
            )
          ).document,
        ),
      }),
    );
    journal.put(
      newIntent("create", BOOK, destination, { person: await saveDocument(plan.document) }),
    );
    await controller.create({ name: "Mira" }, destination);
    ready(controller);
    expect(
      controller.getSnapshot().data.people.filter((person) => person.data.name === "Mira"),
    ).toHaveLength(1);
    expect(pod.writes.filter((write) => write.url === destination)).toHaveLength(1);
    expect(storage.length).toBe(0);
  });

  it("retries durable delete and Undo records using their original snapshots", async () => {
    const { controller, storage } = await harness();
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => storage);
    const person = await saveDocument(await controller.model.loadContact(ALICE));
    const irrelevant = newIntent("book", BOOK, INDEX);
    irrelevant.completed = ["done"];
    journal.put(irrelevant);
    const otherDelete = newIntent("delete", BOOK, "other");
    otherDelete.completed = ["done", "rolled-back"];
    journal.put(otherDelete);
    journal.put(newIntent("delete", BOOK, ALICE, { person, labels: [FRIENDS] }));
    const token = await controller.delete(`${ALICE}#this`);
    journal.put(irrelevant);
    const otherRestore = newIntent("restore", BOOK, "other");
    otherRestore.completed = ["done"];
    journal.put(otherRestore);
    journal.put(newIntent("restore", BOOK, ALICE, { person, labels: [FRIENDS] }));
    await controller.restore(await openDocument(token.person), [`${FRIENDS}#this`]);
    ready(controller);
    expect((await controller.model.loadContact(ALICE)).data.name).toBe("Alice");
    expect(storage.length).toBe(0);
  });

  it("reuses a journaled migration on Retry before remount and cleans completed historical records", async () => {
    const { controller, storage } = await harness();
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => storage);
    const destination = `${ROOT}contacts/people/pat.ttl`;
    const { plan, source } = await controller.model.planMigration(
      await controller.model.loadAddressBook(),
      PM,
      destination,
    );
    const unrelated = newIntent("book", BOOK, INDEX);
    unrelated.completed = ["done"];
    journal.put(unrelated);
    const historical = newIntent("migrate", BOOK, `${ROOT}contacts/historical.ttl`);
    historical.completed = ["done"];
    journal.put(historical);
    journal.put(
      newIntent("migrate", BOOK, destination, {
        person: await saveDocument(plan.document),
        source: await saveDocument(source),
      }),
    );
    expect(await controller.migrate()).toEqual({ moved: 1, failed: 0 });
    ready(controller);
    expect(
      controller.getSnapshot().data.people.filter((person) => person.url === destination),
    ).toHaveLength(1);
    expect(storage.length).toBe(0);
  });

  it("discovers and recovers an alternate book under its normalized document URL", async () => {
    const { controller, storage, fresh, pod } = await harness();
    const alternate = `${ROOT}contacts/other.ttl`;
    pod.seed(alternate, `${VCARD_PREFIX} <#this> a vcard:AddressBook; vcard:fn "Other book".`);
    pod.seed(
      INDEX,
      `@prefix solid: <http://www.w3.org/ns/solid/terms#>. ${VCARD_PREFIX} <#book> a solid:TypeRegistration; solid:forClass vcard:AddressBook; solid:instance <${alternate}#this>.`,
    );
    const book = await controller.model.loadAddressBook(alternate);
    const destination = `${ROOT}contacts/people/alternate.ttl`;
    const plan = await controller.model.planContact(book, { name: "Alternate" }, destination);
    const journal = new IntentJournal(WEBID, alternate, vi.fn(), () => storage);
    journal.put(
      newIntent("create", alternate, destination, { person: await saveDocument(plan.document) }),
    );
    const reopened = fresh();
    await reopened.refresh();
    ready(reopened);
    expect(reopened.getSnapshot().data.book?.url).toBe(alternate);
    expect(reopened.getSnapshot().data.people[0]?.data.name).toBe("Alternate");
    await reopened.createBook();
    expect(pod.files.get(INDEX)?.body).toContain(`${alternate}#this`);
    expect(storage.length).toBe(0);
  });

  it("serializes two freshly opened controllers recovering the same migration", async () => {
    const { controller, pod, fresh, storage } = await harness();
    pod.fail = (url, method) =>
      url === PM && method === "DELETE" ? new Response(null, { status: 503 }) : undefined;
    expect(await controller.migrate()).toEqual({ moved: 0, failed: 1 });
    pod.fail = undefined;
    const first = fresh();
    const second = fresh();
    await Promise.all([first.refresh(), second.refresh()]);
    for (const opened of [first, second]) {
      ready(opened);
      expect(opened.getSnapshot().data.flat).toEqual([]);
      expect(
        opened.getSnapshot().data.people.filter((person) => person.data.name === "Pat Morgan"),
      ).toHaveLength(1);
    }
    expect(
      pod.writes.filter(
        (write) => write.method === "PUT" && write.headers.get("if-none-match") === "*",
      ),
    ).toHaveLength(1);
    expect(storage.length).toBe(0);
  });
});
