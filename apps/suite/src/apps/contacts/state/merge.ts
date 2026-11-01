// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { clusterContacts, type DedupeContact, planMerges } from "../lib/dedupe";
import { normaliseEmail, normalisePhone, validateWebId } from "../lib/dedupe/normalise";
import { Contact, type ContactData, type ContactGroupData, type Snapshot } from "../lib/model";
import { applyContact, VCARD } from "../lib/model/data";
import type { ContactsData, MergeOutcome } from "./controller";
import type { StarStorage } from "./data";

/** Single-valued fields the merge review asks about. Contact points and labels are unioned. */
export const MERGE_FIELDS = ["name", "organization", "note", "webId"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
/** The kept value per field. An omitted field keeps the primary's value, else a copy's. */
export type MergeSelection = Partial<Record<MergeField, string>>;
export interface MergeOption {
  value: string;
  /** Contact IDs supplying this exact value, in contact ID order. */
  sourceIds: readonly string[];
}
export type MergeChoices = Record<MergeField, readonly MergeOption[]>;

export interface DuplicateReason {
  kind: "email" | "phone" | "webId";
  /** The normalised matching key (email, phone) or exact WebID. */
  value: string;
}
export interface DuplicateGroup {
  /** Stable while membership is unchanged: the member IDs in UTF-16 order. */
  id: string;
  contactIds: readonly string[];
  reasons: readonly DuplicateReason[];
}

const id = (person: Snapshot<unknown>) => `${person.url}#this`;
const usable = (value: string | undefined): value is string =>
  value?.isWellFormed() === true && value.trim() !== "";

function accepted(values: readonly string[], check: (value: string) => unknown): string[] {
  return values.filter((value) => {
    try {
      check(value);
      return true;
    } catch {
      return false;
    }
  });
}

type Projection = DedupeContact & { emails: string[]; phones: string[]; webIds: string[] };

/** An explicit dedupe projection: unsupported contact points simply never match. */
export function dedupeContact(person: Snapshot<ContactData>): Projection {
  const data = person.data;
  const fields: Record<string, string> = {};
  for (const field of ["name", "organization", "note"] as const) {
    const value = data[field];
    if (usable(value)) fields[field] = value;
  }
  return {
    id: id(person),
    fields,
    emails: accepted(
      (data.emails ?? []).map((email) => email.replace(/^mailto:/, "")),
      normaliseEmail,
    ),
    phones: accepted(
      (data.phones ?? []).map((phone) => phone.replace(/^tel:/, "")),
      normalisePhone,
    ),
    webIds: accepted(usable(data.webId) ? [data.webId] : [], validateWebId),
  };
}

function identities(contact: Projection): Map<string, DuplicateReason> {
  const keys = new Map<string, DuplicateReason>();
  const add = (kind: DuplicateReason["kind"], value: string) =>
    keys.set(`${kind}:${value}`, { kind, value });
  for (const email of contact.emails) add("email", normaliseEmail(email));
  for (const phone of contact.phones) add("phone", normalisePhone(phone));
  for (const webId of contact.webIds) add("webId", webId);
  return keys;
}

/** Order-independent identity of a "not duplicates" decision. */
export function pairKey(a: string, b: string): string {
  return JSON.stringify(a < b ? [a, b] : [b, a]);
}

/**
 * Likely duplicates: the dedupe library's identity clusters, split wherever the user said two
 * contacts are not duplicates. Members stay together only through undismissed direct matches.
 */
export function findDuplicates(
  people: readonly Snapshot<ContactData>[],
  dismissed: ReadonlySet<string> = new Set(),
): DuplicateGroup[] {
  const contacts = people.map(dedupeContact);
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const groups: DuplicateGroup[] = [];
  for (const cluster of clusterContacts(contacts)) {
    if (cluster.contactIds.length < 2) continue;
    const members = cluster.contactIds.map((member) => ({
      id: member,
      keys: identities(byId.get(member) as Projection),
    }));
    const parent = new Map(members.map((member) => [member.id, member.id]));
    const root = (value: string): string => {
      const next = parent.get(value) as string;
      return next === value ? value : root(next);
    };
    const reasons = new Map<string, Map<string, DuplicateReason>>();
    for (const [index, left] of members.entries()) {
      for (const right of members.slice(index + 1)) {
        if (dismissed.has(pairKey(left.id, right.id))) continue;
        const shared = [...left.keys].filter(([key]) => right.keys.has(key));
        if (!shared.length) continue;
        const [a, b] = [root(left.id), root(right.id)];
        if (a !== b) parent.set(b, a);
        const found = reasons.get(left.id) ?? new Map();
        for (const [key, reason] of shared) found.set(key, reason);
        reasons.set(left.id, found);
      }
    }
    const components = new Map<string, string[]>();
    for (const member of members) {
      const top = root(member.id);
      components.set(top, [...(components.get(top) ?? []), member.id]);
    }
    for (const contactIds of components.values()) {
      if (contactIds.length < 2) continue;
      const shared = new Map<string, DuplicateReason>();
      for (const member of contactIds)
        for (const [key, reason] of reasons.get(member) ?? []) shared.set(key, reason);
      groups.push({
        id: contactIds.join(" "),
        contactIds,
        reasons: [...shared.keys()].sort().map((key) => shared.get(key) as DuplicateReason),
      });
    }
  }
  const names = new Map(people.map((person) => [id(person), person.data.name]));
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  return groups.sort(
    (a, b) =>
      collator.compare(
        names.get(a.contactIds[0] as string) as string,
        names.get(b.contactIds[0] as string) as string,
      ) || a.id.localeCompare(b.id),
  );
}

/** The distinct values offered for each reviewed field, from the library's merge plan. */
export function mergeChoices(people: readonly Snapshot<ContactData>[]): MergeChoices {
  // The reviewed contacts are one merge even if a refresh broke their identity link; a shared
  // reserved-domain key keeps them in a single plan. Its identity union is never used.
  const plan = planMerges(
    people.map((person) => {
      const contact = dedupeContact(person);
      return { ...contact, emails: [...contact.emails, "merge@review.invalid"] };
    }),
  )[0];
  const choices: MergeChoices = { name: [], organization: [], note: [], webId: [] };
  if (!plan) return choices;
  for (const field of ["name", "organization", "note"] as const) {
    const winner = plan.fields[field];
    if (!winner) continue;
    const conflict = plan.conflicts.find((entry) => entry.field === field);
    choices[field] = [winner, ...(conflict?.alternatives ?? [])];
  }
  choices.webId = plan.webIds;
  return choices;
}

/** Defaults to the primary's values; otherwise the library's winner, so no field goes empty. */
export function defaultSelection(choices: MergeChoices, primary: string): MergeSelection {
  const selection: MergeSelection = {};
  for (const field of MERGE_FIELDS) {
    const options = choices[field];
    const own = options.find((option) => option.sourceIds.includes(primary));
    const value = (own ?? options[0])?.value;
    if (value !== undefined) selection[field] = value;
  }
  return selection;
}

function union(values: readonly string[], key: (value: string) => string): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    let normalised: string;
    try {
      normalised = key(value);
    } catch {
      normalised = value;
    }
    if (!seen.has(normalised)) seen.set(normalised, value);
  }
  return [...seen.values()];
}

/** The primary keeps its own spelling first; equal normalised contact points appear once. */
export function mergeContactData(
  primary: ContactData,
  others: readonly ContactData[],
  selection: MergeSelection,
): ContactData {
  const all = [primary, ...others];
  const emails = union(
    all.flatMap((data) => data.emails ?? []),
    (email) => normaliseEmail(email.replace(/^mailto:/, "")),
  );
  const phones = union(
    all.flatMap((data) => data.phones ?? []),
    (phone) => normalisePhone(phone.replace(/^tel:/, "")),
  );
  const merged: ContactData = { ...primary, name: selection.name ?? primary.name };
  for (const field of ["organization", "note", "webId"] as const) {
    // Unselected fields keep the primary's value, else a copy's, rather than going empty.
    const value =
      selection[field] ??
      primary[field] ??
      others.find((data) => data[field] !== undefined)?.[field];
    if (value === undefined) delete merged[field];
    else merged[field] = value;
  }
  if (emails.length) merged.emails = emails;
  if (phones.length) merged.phones = phones;
  return merged;
}

/** The merged person document: the primary's RDF, with only the merged fields reconciled. */
export function mergedDocument(person: Snapshot<ContactData>, data: ContactData): Store {
  const dataset = new Store([...person.dataset]);
  applyContact(new Contact(id(person), dataset, DataFactory), data);
  return dataset;
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** Retired or reviewed with the merge: identity, membership, creation date and chosen fields. */
const RETIRED = new Set([
  `${VCARD}fn`,
  `${VCARD}note`,
  `${VCARD}organization-name`,
  `${VCARD}inAddressBook`,
  `${VCARD}hasUID`,
  "http://purl.org/dc/terms/created",
]);
const POINTS: Record<string, string> = {
  [`${VCARD}hasEmail`]: "email",
  [`${VCARD}hasTelephone`]: "phone",
  [`${VCARD}url`]: "website",
};
const NAMED: Record<string, string> = {
  [`${VCARD}hasAddress`]: "address",
  [`${VCARD}bday`]: "birthday",
  [`${VCARD}anniversary`]: "anniversary",
  [`${VCARD}hasPhoto`]: "photo",
  [`${VCARD}nickname`]: "nickname",
  [`${VCARD}title`]: "job title",
  [`${VCARD}role`]: "role",
};
const local = (iri: string) => iri.replace(/^.*[#/]/, "") || iri;

function pointValue(dataset: DatasetCore, node: Term): string {
  if (node.termType !== "BlankNode") return node.value;
  const [value] = dataset.match(node, DataFactory.namedNode(`${VCARD}value`));
  return value?.object.value ?? "";
}
function pointKey(kind: string, value: string): string {
  try {
    if (kind === "email") return normaliseEmail(value.replace(/^mailto:/, ""));
    if (kind === "phone") return normalisePhone(value.replace(/^tel:/, ""));
  } catch {
    // Unsupported spellings only match themselves.
  }
  return value;
}
const isWebIdNode = (dataset: DatasetCore, node: Term) =>
  dataset.match(node, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(`${VCARD}WebId`))
    .size > 0;

/**
 * What deleting `duplicate` would discard, like the migration's lossless check: every RDF
 * statement the merged primary does not carry. Identity, creation date and the reviewed fields
 * (name, organisation, note, WebID) are deliberate choices and are not listed.
 */
export function mergeLosses(merged: DatasetCore, primaryId: string, duplicate: Snapshot<unknown>) {
  const subject = id(duplicate);
  const source = duplicate.dataset;
  const losses = new Set<string>();
  // Stores may mint fresh Quad objects per match, so compare statements by their terms.
  const covered = new Set<string>();
  const key = (quad: Quad) =>
    JSON.stringify(
      [quad.subject, quad.predicate, quad.object]
        .map((t) => [t.termType, t.value])
        .concat(
          quad.object.termType === "Literal"
            ? [[quad.object.language, quad.object.datatype.value]]
            : [],
        ),
    );
  // Whole subtrees below a lost edge belong to that loss (e.g. an address's parts).
  const cover = (term: Term) => {
    if (term.termType !== "BlankNode") return;
    for (const quad of source.match(term)) {
      if (covered.has(key(quad))) continue;
      covered.add(key(quad));
      cover(quad.object);
    }
  };
  const target = DataFactory.namedNode(primaryId);
  for (const quad of source.match(DataFactory.namedNode(subject))) {
    covered.add(key(quad));
    const predicate = quad.predicate.value;
    if (RETIRED.has(predicate)) continue;
    if (predicate === RDF_TYPE) {
      if (quad.object.value !== `${VCARD}Individual`)
        losses.add(`type ${local(quad.object.value)}`);
      continue;
    }
    const kind = POINTS[predicate];
    if (!kind) {
      losses.add(NAMED[predicate] ?? local(predicate));
      cover(quad.object);
      continue;
    }
    cover(quad.object);
    if (kind === "website" && isWebIdNode(source, quad.object)) continue;
    const value = pointValue(source, quad.object);
    const wanted = pointKey(kind, value);
    const kept = [...merged.match(target, quad.predicate)].find(
      (edge) => pointKey(kind, pointValue(merged, edge.object)) === wanted,
    )?.object;
    const shown = value.replace(/^(mailto|tel):/, "");
    if (!kept) {
      losses.add(`${kind} ${shown}`.trim());
      continue;
    }
    if (quad.object.termType !== "BlankNode") continue;
    for (const detail of source.match(quad.object)) {
      if (detail.predicate.value === `${VCARD}value`) continue;
      const same = merged.match(kept, detail.predicate, detail.object).size > 0;
      if (same) continue;
      losses.add(
        detail.predicate.value === RDF_TYPE
          ? `${local(detail.object.value)} label on ${kind} ${shown}`
          : `${local(detail.predicate.value)} on ${kind} ${shown}`,
      );
    }
  }
  for (const quad of source) {
    if (!covered.has(key(quad))) {
      losses.add("other data in the contact's document");
      break;
    }
  }
  return [...losses].sort();
}

/** Optimistic view of a merge, replaced by the pod's state once the write settles. */
export function applyMerge(
  data: ContactsData,
  primary: string,
  duplicates: readonly string[],
  selection: MergeSelection,
): ContactsData {
  const others = data.people.filter((person) => duplicates.includes(id(person)));
  const groups = data.groups.map((group): Snapshot<ContactGroupData> => {
    const members = group.data.members ?? [];
    const joined = members.some((member) => duplicates.includes(member));
    return {
      ...group,
      data: {
        ...group.data,
        members: [
          ...new Set([
            ...members.filter((member) => !duplicates.includes(member)),
            ...(joined ? [primary] : []),
          ]),
        ],
      },
    };
  });
  return {
    ...data,
    people: data.people.flatMap((person) => {
      if (duplicates.includes(id(person))) return [];
      if (id(person) !== primary) return [person];
      const merged = mergeContactData(
        person.data,
        others.map((other) => other.data),
        selection,
      );
      return [{ ...person, data: merged }];
    }),
    groups,
  };
}

/** "Not duplicates" decisions are app preferences, kept per WebID like starred contacts. */
export function dismissedKey(webId: string) {
  return `solid-suite:contacts:not-duplicates:${webId}`;
}
export function readDismissed(storage: StarStorage, webId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(dismissedKey(webId)) ?? "[]");
    return new Set(
      Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [],
    );
  } catch {
    return new Set();
  }
}
/** Records every pair in the group. A newly matching contact can still form a new group. */
export function dismissGroup(
  storage: StarStorage,
  webId: string,
  dismissed: ReadonlySet<string>,
  contactIds: readonly string[],
): Set<string> {
  const next = new Set(dismissed);
  for (const [index, left] of contactIds.entries())
    for (const right of contactIds.slice(index + 1)) next.add(pairKey(left, right));
  storage.setItem(dismissedKey(webId), JSON.stringify([...next]));
  return next;
}

/** Only claim what the outcome guarantees. */
export function mergeFailureMessage(outcome: MergeOutcome, names: string): string {
  switch (outcome) {
    case "unchanged":
      return `Could not merge ${names}. No contacts were changed.`;
    case "pending":
      return `The merge of ${names} was interrupted. It will finish when Contacts loads again: retry or reload.`;
    case "conflict":
      return `Could not finish merging ${names} because a contact changed elsewhere. Contacts not yet merged were kept.`;
    default:
      return `Could not confirm the merge of ${names}. Reload Contacts to check the result.`;
  }
}
