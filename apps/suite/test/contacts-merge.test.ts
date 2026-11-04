// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  Contact,
  type ContactData,
  type ContactGroupData,
  type Snapshot,
} from "../src/apps/contacts/lib/model";
import { ensureReplaced, openDocument, saveDocument } from "../src/apps/contacts/lib/model/intent";
import { ContactsWriteError } from "../src/apps/contacts/lib/model/transport";
import {
  ContactsController,
  type ContactsData,
  PendingMergeError,
  writeMessage,
} from "../src/apps/contacts/state/controller";
import { IntentConflictError, newIntent } from "../src/apps/contacts/state/intents";
import { type Intent, journalPrefix } from "../src/apps/contacts/state/journal";
import {
  applyMerge,
  dedupeContact,
  defaultSelection,
  dismissedKey,
  dismissGroup,
  findDuplicates,
  mergeChoices,
  mergeContactData,
  mergedDocument,
  mergeFailureMessage,
  mergeLosses,
  pairKey,
  readDismissed,
} from "../src/apps/contacts/state/merge";
import {
  ALICE,
  BOOK,
  FRIENDS,
  GROUPS,
  INDEX,
  MemoryIntentStorage,
  PEOPLE,
  ROOT,
  setup,
  VCARD_PREFIX,
} from "./contacts-support";

const WEBID = `${ROOT}profile/card#me`;
const COPY = `${ROOT}contacts/people/alice-copy.ttl`;
const CAROL = `${ROOT}contacts/people/carol.ttl`;
const WORK = `${ROOT}contacts/groups/work.ttl`;
const EMPTY = `${ROOT}contacts/groups/empty.ttl`;

function person(
  name: string,
  data: Partial<ContactData> = {},
  url = `${ROOT}contacts/people/${name.toLowerCase().replace(/\W+/g, "-")}.ttl`,
): Snapshot<ContactData> {
  return { url, etag: '"1"', dataset: new Store(), data: { name, ...data } };
}
function group(name: string, members?: string[]): Snapshot<ContactGroupData> {
  return {
    url: `${ROOT}contacts/groups/${name}.ttl`,
    etag: '"1"',
    dataset: new Store(),
    data: { name, ...(members ? { members } : {}) },
  };
}
const id = (snapshot: Snapshot<unknown>) => `${snapshot.url}#this`;
const conflict = { outcome: "conflict", cause: expect.any(IntentConflictError) };

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("duplicate detection", () => {
  const ada = person("Ada", {
    emails: ["mailto:Ada@Example.org", "mailto:not an email"],
    phones: ["tel:+1 202 555 0100", "tel:+1 202 555 0100;ext=1"],
    webId: "https://ada.example/card#me",
  });
  const adaCopy = person("Ada L.", { emails: ["mailto:ada@example.org"] });
  const adaPhone = person("A. Lovelace", { phones: ["tel:+12025550100"] });
  const adaWeb = person("Countess", { webId: "https://ada.example/card#me" });
  const loner = person("Loner", { emails: ["mailto:loner@example.org"], note: "  " });

  it("projects only supported identities and nonblank fields", () => {
    expect(dedupeContact(ada)).toEqual({
      id: id(ada),
      fields: { name: "Ada" },
      emails: ["Ada@Example.org"],
      phones: ["+1 202 555 0100"],
      webIds: ["https://ada.example/card#me"],
    });
    expect(dedupeContact(loner).fields).toEqual({ name: "Loner" });
    expect(dedupeContact(person("Bad", { webId: "https://exa mple/" })).webIds).toEqual([]);
    expect(dedupeContact(person("Odd", { organization: "\ud800" })).fields).toEqual({
      name: "Odd",
    });
  });

  it("groups contacts sharing an email, phone or WebID, with every matching reason", () => {
    const groups = findDuplicates([loner, adaWeb, adaPhone, adaCopy, ada]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.contactIds).toEqual([adaPhone, adaCopy, ada, adaWeb].map(id).sort());
    expect(groups[0]?.reasons).toEqual([
      { kind: "email", value: "ada@example.org" },
      { kind: "phone", value: "+12025550100" },
      { kind: "webId", value: "https://ada.example/card#me" },
    ]);
    expect(findDuplicates([loner])).toEqual([]);
  });

  it("splits a cluster at dismissed pairs and hides fully dismissed groups", () => {
    const all = [ada, adaCopy, adaPhone];
    expect(findDuplicates(all, new Set([pairKey(id(ada), id(adaCopy))]))).toEqual([
      {
        id: [id(adaPhone), id(ada)].sort().join(" "),
        contactIds: [id(adaPhone), id(ada)].sort(),
        reasons: [{ kind: "phone", value: "+12025550100" }],
      },
    ]);
    const dismissed = new Set([
      pairKey(id(ada), id(adaCopy)),
      pairKey(id(adaPhone), id(ada)),
      pairKey(id(adaCopy), id(adaPhone)),
    ]);
    expect(findDuplicates(all, dismissed)).toEqual([]);
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });

  it("orders groups by their first contact's name, then by ID", () => {
    const bea = person(
      "Bea",
      { emails: ["mailto:bea@example.org"] },
      `${ROOT}contacts/people/1.ttl`,
    );
    const bea2 = person(
      "Bea",
      { emails: ["mailto:bea@example.org"] },
      `${ROOT}contacts/people/2.ttl`,
    );
    const twin = person(
      "bea",
      { emails: ["mailto:twin@example.org"] },
      `${ROOT}contacts/people/0.ttl`,
    );
    const twin2 = person(
      "Twin",
      { emails: ["mailto:twin@example.org"] },
      `${ROOT}contacts/people/9.ttl`,
    );
    const ann = person("Ann", { phones: ["tel:+12025550199"] }, `${ROOT}contacts/people/8.ttl`);
    const ann2 = person("Zed", { phones: ["tel:+12025550199"] }, `${ROOT}contacts/people/7.ttl`);
    const groups = findDuplicates([bea, bea2, twin, twin2, ann, ann2]);
    expect(groups.map((entry) => entry.contactIds[0])).toEqual([id(twin), id(bea), id(ann2)]);
  });

  it("remembers dismissed groups per WebID, tolerating unreadable preferences", () => {
    const storage = new MemoryStorage();
    expect(readDismissed(storage, WEBID)).toEqual(new Set());
    const first = dismissGroup(storage, WEBID, new Set(), ["a", "b", "c"]);
    expect(first).toEqual(new Set([pairKey("a", "b"), pairKey("a", "c"), pairKey("b", "c")]));
    expect(readDismissed(storage, WEBID)).toEqual(first);
    expect(readDismissed(storage, `${WEBID}-other`)).toEqual(new Set());
    storage.setItem(dismissedKey(WEBID), JSON.stringify(["x", 1, null]));
    expect(readDismissed(storage, WEBID)).toEqual(new Set(["x"]));
    storage.setItem(dismissedKey(WEBID), JSON.stringify({ a: 1 }));
    expect(readDismissed(storage, WEBID)).toEqual(new Set());
    storage.setItem(dismissedKey(WEBID), "{");
    expect(readDismissed(storage, WEBID)).toEqual(new Set());
  });
});

describe("merge review choices", () => {
  const a = person(
    "Ada",
    { organization: "Engines", webId: "https://a.example/#me" },
    `${ROOT}a.ttl`,
  );
  const b = person(
    "Ada Lovelace",
    { organization: "Engines", note: "Poet", webId: "https://b.example/#me" },
    `${ROOT}b.ttl`,
  );
  const c = person("Ada", { note: "Analyst" }, `${ROOT}c.ttl`);

  it("offers every distinct value with provenance, using the dedupe merge plan", () => {
    const choices = mergeChoices([c, b, a]);
    expect(choices.name).toEqual([
      { value: "Ada", sourceIds: [id(a), id(c)] },
      { value: "Ada Lovelace", sourceIds: [id(b)] },
    ]);
    expect(choices.organization).toEqual([{ value: "Engines", sourceIds: [id(a), id(b)] }]);
    expect(choices.note.map((option) => option.value)).toEqual(["Poet", "Analyst"]);
    expect(choices.webId.map((option) => option.value)).toEqual([
      "https://a.example/#me",
      "https://b.example/#me",
    ]);
    expect(mergeChoices([])).toEqual({ name: [], organization: [], note: [], webId: [] });
  });

  it("defaults to the primary's own values and otherwise keeps the first offered value", () => {
    const choices = mergeChoices([a, b, c]);
    expect(defaultSelection(choices, id(c))).toEqual({
      name: "Ada",
      organization: "Engines",
      note: "Analyst",
      webId: "https://a.example/#me",
    });
    expect(defaultSelection(choices, id(b))).toMatchObject({
      name: "Ada Lovelace",
      note: "Poet",
      webId: "https://b.example/#me",
    });
    expect(defaultSelection(mergeChoices([c]), id(c))).toEqual({ name: "Ada", note: "Analyst" });
  });

  it("unions contact points by normalised value, keeping the primary's spelling first", () => {
    const merged = mergeContactData(
      {
        name: "Ada",
        emails: ["mailto:Ada@Example.org", "mailto:odd value"],
        note: "Keep",
        created: new Date(0),
      },
      [
        {
          name: "Ada L.",
          emails: ["mailto:ada@example.org", "mailto:odd value", "mailto:work@example.org"],
          phones: ["tel:+1 (202) 555-0100", "tel:+12025550100", "tel:12;x"],
          organization: "Engines",
        },
        { name: "A" },
      ],
      { name: "Ada L.", organization: "Engines" },
    );
    expect(merged).toEqual({
      name: "Ada L.",
      emails: ["mailto:Ada@Example.org", "mailto:odd value", "mailto:work@example.org"],
      phones: ["tel:+1 (202) 555-0100", "tel:12;x"],
      organization: "Engines",
      note: "Keep",
      created: new Date(0),
    });
    // Omitted selections keep the primary's own value; nothing is invented.
    expect(mergeContactData({ name: "Solo", webId: "https://s.example/#me" }, [], {})).toEqual({
      name: "Solo",
      webId: "https://s.example/#me",
    });
  });

  it("applies the merge optimistically across people and label memberships", () => {
    const keep = person("Keep");
    const drop = person("Drop", { emails: ["mailto:drop@example.org"] });
    const other = person("Other");
    const data: ContactsData = {
      book: null,
      people: [keep, drop, other],
      groups: [
        group("friends", [id(drop), id(other)]),
        group("both", [id(keep), id(drop)]),
        group("work", [id(keep)]),
        group("empty"),
      ],
      trash: [],
      trashIncomplete: false,
      flat: [],
      incomplete: false,
      registrationPending: false,
    };
    const next = applyMerge(data, id(keep), [id(drop)], { name: "Kept" });
    expect(next.people.map((p) => p.data)).toEqual([
      { name: "Kept", emails: ["mailto:drop@example.org"] },
      { name: "Other" },
    ]);
    expect(next.groups.map((g) => g.data.members)).toEqual([
      [id(other), id(keep)],
      [id(keep)],
      [id(keep)],
      [],
    ]);
  });
});

async function harness() {
  const { pod } = await setup();
  pod.seed(
    PEOPLE,
    `${VCARD_PREFIX} <${ALICE}#this> vcard:fn "Alice"; vcard:inAddressBook <${BOOK}#this>.
     <${COPY}#this> vcard:fn "Alice Smith"; vcard:inAddressBook <${BOOK}#this>.
     <${CAROL}#this> vcard:fn "Carol"; vcard:inAddressBook <${BOOK}#this>.`,
  );
  pod.seed(
    COPY,
    `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Alice Smith";
      vcard:inAddressBook <../book.ttl#this>; vcard:hasUID "urn:uuid:copy";
      vcard:hasEmail [ vcard:value <mailto:ALICE@example.org> ], [ vcard:value <mailto:alice.work@example.org> ];
      vcard:hasTelephone [ vcard:value <tel:+447700900123> ];
      vcard:note "Second copy" .`,
  );
  pod.seed(
    CAROL,
    `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Carol";
      vcard:inAddressBook <../book.ttl#this>;
      vcard:hasTelephone [ vcard:value <tel:+447700900123> ] .`,
  );
  pod.seed(
    GROUPS,
    `${VCARD_PREFIX} <book.ttl#this> vcard:includesGroup <groups/friends.ttl#this>, <groups/work.ttl#this>, <groups/empty.ttl#this> .
     <groups/friends.ttl#this> a vcard:Group; vcard:fn "Friends" .
     <groups/work.ttl#this> a vcard:Group; vcard:fn "Work" .
     <groups/empty.ttl#this> a vcard:Group; vcard:fn "Empty" .`,
  );
  pod.seed(
    WORK,
    `${VCARD_PREFIX} <#this> a vcard:Group; vcard:fn "Work"; vcard:inAddressBook <../book.ttl#this>;
      vcard:hasMember <../people/alice-copy.ttl#this>, <../people/carol.ttl#this> .`,
  );
  pod.seed(
    EMPTY,
    `${VCARD_PREFIX} <#this> a vcard:Group; vcard:fn "Empty"; vcard:inAddressBook <../book.ttl#this> .`,
  );
  pod.seed(`${ROOT}profile/card`, "<#me> <https://example.org/p> <https://example.org/o> .");
  pod.seed(
    INDEX,
    `@prefix solid: <http://www.w3.org/ns/solid/terms#>. @prefix vcard: <http://www.w3.org/2006/vcard/ns#>. <#book> a solid:TypeRegistration; solid:forClass vcard:AddressBook; solid:instance <${BOOK}#this>.`,
  );
  const storage = new MemoryIntentStorage();
  const errors = vi.fn();
  // One WebID per harness: the journal's in-memory fallback is module-wide.
  const webId = `${WEBID}-${crypto.randomUUID()}`;
  const make = () => new ContactsController(pod.fetch, ROOT, webId, errors, () => storage);
  const controller = make();
  await controller.refresh();
  expect(controller.getSnapshot().status, String(controller.getSnapshot().error)).toBe("ready");
  const intents = () => [...storage.values.values()].map((value) => JSON.parse(value) as Intent);
  return { pod, storage, errors, controller, make, intents, webId };
}
const members = async (controller: ContactsController, url: string) =>
  (await controller.model.loadGroup(url)).data.members ?? [];
const indexed = async (controller: ContactsController) =>
  (await controller.model.loadPeople(await controller.model.loadAddressBook())).data.map(
    (entry) => entry.id,
  );

describe("journaled contact merge", () => {
  it("writes the merged primary, unions labels and contact points, then deletes the copy", async () => {
    const { controller, pod, storage, errors } = await harness();
    expect(findDuplicates(controller.getSnapshot().data.people).map((g) => g.contactIds)).toEqual([
      [`${COPY}#this`, `${ALICE}#this`, `${CAROL}#this`].sort(),
    ]);
    const order: string[] = [];
    pod.fail = (url, method) => {
      if (method !== "GET") order.push(`${method} ${url.replace(ROOT, "")}`);
      return undefined;
    };
    const pending = controller.merge(`${ALICE}#this`, [`${COPY}#this`, `${ALICE}#this`], {
      name: "Alice Smith",
      note: "Second copy",
    });
    // Optimistic: the copy disappears and the primary shows the merged values immediately.
    const optimistic = controller.getSnapshot();
    expect(optimistic.saving).toBe(true);
    expect(optimistic.data.people.map((p) => p.url)).toEqual([ALICE, CAROL]);
    expect(optimistic.data.people[0]?.data).toMatchObject({
      name: "Alice Smith",
      note: "Second copy",
    });
    await pending;
    expect(order).toEqual([
      "PUT contacts/people/alice.ttl",
      "PUT contacts/people.ttl",
      "PUT contacts/groups/work.ttl",
      "PUT contacts/groups/work.ttl",
      "PUT contacts/people.ttl",
      "DELETE contacts/people/alice-copy.ttl",
    ]);
    expect(storage.length).toBe(0);
    expect(errors).not.toHaveBeenCalled();
    expect(pod.files.has(COPY)).toBe(false);
    const merged = await controller.model.loadContact(ALICE);
    expect(merged.data).toMatchObject({
      name: "Alice Smith",
      note: "Second copy",
      organization: "Example Ltd",
      webId: "https://alice.example/profile#me",
    });
    expect(merged.data.emails?.sort()).toEqual([
      "mailto:alice.work@example.org",
      "mailto:alice@example.org",
    ]);
    expect(merged.data.phones?.sort()).toEqual(["tel:+441234567", "tel:+447700900123"]);
    // Unknown RDF and the UID survive: the merge edits the primary's own document.
    expect(pod.files.get(ALICE)?.body).toContain("Preserve me");
    expect(pod.files.get(ALICE)?.body).toContain("urn:uuid:alice");
    expect(await members(controller, FRIENDS)).toEqual([`${ALICE}#this`]);
    expect((await members(controller, WORK)).sort()).toEqual([`${ALICE}#this`, `${CAROL}#this`]);
    expect(await indexed(controller)).toEqual([`${ALICE}#this`, `${CAROL}#this`]);
    const state = controller.getSnapshot();
    expect(state.saving).toBe(false);
    expect(state.data.people.map((p) => p.url)).toEqual([ALICE, CAROL]);
    expect(state.data.people[0]?.data.name).toBe("Alice Smith");
  });

  it("does not add a label the primary already has and merges several copies", async () => {
    const { controller, pod } = await harness();
    pod.seed(
      FRIENDS,
      `${VCARD_PREFIX} <#this> a vcard:Group; vcard:fn "Friends"; vcard:inAddressBook <../book.ttl#this>;
        vcard:hasMember <../people/alice.ttl#this>, <../people/carol.ttl#this> .`,
    );
    await controller.refresh();
    await controller.merge(`${CAROL}#this`, [`${ALICE}#this`, `${COPY}#this`], {});
    expect(pod.files.has(ALICE)).toBe(false);
    expect(pod.files.has(COPY)).toBe(false);
    expect(await members(controller, FRIENDS)).toEqual([`${CAROL}#this`]);
    expect(await members(controller, WORK)).toEqual([`${CAROL}#this`]);
    const carol = await controller.model.loadContact(CAROL);
    expect(carol.data.name).toBe("Carol");
    expect(carol.data.organization).toBe("Example Ltd");
    expect(carol.data.emails).toHaveLength(2);
    expect(await indexed(controller)).toEqual([`${CAROL}#this`]);
  });

  it("starts a new merge alongside unrelated finished journal records", async () => {
    const { controller, pod, storage, webId } = await harness();
    for (const [kind, destination] of [
      ["create", `${ROOT}contacts/people/other.ttl`],
      ["merge", CAROL],
    ] as const) {
      const intent = newIntent(kind, BOOK, destination);
      intent.completed = ["done"];
      intent.startedAt = "2000-01-01T00:00:00.000Z";
      storage.setItem(journalPrefix(webId, BOOK) + intent.id, JSON.stringify(intent));
    }
    await controller.merge(`${ALICE}#this`, [`${COPY}#this`], {});
    expect(pod.files.has(COPY)).toBe(false);
    expect(storage.length).toBe(0);
  });

  it("rejects merges without another existing contact before writing anything", async () => {
    const { controller, pod, storage } = await harness();
    const writes = pod.writes.length;
    const unchanged = (message: string) => ({
      outcome: "unchanged",
      cause: expect.objectContaining({ message: expect.stringContaining(message) }),
    });
    await expect(controller.merge(`${ALICE}#this`, [`${ALICE}#this`], {})).rejects.toMatchObject(
      unchanged("Choose at least two contacts to merge."),
    );
    await expect(
      controller.merge(`${ALICE}#this`, [`${ROOT}contacts/people/gone.ttl#this`], {}),
    ).rejects.toMatchObject(unchanged("Contact no longer exists."));
    pod.seed(COPY, String(pod.files.get(COPY)?.body), null);
    await expect(controller.merge(`${ALICE}#this`, [`${COPY}#this`], {})).rejects.toMatchObject(
      unchanged("strong ETag"),
    );
    expect(pod.writes).toHaveLength(writes);
    expect(storage.length).toBe(0);
    expect(controller.getSnapshot().data.people).toHaveLength(3);
  });

  it("stops at a concurrently edited primary, keeping every contact unchanged", async () => {
    const { controller, pod, storage, errors } = await harness();
    const before = pod.files.get(COPY)?.body;
    pod.fail = (url, method) => {
      if (url === ALICE && method === "PUT")
        pod.seed(ALICE, String(pod.files.get(ALICE)?.body), '"edited"');
      return undefined;
    };
    await expect(controller.merge(`${ALICE}#this`, [`${COPY}#this`], {})).rejects.toMatchObject(
      conflict,
    );
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("Contacts changed elsewhere"));
    expect(storage.length).toBe(0);
    expect(pod.files.get(COPY)?.body).toBe(before);
    expect((await controller.model.loadContact(ALICE)).data.name).toBe("Alice");
    expect(controller.getSnapshot().data.people).toHaveLength(3);
  });

  it("relinks a duplicate edited before its deletion, keeping the merged primary", async () => {
    const { controller, pod, storage } = await harness();
    pod.fail = (url, method) => {
      if (url === COPY && method === "DELETE")
        pod.seed(COPY, String(pod.files.get(COPY)?.body), '"edited"');
      return undefined;
    };
    await expect(controller.merge(`${ALICE}#this`, [`${COPY}#this`], {})).rejects.toMatchObject(
      conflict,
    );
    expect(storage.length).toBe(0);
    expect(pod.files.has(COPY)).toBe(true);
    expect((await indexed(controller)).sort()).toEqual(
      [`${ALICE}#this`, `${COPY}#this`, `${CAROL}#this`].sort(),
    );
    expect((await members(controller, WORK)).sort()).toEqual(
      [`${ALICE}#this`, `${COPY}#this`, `${CAROL}#this`].sort(),
    );
    expect((await controller.model.loadContact(ALICE)).data.emails).toHaveLength(2);
    expect(controller.getSnapshot().data.people).toHaveLength(3);
  });

  it("relinks only surviving duplicates and tolerates a failing repair", async () => {
    const { controller, pod, storage } = await harness();
    let repairReads = 0;
    pod.fail = (url, method) => {
      if (url === CAROL && method === "DELETE")
        pod.seed(CAROL, String(pod.files.get(CAROL)?.body), '"edited"');
      return undefined;
    };
    await expect(
      controller.merge(`${ALICE}#this`, [`${COPY}#this`, `${CAROL}#this`], {}),
    ).rejects.toMatchObject(conflict);
    expect(pod.files.has(COPY)).toBe(false);
    expect(pod.files.has(CAROL)).toBe(true);
    expect((await indexed(controller)).sort()).toEqual([`${ALICE}#this`, `${CAROL}#this`].sort());
    expect((await members(controller, WORK)).sort()).toEqual([`${ALICE}#this`, `${CAROL}#this`]);
    expect(storage.length).toBe(0);
    // A second conflict whose repair read fails still releases the intent and reloads.
    const again = await harness();
    again.pod.fail = (url, method) => {
      if (url === COPY && method === "DELETE") {
        again.pod.seed(COPY, String(again.pod.files.get(COPY)?.body), '"edited"');
        repairReads = 1;
      } else if (url === COPY && method === "GET" && repairReads === 1) {
        repairReads = 2;
        return new Response(null, { status: 500 });
      }
      return undefined;
    };
    await expect(
      again.controller.merge(`${ALICE}#this`, [`${COPY}#this`], {}),
    ).rejects.toMatchObject(conflict);
    expect(repairReads).toBe(2);
    expect(again.storage.length).toBe(0);
    expect(again.pod.files.has(COPY)).toBe(true);
  });

  it.each([
    "503",
    "lost-response",
  ])("resumes an interrupted merge (%s) after a reload without repeating writes", async (failure) => {
    const { controller, pod, storage, make, intents } = await harness();
    let journaled: Intent | undefined;
    pod.fail = (url, method) => {
      if (url === ALICE && method === "PUT") journaled = structuredClone(intents()[0]);
      if (failure === "lost-response" && url === ALICE && method === "PUT") {
        pod.seed(ALICE, String(pod.requests.at(-1)?.body), '"landed"');
        throw new Error("connection lost after PUT");
      }
      if (failure === "503" && url === COPY && method === "DELETE")
        return new Response(null, { status: 503 });
      return undefined;
    };
    await expect(
      controller.merge(`${ALICE}#this`, [`${COPY}#this`], { name: "Alice Smith" }),
    ).rejects.toMatchObject({ outcome: failure === "503" ? "pending" : "unknown" });
    expect(journaled).toMatchObject({
      kind: "merge",
      destination: ALICE,
      labels: [WORK],
      completed: [],
      attempting: "person",
      duplicates: [{ person: { url: COPY }, labels: [WORK] }],
    });
    if (failure === "503") {
      expect(storage.length).toBe(1);
      expect(intents()[0]?.attempting).toBe(`delete:${COPY}`);
      expect(controller.getSnapshot().status).toBe("error");
    }
    pod.fail = undefined;
    const reopened = make();
    await reopened.refresh();
    expect(reopened.getSnapshot().status, String(reopened.getSnapshot().error)).toBe("ready");
    expect(storage.length).toBe(0);
    expect(pod.files.has(COPY)).toBe(false);
    expect(
      reopened
        .getSnapshot()
        .data.people.map((p) => p.data.name)
        .sort(),
    ).toEqual(["Alice Smith", "Carol"]);
    expect(pod.writes.filter((write) => write.url === ALICE)).toHaveLength(1);
    expect((await members(reopened, WORK)).sort()).toEqual([`${ALICE}#this`, `${CAROL}#this`]);
  });
});

describe("ensureReplaced", () => {
  it("adopts an identical document, writes from the reviewed revision, and refuses a missing one", async () => {
    const { pod, model } = await setup();
    const original = await model.loadContact(ALICE);
    const updated = mergedDocument(original, { ...original.data, note: "Merged" });
    const saved = await saveDocument({ url: ALICE, etag: original.etag, dataset: updated });
    await ensureReplaced(model, saved);
    expect(pod.writes).toHaveLength(1);
    expect(pod.writes[0]?.headers.get("If-Match")).toBe(original.etag);
    await ensureReplaced(model, saved);
    expect(pod.writes).toHaveLength(1);
    const stale = await saveDocument({
      url: ALICE,
      etag: original.etag,
      dataset: mergedDocument(original, { ...original.data, note: "Other" }),
    });
    await expect(ensureReplaced(model, stale)).rejects.toMatchObject({ status: 412 });
    pod.files.delete(ALICE);
    const error = await ensureReplaced(model, saved).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContactsWriteError);
    expect(error).toMatchObject({ status: 412, url: ALICE });
  });
});

describe("review follow-ups", () => {
  it("keeps a group linked only through a middle contact until its links are dismissed", () => {
    const a = person("A", { emails: ["mailto:shared@example.org"] }, `${ROOT}a.ttl`);
    const b = person(
      "B",
      { emails: ["mailto:shared@example.org"], phones: ["tel:+12025550111"] },
      `${ROOT}b.ttl`,
    );
    const c = person("C", { phones: ["tel:+12025550111"] }, `${ROOT}c.ttl`);
    expect(findDuplicates([a, b, c]).map((g) => g.contactIds)).toEqual([[id(a), id(b), id(c)]]);
    // A and C never matched directly: dismissing A–B leaves B–C, and dismissing B–C leaves A–B.
    expect(findDuplicates([a, b, c], new Set([pairKey(id(a), id(b))]))).toEqual([
      {
        id: `${id(b)} ${id(c)}`,
        contactIds: [id(b), id(c)],
        reasons: [{ kind: "phone", value: "+12025550111" }],
      },
    ]);
    expect(
      findDuplicates([a, b, c], new Set([pairKey(id(b), id(c))])).map((g) => g.contactIds),
    ).toEqual([[id(a), id(b)]]);
    // Dismissing the whole group records the indirect pair too, so nothing comes back.
    const storage = new MemoryStorage();
    const dismissed = dismissGroup(storage, WEBID, new Set(), [id(a), id(b), id(c)]);
    expect(dismissed.has(pairKey(id(a), id(c)))).toBe(true);
    expect(findDuplicates([a, b, c], dismissed)).toEqual([]);
  });

  it("lists every detail deleting a duplicate would discard, like the migration check", async () => {
    const primary = await openDocument({
      url: `${ROOT}contacts/people/pat.ttl`,
      etag: '"1"',
      turtle: `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Pat";
        vcard:hasEmail [ a vcard:Home; vcard:value <mailto:pat@example.org> ] .`,
    });
    const copy = await openDocument({
      url: `${ROOT}contacts/people/pat-copy.ttl`,
      etag: '"1"',
      turtle: `${VCARD_PREFIX} <#this> a vcard:Individual, <https://example.org/Extra>;
        vcard:fn "Pat D"; vcard:hasUID "urn:uuid:d"; vcard:inAddressBook <../book.ttl#this>;
        <http://purl.org/dc/terms/created> "2020-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>;
        vcard:note "Chosen away"; vcard:organization-name "Org";
        vcard:hasEmail [ a vcard:Work; vcard:value <mailto:PAT@example.org> ],
          [ a vcard:Home; vcard:value <mailto:pd@example.org> ],
          [ vcard:value <mailto:pat@example.org>; <https://example.org/pref> "1" ],
          [ a vcard:Work ];
        vcard:hasTelephone <tel:+12025550100>;
        vcard:url [ a vcard:WebId; vcard:value <https://d.example/#me> ], <https://d.example/home>;
        vcard:hasAddress _:addr; vcard:bday "2000-01-01"; <https://example.org/custom/> "x";
        <https://example.org/x> _:addr .
        _:addr vcard:locality "Town"; vcard:street-address [ vcard:x "y" ] .
        <#other> vcard:fn "Someone" .`,
    });
    const merged = mergeContactData(primary.data, [copy.data], { note: "Chosen away" });
    const document = mergedDocument(primary, merged);
    expect(mergeLosses(document, id(primary), copy)).toEqual([
      "Work label on email PAT@example.org",
      "birthday",
      "email",
      "https://example.org/custom/",
      "other data in the contact's document",
      "pref on email pat@example.org",
      "street-address on address",
      "type Extra",
      "website https://d.example/home",
      "x",
    ]);
    // A plain copy whose contact points all carry over loses nothing.
    const plain = await openDocument({
      url: `${ROOT}contacts/people/pat-plain.ttl`,
      etag: '"1"',
      turtle: `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Pat P"; vcard:hasUID "urn:uuid:p";
        vcard:hasEmail [ a vcard:Home; vcard:value <mailto:pp@example.org> ];
        vcard:hasTelephone [ a vcard:Cell; vcard:value <tel:+12025550100> ] .`,
    });
    const both = mergedDocument(primary, mergeContactData(primary.data, [plain.data], {}));
    expect(mergeLosses(both, id(primary), plain)).toEqual([]);
  });

  // AUTHORED-BY Claude Opus 5.5
  it("unions addresses and reports only what an address merge cannot carry", async () => {
    const primary = await openDocument({
      url: `${ROOT}contacts/people/ann.ttl`,
      etag: '"1"',
      turtle: `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Ann";
        vcard:hasAddress [ a vcard:Home; vcard:locality "Paris" ] .`,
    });
    const copy = await openDocument({
      url: `${ROOT}contacts/people/ann-copy.ttl`,
      etag: '"1"',
      turtle: `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Ann";
        vcard:hasAddress [ a vcard:Home; vcard:locality " Paris " ],
          [ a vcard:Work, vcard:Postal; vcard:locality "Lyon"; <https://example.org/geo> "45,4" ] .`,
    });
    const merged = mergeContactData(primary.data, [copy.data], {});
    expect(merged.addresses).toEqual([
      { kind: "home", locality: "Paris" },
      { kind: "work", locality: "Lyon" },
    ]);
    expect(mergeLosses(mergedDocument(primary, merged), id(primary), copy)).toEqual([
      "Postal label on address",
      "geo on address",
    ]);
    // A literal "address" and addresses past the per-contact limit stay with the copy.
    const many = await openDocument({
      url: `${ROOT}contacts/people/ann-many.ttl`,
      etag: '"1"',
      turtle: `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Ann";
        vcard:hasAddress "1 Way", ${Array.from({ length: 16 }, (_, i) => `[ vcard:postal-code "${i}" ]`).join(", ")} .`,
    });
    const capped = mergeContactData(primary.data, [many.data], {});
    expect(capped.addresses).toHaveLength(16);
    expect(mergeLosses(mergedDocument(primary, capped), id(primary), many)).toEqual(["address"]);
    expect(mergeContactData({ name: "No address" }, [], {})).not.toHaveProperty("addresses");
    // Extra values, a second kind, language tags and invalid addresses are named as losses.
    const odd = await openDocument({
      url: `${ROOT}contacts/people/ann-odd.ttl`,
      etag: '"1"',
      turtle: `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Ann";
        vcard:hasAddress [ a vcard:Home, vcard:Work; vcard:locality "Nice", "Nizza" ],
          [ vcard:region "Ile"@fr ], [ vcard:locality "${"x".repeat(300)}" ] .`,
    });
    const oddMerged = mergeContactData(primary.data, [odd.data], {});
    expect(oddMerged.addresses).toHaveLength(3);
    expect(mergeLosses(mergedDocument(primary, oddMerged), id(primary), odd)).toEqual([
      "Home label on address",
      "address",
      "locality on address",
      "region on address",
    ]);
    const crowded = mergeContactData(
      { name: "Crowded", addresses: Array.from({ length: 17 }, (_, i) => ({ region: `${i}` })) },
      [{ name: "Copy", addresses: [{ region: "new" }] }],
      {},
    );
    expect(crowded.addresses).toHaveLength(17);
    expect(crowded.addresses).not.toContainEqual({ region: "new" });
    // A primary's over-long address (written elsewhere) does not stop a copy's address merging.
    const longPrimary = await openDocument({
      url: `${ROOT}contacts/people/long.ttl`,
      etag: '"1"',
      turtle: `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Long";
        vcard:hasAddress [ vcard:locality "${"x".repeat(300)}" ] .`,
    });
    const withLyon = mergeContactData(
      longPrimary.data,
      [{ name: "Copy", addresses: [{ locality: "Lyon" }] }],
      {},
    );
    expect(
      new Contact(id(longPrimary), mergedDocument(longPrimary, withLyon), DataFactory).addresses,
    ).toHaveLength(2);
    // The primary's own repeated addresses are left as they are.
    const twice = [{ locality: "Same" }, { locality: "Same" }];
    expect(mergeContactData({ name: "P", addresses: twice }, [], {}).addresses).toEqual(twice);
  });

  it("only claims what each merge failure outcome guarantees", () => {
    expect(mergeFailureMessage("unchanged", "A and B")).toBe(
      "Could not merge A and B. No contacts were changed.",
    );
    expect(mergeFailureMessage("pending", "A and B")).toContain("will finish when Contacts loads");
    expect(mergeFailureMessage("conflict", "A and B")).toContain(
      "Contacts not yet merged were kept",
    );
    expect(mergeFailureMessage("unknown", "A and B")).toContain("Reload Contacts to check");
    expect(writeMessage(new PendingMergeError())).toContain("hadn't finished");
  });

  async function pendingIntent() {
    const first = await harness();
    let captured: string | undefined;
    first.pod.fail = (url, method) => {
      if (url === ALICE && method === "PUT") captured = [...first.storage.values.values()][0];
      if (url === ALICE && method === "PUT") return new Response(null, { status: 503 });
      return undefined;
    };
    await expect(
      first.controller.merge(`${ALICE}#this`, [`${COPY}#this`], { name: "Alice Smith" }),
    ).rejects.toMatchObject({ outcome: "pending" });
    const intent = JSON.parse(captured as string) as Intent;
    const next = await harness();
    next.storage.setItem(journalPrefix(next.webId, BOOK) + intent.id, JSON.stringify(intent));
    return next;
  }

  it("resumes an identical unfinished merge instead of planning it again", async () => {
    const { controller, pod, storage } = await pendingIntent();
    const start = pod.requests.length;
    await controller.merge(`${ALICE}#this`, [`${COPY}#this`], { name: "Alice Smith" });
    const requests = pod.requests.slice(start);
    const firstWrite = requests.findIndex((request) => request.method === "PUT");
    expect(requests.slice(0, firstWrite).map((request) => request.url)).toEqual([ALICE]);
    expect(storage.length).toBe(0);
    expect(pod.files.has(COPY)).toBe(false);
    expect((await controller.model.loadContact(ALICE)).data.name).toBe("Alice Smith");
  });

  it("refuses a different merge while one on the same contacts is unfinished, then finishes it", async () => {
    const { controller, pod, storage, errors } = await pendingIntent();
    const writes = pod.writes.length;
    await expect(
      controller.merge(`${COPY}#this`, [`${ALICE}#this`], { name: "Someone else" }),
    ).rejects.toMatchObject({ outcome: "unchanged", cause: expect.any(PendingMergeError) });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("hadn't finished"));
    // Reconciliation completed the earlier, reviewed merge rather than the new request.
    expect(pod.writes.length).toBeGreaterThan(writes);
    expect(storage.length).toBe(0);
    expect(pod.files.has(COPY)).toBe(false);
    expect((await controller.model.loadContact(ALICE)).data.name).toBe("Alice Smith");
    expect(controller.getSnapshot().data.people.map((p) => p.url)).toEqual([ALICE, CAROL]);
  });

  it("releases a merge whose duplicate changed while it waited to resume after a reload", async () => {
    const { controller, pod, storage, errors, make } = await harness();
    pod.fail = (url, method) =>
      url === COPY && method === "DELETE" ? new Response(null, { status: 503 }) : undefined;
    await expect(controller.merge(`${ALICE}#this`, [`${COPY}#this`], {})).rejects.toMatchObject({
      outcome: "pending",
    });
    expect(storage.length).toBe(1);
    pod.fail = undefined;
    // Another client edits the duplicate before this browser reloads.
    pod.seed(COPY, String(pod.files.get(COPY)?.body), '"elsewhere"');
    errors.mockClear();
    const reopened = make();
    await reopened.refresh();
    expect(reopened.getSnapshot().status, String(reopened.getSnapshot().error)).toBe("ready");
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("Contacts changed elsewhere"));
    expect(storage.length).toBe(0);
    expect(pod.files.has(COPY)).toBe(true);
    expect((await indexed(reopened)).sort()).toEqual(
      [`${ALICE}#this`, `${COPY}#this`, `${CAROL}#this`].sort(),
    );
    expect((await members(reopened, WORK)).sort()).toEqual(
      [`${ALICE}#this`, `${COPY}#this`, `${CAROL}#this`].sort(),
    );
    expect(reopened.getSnapshot().data.people).toHaveLength(3);
  });
});
