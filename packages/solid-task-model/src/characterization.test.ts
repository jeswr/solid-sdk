// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// CHARACTERIZATION / GOLDEN-MASTER suite — pins the package's OBSERVABLE
// behaviour BEFORE any refactor, so a structural change is proven not to alter
// behaviour. Two axes:
//
//   1. The PUBLIC API contract — the exact named-export set of every entry point
//      (`.`, `./task`, `./tracker`, `./contacts`, `./shape`). An export that is
//      added, removed or renamed here is a deliberate, reviewed CONTRACT change;
//      an accidental one fails this test. (Mirrors what api-extractor's
//      `etc/solid-task-model.api.md` snapshots, in-repo, with no extra dep.)
//
//   2. The EMITTED RDF — canonical sorted N-Quads for a representative build of
//      every serialisable entity, with the only non-deterministic fields
//      (`dct:created` / `prov:endedAtTime` timestamps and the minted
//      `urn:uuid:` for a person) normalised to stable placeholders. The exact
//      IRIs / predicates / classes the on-pod data + solid-issues + Pod Manager
//      bind to are thereby pinned byte-for-byte (canonical-quad-for-quad): a
//      refactor that silently changes one breaks this test.
//
// Snapshots are NEVER `--update`d to make a red test green mid-refactor — an
// unexpected diff here is stop-the-line.

import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import * as contactsEntry from "./contacts.js";
import * as mainEntry from "./index.js";
import * as shapeEntry from "./shape.js";
import * as taskEntry from "./task.js";
import * as trackerEntry from "./tracker.js";

// --- 1. Public-API contract ----------------------------------------------------

/** Sorted list of a module's own named exports (the public surface of an entry). */
function exportNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).sort();
}

describe("public API contract (golden export set per entry point)", () => {
  it("`.` (the main entry) exports exactly this set", () => {
    expect(exportNames(mainEntry)).toEqual([
      "ACL",
      "CONTACTS_SHAPE_PATH",
      "Contact",
      "ContactBook",
      "ContactGroup",
      "DC",
      "DCT",
      "DEFAULT_WORKFLOW",
      "PREFIXES",
      "PRIORITIES",
      "PROV",
      "RDF",
      "RDFS",
      "RDF_TYPE",
      "SCHEMA",
      "TASK_CLASS",
      "TASK_SHAPE_PATH",
      "TRACKER_SHAPE_PATH",
      "Task",
      "Tracker",
      "VCARD",
      "VCARD_ADDRESS_BOOK",
      "VCARD_CELL",
      "VCARD_FN",
      "VCARD_GROUP",
      "VCARD_GROUP_INDEX",
      "VCARD_HAS_EMAIL",
      "VCARD_HAS_MEMBER",
      "VCARD_HAS_TELEPHONE",
      "VCARD_HAS_UID",
      "VCARD_HOME",
      "VCARD_INCLUDES_GROUP",
      "VCARD_INDIVIDUAL",
      "VCARD_IN_ADDRESS_BOOK",
      "VCARD_NAME_EMAIL_INDEX",
      "VCARD_NOTE",
      "VCARD_URL",
      "VCARD_VALUE",
      "VCARD_WEB_ID",
      "WF",
      "WF_ALLOWED_TRANS",
      "WF_ASSIGNEE_GROUP",
      "WF_CLOSED",
      "WF_INITIAL_STATE",
      "WF_ISSUE_CATEGORY",
      "WF_ISSUE_CLASS",
      "WF_OPEN",
      "WF_STATE",
      "WF_STATE_STORE",
      "WF_TRACKER",
      "XSD",
      "acl",
      "addressBookShapeTtl",
      "addressBookSubject",
      "buildAddressBook",
      "buildGroup",
      "buildGroupsIndex",
      "buildPeopleIndex",
      "buildPerson",
      "buildTask",
      "buildTracker",
      "canTransition",
      "dc",
      "dct",
      "groupSubject",
      "isAssignedTo",
      "isHttpIri",
      "parseAddressBook",
      "parseAddressBookTtl",
      "parseGroup",
      "parseGroupTtl",
      "parsePerson",
      "parsePersonTtl",
      "parseTask",
      "parseTaskTtl",
      "parseTracker",
      "parseTrackerTtl",
      "personSubject",
      "prov",
      "rdf",
      "rdfs",
      "schema",
      "serializeAddressBook",
      "serializeGroup",
      "serializeGroupsIndex",
      "serializePeopleIndex",
      "serializePerson",
      "serializeTask",
      "serializeTracker",
      "sortTasks",
      "statusState",
      "storeToTurtle",
      "taskShapeTtl",
      "taskSubject",
      "trackerShapeTtl",
      "trackerSubject",
      "vcard",
      "wf",
      "xsd",
    ]);
  });

  it("`./task` exports exactly this set (client-safe; external consumers import here)", () => {
    expect(exportNames(taskEntry)).toEqual([
      "PRIORITIES",
      "Task",
      "buildTask",
      "isAssignedTo",
      "isHttpIri",
      "parseTask",
      "parseTaskTtl",
      "serializeTask",
      "sortTasks",
      "storeToTurtle",
      "taskSubject",
    ]);
  });

  it("`./tracker` exports exactly this set (client-safe; external consumers import here)", () => {
    expect(exportNames(trackerEntry)).toEqual([
      "DEFAULT_WORKFLOW",
      "Tracker",
      "buildTracker",
      "canTransition",
      "parseTracker",
      "parseTrackerTtl",
      "serializeTracker",
      "statusState",
      "trackerSubject",
    ]);
  });

  it("`./contacts` exports exactly this set (client-safe)", () => {
    expect(exportNames(contactsEntry)).toEqual([
      "Contact",
      "ContactBook",
      "ContactGroup",
      "addressBookSubject",
      "buildAddressBook",
      "buildGroup",
      "buildGroupsIndex",
      "buildPeopleIndex",
      "buildPerson",
      "groupSubject",
      "parseAddressBook",
      "parseAddressBookTtl",
      "parseGroup",
      "parseGroupTtl",
      "parsePerson",
      "parsePersonTtl",
      "personSubject",
      "serializeAddressBook",
      "serializeGroup",
      "serializeGroupsIndex",
      "serializePeopleIndex",
      "serializePerson",
    ]);
  });

  it("`./shape` exports exactly this set (server-only; reads the .ttl via node:fs)", () => {
    expect(exportNames(shapeEntry)).toEqual([
      "CONTACTS_SHAPE_PATH",
      "TASK_SHAPE_PATH",
      "TRACKER_SHAPE_PATH",
      "addressBookShapeTtl",
      "taskShapeTtl",
      "trackerShapeTtl",
    ]);
  });
});

// --- 2. Emitted-RDF golden master (canonical, normalised N-Quads) -------------

const RES = "http://localhost:3000/alice/issues/x";
const ME = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";
const TRACKER = "http://localhost:3000/alice/issues/tracker.ttl";
const BOOK = "http://localhost:3000/alice/contacts/index.ttl";
const PERSON = "http://localhost:3000/alice/contacts/Person/abc/index.ttl";
const GROUP = "http://localhost:3000/alice/contacts/Group/friends.ttl";

/**
 * Reduce a Turtle string to a CANONICAL, normalised, stable representation:
 * re-parse to quads, blank-node labels collapsed to a positional `_:b`,
 * non-deterministic literals (xsd:dateTime timestamps, urn:uuid values) replaced
 * with fixed placeholders, then sorted N-Quad lines. Two emissions that carry the
 * same RDF (modulo timestamps/uuids/bnode-naming) produce the same string here,
 * so a refactor that preserves the wire model produces a byte-identical snapshot.
 */
function canonical(ttl: string, base: string): string {
  const quads = new Parser({ baseIRI: base }).parse(ttl);
  // Stable blank-node relabelling: first-seen order within the sorted output is
  // unstable, so map each bnode label to a deterministic id keyed by the sorted
  // position of the (subject,predicate) edge that introduces it. Simpler + stable:
  // collapse every blank node to the single label `_:b` — the structured value
  // nodes are anonymous and never cross-referenced, so the predicate+value pins
  // them without needing distinct ids.
  const norm = (term: {
    termType: string;
    value: string;
    datatype?: { value: string };
  }): string => {
    if (term.termType === "BlankNode") return "_:b";
    if (term.termType === "NamedNode") return `<${term.value}>`;
    // Literal
    const dt = term.datatype?.value;
    if (dt === "http://www.w3.org/2001/XMLSchema#dateTime") return `"<<DATETIME>>"^^<${dt}>`;
    let v = term.value;
    if (/^urn:uuid:/.test(v)) v = "urn:uuid:<<UUID>>";
    return dt && dt !== "http://www.w3.org/2001/XMLSchema#string" ? `"${v}"^^<${dt}>` : `"${v}"`;
  };
  return quads
    .map((q) => `${norm(q.subject)} ${norm(q.predicate)} ${norm(q.object)} .`)
    .sort()
    .join("\n");
}

describe("emitted RDF golden master (canonical N-Quads, timestamps/uuids normalised)", () => {
  it("a fully-populated task serialises to the pinned graph", async () => {
    const ttl = await taskEntry.serializeTask(RES, {
      title: "Login button overflows on mobile",
      description: "Repro steps included.",
      state: "open",
      created: new Date("2026-06-09T10:00:00.000Z"),
      modified: new Date("2026-06-09T11:00:00.000Z"),
      creator: ME,
      assignee: BOB,
      project: `${TRACKER}#this`,
      dueDate: new Date("2026-07-01T00:00:00.000Z"),
      priority: "high",
      rank: 12.5,
      parent: `${RES}-parent`,
      blockedBy: [`${RES}-a`, `${RES}-b`],
      relatesTo: [`${RES}-c`],
      duplicateOf: `${RES}-dup`,
      clonedFrom: `${RES}-orig`,
    });
    expect(canonical(ttl, RES)).toMatchSnapshot();
  });

  it("a closed task serialises with wf:Closed + prov:endedAtTime", async () => {
    const ttl = await taskEntry.serializeTask(RES, { title: "Done thing", state: "closed" });
    expect(canonical(ttl, RES)).toMatchSnapshot();
  });

  it("a default tracker serialises to the pinned SolidOS-readable graph", async () => {
    const ttl = await trackerEntry.serializeTracker(TRACKER, {
      title: "Project Alpha",
      stateStore: "http://localhost:3000/alice/issues/",
      categories: ["http://localhost:3000/alice/issues/tracker.ttl#priority"],
      groupMembers: [ME, BOB],
    });
    expect(canonical(ttl, TRACKER)).toMatchSnapshot();
  });

  it("a custom-workflow tracker serialises to the pinned graph", async () => {
    const ttl = await trackerEntry.serializeTracker(TRACKER, {
      title: "Custom",
      workflow: {
        statuses: [
          { slug: "backlog", label: "Backlog", terminal: false },
          { slug: "shipped", label: "Shipped", terminal: true },
        ],
        transitions: { backlog: ["shipped"], shipped: [] },
      },
    });
    expect(canonical(ttl, TRACKER)).toMatchSnapshot();
  });

  it("an address book serialises to the pinned graph", async () => {
    const ttl = await contactsEntry.serializeAddressBook(BOOK, {
      title: "My Contacts",
      owner: ME,
    });
    expect(canonical(ttl, BOOK)).toMatchSnapshot();
  });

  it("a person serialises with structured email/phone/webId nodes", async () => {
    const ttl = await contactsEntry.serializePerson(PERSON, {
      name: "Bob Smith",
      inAddressBook: `${BOOK}#this`,
      emails: ["bob@example.com", "mailto:bob2@example.com"],
      phones: ["+15551234567", "tel:+15559999999"],
      webId: BOB,
      note: "A friend.",
      created: new Date("2026-06-09T10:00:00.000Z"),
    });
    expect(canonical(ttl, PERSON)).toMatchSnapshot();
  });

  it("a contact group serialises to the pinned graph", async () => {
    const ttl = await contactsEntry.serializeGroup(GROUP, {
      name: "Friends",
      inAddressBook: `${BOOK}#this`,
      members: [PERSON, `${GROUP}-other`],
    });
    expect(canonical(ttl, GROUP)).toMatchSnapshot();
  });

  it("a people index serialises to the pinned graph", async () => {
    const ttl = await contactsEntry.serializePeopleIndex(`${BOOK}#this`, [
      { person: `${PERSON}#this`, name: "Bob Smith" },
      { person: "not-a-url", name: "Dropped" },
    ]);
    expect(canonical(ttl, BOOK)).toMatchSnapshot();
  });

  it("a groups index serialises to the pinned graph", async () => {
    const ttl = await contactsEntry.serializeGroupsIndex(`${BOOK}#this`, [
      { group: `${GROUP}#this`, name: "Friends" },
    ]);
    expect(canonical(ttl, BOOK)).toMatchSnapshot();
  });

  it("untrusted non-http(s) object fields are dropped from the task graph", async () => {
    const ttl = await taskEntry.serializeTask(RES, {
      title: "X",
      state: "open",
      assignee: "javascript:alert(1)",
      creator: "mailto:bob@example.com",
      project: "not a url",
      parent: "urn:isbn:123",
      blockedBy: ["http://ok/1", "ftp://bad/2"],
    });
    expect(canonical(ttl, RES)).toMatchSnapshot();
  });
});

// --- Sanity: the empty store still emits the prefix preamble (storeToTurtle) ---

describe("storeToTurtle behaviour pin (empty store emits prefix preamble)", () => {
  it("an empty store serialises to a non-empty prefix preamble (NOT short-circuited to '')", async () => {
    const out = await taskEntry.storeToTurtle(new Store());
    // Pin the CURRENT behaviour: n3.Writer emits the prefix preamble even for a
    // zero-quad store (it does NOT short-circuit to ""). This is the contract a
    // would-be @jeswr/rdf-serialize swap must preserve (emptyAsEmptyString:false).
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("@prefix wf:");
  });
});
