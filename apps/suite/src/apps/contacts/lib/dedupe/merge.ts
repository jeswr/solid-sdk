// AUTHORED-BY Codex GPT-6.1-Sol
import { partition } from "./cluster";
import type { DedupeContact, DedupeOptions, FieldConflict, FieldValue, MergePlan } from "./types";
import { type PreparedContact, prepareContacts } from "./validation";

function choices(entries: readonly (readonly [string, string])[]): FieldValue[] {
  const sources = new Map<string, string[]>();
  for (const [sourceId, value] of entries) {
    const ids = sources.get(value);
    if (ids) ids.push(sourceId);
    else sources.set(value, [sourceId]);
  }
  return [...sources].map(([value, sourceIds]) => ({ value, sourceIds }));
}

function identityUnion(members: PreparedContact[], field: "webIds" | "emails" | "phones") {
  const entries = members.flatMap((member) =>
    member[field].map((value) => [member.id, value] as const),
  );
  const byValue = new Map(choices(entries).map((choice) => [choice.value, choice]));
  return [...byValue.keys()].sort().map((value) => byValue.get(value) as FieldValue);
}

function plan(members: PreparedContact[]): MergePlan {
  const id = (members[0] as PreparedContact).id;
  const fieldNames = [...new Set(members.flatMap((member) => Object.keys(member.fields)))].sort();
  const conflicts: FieldConflict[] = [];
  const fields = Object.fromEntries(
    fieldNames.map((field) => {
      const entries = members.flatMap((member) =>
        Object.hasOwn(member.fields, field)
          ? [[member.id, member.fields[field] as string] as const]
          : [],
      );
      // Entries follow source ID order; exact-equal values share their provenance.
      const [winner, ...alternatives] = choices(entries) as [FieldValue, ...FieldValue[]];
      if (alternatives.length) conflicts.push({ field, winner, alternatives });
      return [field, winner];
    }),
  );
  const multiNames = [
    ...new Set(members.flatMap((member) => Object.keys(member.multiFields))),
  ].sort();
  const multiFields = Object.fromEntries(
    multiNames.map((field) => {
      const entries = members.flatMap((member) =>
        (Object.hasOwn(member.multiFields, field)
          ? (member.multiFields[field] as string[])
          : []
        ).map((value) => [member.id, value] as const),
      );
      const byValue = new Map(choices(entries).map((choice) => [choice.value, choice]));
      return [field, [...byValue.keys()].sort().map((value) => byValue.get(value) as FieldValue)];
    }),
  );
  return {
    id,
    targetId: id,
    contactIds: members.map((member) => member.id),
    fields,
    multiFields,
    webIds: identityUnion(members, "webIds"),
    emails: identityUnion(members, "emails"),
    phones: identityUnion(members, "phones"),
    conflicts,
  };
}

/** Complete partition, including singletons. Plans are proposals, with no I/O or mutation. */
export function planMerges(
  contacts: readonly DedupeContact[],
  options: DedupeOptions = {},
): MergePlan[] {
  return partition(prepareContacts(contacts, options)).map(plan);
}
