// AUTHORED-BY Claude Opus 5.5
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discardCreated,
  ensureCreated,
  openDocument,
  saveDocument,
} from "../src/apps/contacts/lib/model/intent";
import {
  isExpired,
  parseTrash,
  TRASH_RETENTION_DAYS,
  TrashRecord,
  trashContainer,
  trashDocument,
  trashedPerson,
} from "../src/apps/contacts/lib/model/trash";
import { ContactsController } from "../src/apps/contacts/state/controller";
import { type DeleteToken, IntentRunner, newIntent } from "../src/apps/contacts/state/intents";
import { type Intent, IntentJournal } from "../src/apps/contacts/state/journal";
import {
  ALICE,
  BOOK,
  FRIENDS,
  INDEX,
  MemoryIntentStorage,
  type MemoryPod,
  PEOPLE,
  parse,
  ROOT,
  setup,
  VCARD_PREFIX,
} from "./contacts-support";

const WEBID = `${ROOT}profile/card#me`;
const TRASH = `${ROOT}contacts/.trash/`;
const LDP = "http://www.w3.org/ns/ldp#";
const DAY = 24 * 60 * 60 * 1000;
const { namedNode, quad } = DataFactory;

/** Serve LDP containment for container GETs, as a Solid server would. */
function listContainers(pod: MemoryPod) {
  const files = pod.fetch;
  pod.fetch = async (input, init) => {
    const url = String(input);
    if ((init?.method ?? "GET") === "GET" && url.endsWith("/") && !pod.fail?.(url, "GET")) {
      const members = new Set<string>();
      for (const file of pod.files.keys()) {
        if (!file.startsWith(url) || file === url) continue;
        const rest = file.slice(url.length);
        members.add(url + (rest.includes("/") ? rest.slice(0, rest.indexOf("/") + 1) : rest));
      }
      if (!members.size) return files(input, init);
      const body = await serialize(
        [...members].map((member) =>
          quad(namedNode(url), namedNode(`${LDP}contains`), namedNode(member)),
        ),
      );
      return new Response(body, { headers: { "content-type": "text/turtle", etag: '"c"' } });
    }
    return files(input, init);
  };
}

async function harness() {
  const { pod } = await setup();
  listContainers(pod);
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
    `@prefix solid: <http://www.w3.org/ns/solid/terms#>. @prefix vcard: <http://www.w3.org/2006/vcard/ns#>. <#book> a solid:TypeRegistration; solid:forClass vcard:AddressBook; solid:instance <${BOOK}#this>.`,
  );
  const storage = new MemoryIntentStorage();
  const errors = vi.fn();
  const deleted = vi.fn<(token: DeleteToken) => void>();
  const fresh = () =>
    new ContactsController(pod.fetch, ROOT, WEBID, errors, () => storage, deleted);
  const controller = fresh();
  await controller.refresh();
  expect(controller.getSnapshot().status, String(controller.getSnapshot().error)).toBe("ready");
  const trashFiles = () => [...pod.files.keys()].filter((url) => url.startsWith(TRASH));
  return { pod, storage, errors, deleted, fresh, controller, trashFiles };
}

/** Seed a trashed copy of Alice, deleted `days` ago, at `.trash/<name>`. */
async function seedTrash(
  pod: MemoryPod,
  name: string,
  days: number,
  { original = ALICE, labels = [`${FRIENDS}#this`] } = {},
) {
  const { model } = await setup();
  const person = await model.loadContact(ALICE);
  const url = `${TRASH}${name}`;
  const dataset = trashDocument(
    url,
    { url: original, dataset: person.dataset },
    { deletedAt: new Date(Date.now() - days * DAY), labels },
  );
  if (original !== ALICE) {
    for (const q of [...dataset]) {
      if (q.subject.value === `${ALICE}#this`) {
        dataset.delete(q);
        dataset.add(quad(namedNode(`${original}#this`), q.predicate, q.object));
      }
    }
  }
  await pod.seedDataset(url, dataset);
  return url;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Contacts trash documents", () => {
  it("keeps the person's RDF intact and records the trash metadata through the wrapper", async () => {
    const { model } = await setup();
    const person = await model.loadContact(ALICE);
    const url = `${TRASH}a.ttl`;
    const deletedAt = new Date("2026-10-30T10:00:00Z");
    const dataset = trashDocument(url, person, {
      deletedAt,
      labels: [`${FRIENDS}#this`],
      deletedBy: WEBID,
    });
    const reparsed = await parse(await serialize([...dataset]), url);
    const trash = parseTrash(url, reparsed);
    expect(trash).toEqual({
      original: ALICE,
      deletedAt,
      deletedBy: WEBID,
      labels: [`${FRIENDS}#this`],
      contact: person.data,
    });
    expect(isomorphic([...trashedPerson(url, reparsed)], [...person.dataset])).toBe(true);
    const record = new TrashRecord(url, reparsed, DataFactory);
    record.deletedBy = undefined;
    expect(parseTrash(url, reparsed).deletedBy).toBeUndefined();
  });
  it("rejects documents that are not trashed individuals", async () => {
    const { model } = await setup();
    const person = await model.loadContact(ALICE);
    const url = `${TRASH}b.ttl`;
    const valid = () => trashDocument(url, person, { deletedAt: new Date(), labels: [] });
    const without = (predicate: string) => {
      const dataset = valid();
      for (const q of [...dataset.match(namedNode(url), namedNode(predicate))]) dataset.delete(q);
      return dataset;
    };
    expect(() => parseTrash(url, new Store())).toThrow(TypeError);
    expect(() =>
      parseTrash(url, without("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")),
    ).toThrow(TypeError);
    expect(() => parseTrash(url, without("http://www.w3.org/ns/prov#wasDerivedFrom"))).toThrow(
      TypeError,
    );
    expect(() => parseTrash(url, without("http://www.w3.org/ns/prov#invalidatedAtTime"))).toThrow(
      TypeError,
    );
    const invalidDate = without("http://www.w3.org/ns/prov#invalidatedAtTime");
    invalidDate.add(
      quad(
        namedNode(url),
        namedNode("http://www.w3.org/ns/prov#invalidatedAtTime"),
        DataFactory.literal("not a date", namedNode("http://www.w3.org/2001/XMLSchema#dateTime")),
      ),
    );
    expect(() => parseTrash(url, invalidDate)).toThrow(TypeError);
    const notPerson = trashDocument(
      url,
      { url: `${ROOT}contacts/people/nobody.ttl`, dataset: new Store() },
      { deletedAt: new Date(), labels: [] },
    );
    expect(() => parseTrash(url, notPerson)).toThrow(TypeError);
  });
  it("expires after the retention period and lives beside the book", () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    expect(TRASH_RETENTION_DAYS).toBe(30);
    expect(isExpired(new Date(now - 30 * DAY), now)).toBe(false);
    expect(isExpired(new Date(now - 30 * DAY - 1), now)).toBe(true);
    expect(isExpired(new Date())).toBe(false);
    expect(trashContainer(BOOK)).toBe(TRASH);
  });
  it("creates idempotently and discards only an unchanged copy", async () => {
    const { model, pod } = await setup();
    const url = `${TRASH}c.ttl`;
    const saved = await saveDocument({
      url,
      etag: null,
      dataset: trashDocument(url, await model.loadContact(ALICE), {
        deletedAt: new Date(),
        labels: [],
      }),
    });
    await discardCreated(model, saved); // Absent: nothing to do.
    await ensureCreated(model, saved);
    await ensureCreated(model, saved); // Replay adopts the identical document.
    expect(pod.writes.filter((write) => write.url === url)).toHaveLength(1);
    const other = { ...saved, turtle: `${VCARD_PREFIX} <#x> vcard:fn "Other".` };
    await expect(ensureCreated(model, other)).rejects.toMatchObject({ status: 412 });
    await discardCreated(model, other); // Changed elsewhere: kept.
    expect(pod.files.has(url)).toBe(true);
    await discardCreated(model, saved);
    expect(pod.files.has(url)).toBe(false);
  });
});

describe("Contacts app-managed trash", () => {
  it("moves a contact with its labels to the trash, then restores it intact (Undo)", async () => {
    const { controller, pod, deleted, storage, trashFiles } = await harness();
    const before = await controller.model.loadContact(ALICE);
    const deletion = controller.delete(`${ALICE}#this`);
    const optimistic = controller.getSnapshot().data;
    expect(optimistic.people).toEqual([]);
    expect(optimistic.trash).toHaveLength(1);
    expect(optimistic.trash[0]?.data).toMatchObject({
      original: ALICE,
      labels: [`${FRIENDS}#this`],
      contact: { name: "Alice" },
    });
    const token = await deletion;
    expect(token.trash).toMatch(/^https:\/\/pod\.example\/alice\/contacts\/\.trash\/.+\.ttl$/);
    expect(deleted).toHaveBeenCalledWith(token);
    expect(storage.length).toBe(0);
    expect(pod.files.has(ALICE)).toBe(false);
    expect(trashFiles()).toEqual([token.trash]);
    const data = controller.getSnapshot().data;
    expect(data.people).toEqual([]);
    expect(data.groups[0]?.data.members ?? []).toEqual([]);
    expect(data.trash.map((item) => item.url)).toEqual([token.trash]);
    expect(data.trash[0]?.data).toMatchObject({ deletedBy: WEBID, labels: [`${FRIENDS}#this`] });
    expect(data.trashIncomplete).toBe(false);

    const restoring = controller.undo(token);
    expect(controller.getSnapshot().data.trash).toEqual([]);
    expect(controller.getSnapshot().data.people[0]?.url).toBe(ALICE);
    expect(controller.getSnapshot().data.groups[0]?.data.members).toContain(`${ALICE}#this`);
    await restoring;
    expect(trashFiles()).toEqual([]);
    expect(storage.length).toBe(0);
    const restored = await controller.model.loadContact(ALICE);
    expect(isomorphic([...restored.dataset], [...before.dataset])).toBe(true);
    expect((await controller.model.loadGroup(FRIENDS)).data.members).toContain(`${ALICE}#this`);
    expect(controller.getSnapshot().data.people.map((p) => p.url)).toEqual([ALICE]);
  });
  it("lists trash newest first, skips foreign documents and purges expired items on load", async () => {
    const { controller, pod, fresh } = await harness();
    await seedTrash(pod, "old.ttl", 31);
    await seedTrash(pod, "gone.ttl", 40);
    await seedTrash(pod, "stuck.ttl", 45);
    const recent = await seedTrash(pod, "recent.ttl", 1);
    const tieA = await seedTrash(pod, "tie-a.ttl", 2);
    const tieB = `${TRASH}tie-b.ttl`;
    pod.seed(tieB, pod.files.get(tieA)?.body.replaceAll("tie-a", "tie-b") as string);
    pod.seed(`${TRASH}junk.ttl`, `${VCARD_PREFIX} <#x> vcard:fn "Not trash".`);
    await seedTrash(pod, "escape.ttl", 1, { original: `${ROOT}elsewhere/x.ttl` });
    await seedTrash(pod, "nested.ttl", 1, { original: `${TRASH}inner.ttl` });
    pod.seed(`${TRASH}sub/child.ttl`, `${VCARD_PREFIX} <#x> vcard:fn "Nested".`);
    pod.fail = (url, method) => {
      if (method !== "DELETE") return undefined;
      if (url.endsWith("gone.ttl")) {
        pod.files.delete(url);
        return new Response(null, { status: 404 });
      }
      return url.endsWith("stuck.ttl") ? new Response(null, { status: 412 }) : undefined;
    };
    await controller.refresh();
    const data = controller.getSnapshot().data;
    expect(data.trash.map((item) => item.url)).toEqual([recent, tieA, tieB, `${TRASH}stuck.ttl`]);
    expect(data.trashIncomplete).toBe(false);
    expect(pod.files.has(`${TRASH}old.ttl`)).toBe(false);
    expect(pod.files.has(`${TRASH}junk.ttl`)).toBe(true);
    // The person is still listed only once: trash never feeds the address book.
    expect(data.people.map((person) => person.url)).toEqual([ALICE]);
    pod.fail = undefined;
    const reopened = fresh();
    await reopened.refresh();
    expect(reopened.getSnapshot().data.trash.map((item) => item.url)).toEqual([recent, tieA, tieB]);
  });
  it("reports unreadable trash without blocking the address book", async () => {
    const { controller, pod } = await harness();
    await seedTrash(pod, "a.ttl", 1);
    const b = await seedTrash(pod, "b.ttl", 2);
    pod.fail = (url) => (url === b ? new Response(null, { status: 503 }) : undefined);
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().data.trash).toHaveLength(1);
    expect(controller.getSnapshot().data.trashIncomplete).toBe(true);
    pod.fail = (url) => (url === TRASH ? new Response(null, { status: 503 }) : undefined);
    await controller.refresh();
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().data.trash).toEqual([]);
    expect(controller.getSnapshot().data.trashIncomplete).toBe(true);
    pod.fail = (url) => (url === b ? new Response(null, { status: 404 }) : undefined);
    await controller.refresh();
    expect(controller.getSnapshot().data.trashIncomplete).toBe(false);
  });
  it("restores into surviving labels only and refuses an occupied original document", async () => {
    const { controller, pod, trashFiles, storage } = await harness();
    const token = await controller.delete(`${ALICE}#this`);
    const url = token.trash as string;
    pod.seed(ALICE, `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Someone new".`);
    await expect(controller.restoreTrash(url)).rejects.toMatchObject({ status: 412 });
    expect(trashFiles()).toEqual([url]);
    expect(storage.length).toBe(0);
    pod.files.delete(ALICE);
    await controller.deleteLabel(`${FRIENDS}#this`);
    await controller.restoreTrash(url);
    expect(trashFiles()).toEqual([]);
    expect((await controller.model.loadContact(ALICE)).data.name).toBe("Alice");
    expect(controller.getSnapshot().data.groups).toEqual([]);
    // A trash item that vanished before its restore started is reported, never invented.
    await expect(controller.restoreTrash(`${TRASH}missing.ttl`)).rejects.toThrow();
  });
  it("never restores outside the book or from a trash document it cannot conditionally delete", async () => {
    const { controller, pod, trashFiles } = await harness();
    const token = await controller.delete(`${ALICE}#this`);
    const url = token.trash as string;
    const body = pod.files.get(url)?.body as string;
    pod.seed(url, body, null);
    await expect(controller.restoreTrash(url)).rejects.toThrow("strong ETag");
    pod.seed(url, body.replaceAll(ALICE, `${ROOT}elsewhere/alice.ttl`));
    await expect(controller.restoreTrash(url)).rejects.toThrow("Invalid contact reference");
    pod.seed(url, body.replaceAll(ALICE, `${TRASH}alice.ttl`));
    await expect(controller.restoreTrash(url)).rejects.toThrow("Invalid contact reference");
    expect(trashFiles()).toEqual([url]);
    expect(pod.files.has(ALICE)).toBe(false);
  });
  it("keeps the restored contact and the trash copy when the trash document changed meanwhile", async () => {
    const { controller, pod, errors, storage } = await harness();
    const token = await controller.delete(`${ALICE}#this`);
    const url = token.trash as string;
    pod.fail = (target, method) => {
      if (target !== url || method !== "DELETE") return undefined;
      pod.seed(url, pod.files.get(url)?.body as string, '"edited"');
      return new Response(null, { status: 412 });
    };
    await expect(controller.restoreTrash(url)).rejects.toThrow();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"));
    expect(storage.length).toBe(0);
    expect(pod.files.has(ALICE)).toBe(true);
    expect(pod.files.has(url)).toBe(true);
  });
  it("deletes for ever and empties the trash, treating already-deleted items as done", async () => {
    const { controller, pod, trashFiles } = await harness();
    const one = await seedTrash(pod, "one.ttl", 1);
    const two = await seedTrash(pod, "two.ttl", 2);
    const three = await seedTrash(pod, "three.ttl", 3);
    await controller.refresh();
    const purge = controller.purge([two]);
    expect(controller.getSnapshot().data.trash.map((item) => item.url)).toEqual([one, three]);
    await purge;
    expect(trashFiles().sort()).toEqual([one, three]);
    pod.files.delete(one);
    await controller.emptyTrash();
    expect(trashFiles()).toEqual([]);
    expect(controller.getSnapshot().data.trash).toEqual([]);
    await controller.purge([`${TRASH}never-listed.ttl`]);
  });
  it("reports a delete-for-ever conflict and reloads the trash", async () => {
    const { controller, pod, errors } = await harness();
    const one = await seedTrash(pod, "one.ttl", 1);
    await controller.refresh();
    pod.fail = (url, method) =>
      url === one && method === "DELETE" ? new Response(null, { status: 412 }) : undefined;
    await expect(controller.purge([one])).rejects.toMatchObject({ status: 412 });
    expect(errors).toHaveBeenCalled();
    expect(controller.getSnapshot().data.trash.map((item) => item.url)).toEqual([one]);
  });
  it("resumes an interrupted move after reload without a second copy", async () => {
    const { controller, pod, fresh, storage, trashFiles, deleted } = await harness();
    pod.fail = (url, method) =>
      url === ALICE && method === "DELETE" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.delete(`${ALICE}#this`)).rejects.toThrow();
    // The person survived, so the rollback discarded the copy and relinked the labels.
    expect(trashFiles()).toEqual([]);
    expect(storage.length).toBe(0);
    expect(controller.getSnapshot().data.people.map((p) => p.url)).toEqual([ALICE]);
    expect(controller.getSnapshot().data.groups[0]?.data.members).toContain(`${ALICE}#this`);

    // A tab that stopped right after copying resumes the move on the next load.
    const journal = new IntentJournal(
      WEBID,
      BOOK,
      () => {},
      () => storage,
    );
    const person = await controller.model.loadContact(ALICE);
    const url = `${TRASH}resumed.ttl`;
    const intent = newIntent("delete", BOOK, ALICE, {
      person: await saveDocument(person),
      labels: [FRIENDS],
      trash: await saveDocument({
        url,
        etag: null,
        dataset: trashDocument(url, person, {
          deletedAt: new Date(),
          labels: [`${FRIENDS}#this`],
        }),
      }),
    });
    intent.completed.push("trash");
    pod.fail = undefined;
    await ensureCreated(controller.model, intent.trash as NonNullable<Intent["trash"]>);
    journal.put(intent);
    const reopened = fresh();
    await reopened.refresh();
    expect(reopened.getSnapshot().data.people).toEqual([]);
    expect(reopened.getSnapshot().data.trash.map((item) => item.url)).toEqual([url]);
    expect(trashFiles()).toEqual([url]);
    expect(deleted).toHaveBeenLastCalledWith(expect.objectContaining({ trash: url }));
  });
  it("discards no copy when a reconciled move never reached the trash step", async () => {
    const { controller, pod, storage, trashFiles } = await harness();
    const person = await controller.model.loadContact(ALICE);
    const url = `${TRASH}unstarted.ttl`;
    const saved = await saveDocument({
      url,
      etag: null,
      dataset: trashDocument(url, person, { deletedAt: new Date(), labels: [] }),
    });
    // Someone else's identical document at that URL must survive a rollback we didn't cause.
    await ensureCreated(controller.model, saved);
    const intent = newIntent("delete", BOOK, ALICE, {
      person: await saveDocument(person),
      labels: [FRIENDS],
      trash: saved,
    });
    intent.phase = "reconcile";
    const journal = new IntentJournal(
      WEBID,
      BOOK,
      () => {},
      () => storage,
    );
    journal.put(intent);
    const deleted = vi.fn();
    await new IntentRunner(controller.model, WEBID, deleted).run(journal, intent);
    expect(trashFiles()).toEqual([url]);
    expect(pod.files.has(ALICE)).toBe(true);
    expect(deleted).not.toHaveBeenCalled();
  });
  it("resumes the identical journaled restore rather than starting another", async () => {
    const { controller, pod, storage, trashFiles } = await harness();
    const token = await controller.delete(`${ALICE}#this`);
    const url = token.trash as string;
    const trash = await controller.model.transport.read(url, (dataset) => dataset);
    const journal = new IntentJournal(
      WEBID,
      BOOK,
      () => {},
      () => storage,
    );
    const person = await saveDocument({
      url: ALICE,
      etag: null,
      dataset: trashedPerson(url, trash.dataset),
    });
    // An unrelated, older restore without a trash source is left for reconciliation.
    journal.put(newIntent("restore", BOOK, ALICE, { person }));
    const pending = newIntent("restore", BOOK, ALICE, {
      person,
      labels: [FRIENDS],
      source: await saveDocument(trash),
    });
    pending.completed.push("person");
    pod.seed(ALICE, person.turtle);
    journal.put(pending);
    const writes = pod.writes.length;
    await controller.restoreTrash(url);
    expect(trashFiles()).toEqual([]);
    expect(storage.length).toBe(0);
    // No second person write: the journaled person step was already confirmed.
    expect(pod.writes.slice(writes).filter((write) => write.url === ALICE)).toEqual([]);
    expect((await controller.model.loadGroup(FRIENDS)).data.members).toContain(`${ALICE}#this`);
  });
  it("finishes a journaled delete from before trash existed, with a legacy Undo", async () => {
    const { controller, storage, trashFiles } = await harness();
    const person = await controller.model.loadContact(ALICE);
    const journal = new IntentJournal(
      WEBID,
      BOOK,
      () => {},
      () => storage,
    );
    journal.put(
      newIntent("delete", BOOK, ALICE, { person: await saveDocument(person), labels: [FRIENDS] }),
    );
    const token = await controller.delete(`${ALICE}#this`);
    expect(token.trash).toBeUndefined();
    expect(trashFiles()).toEqual([]);
    await controller.undo(token);
    const restored = await controller.model.loadContact(ALICE);
    expect(isomorphic([...restored.dataset], [...(await openDocument(token.person)).dataset])).toBe(
      true,
    );
  });
});
