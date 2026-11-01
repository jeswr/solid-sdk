// AUTHORED-BY Codex GPT-6.1-Sol
/** Reviewed class → shape-tree mappings; an absent class must use SHACL discovery. */
export const CLASS_SHAPE_TREES: ReadonlyMap<string, readonly string[]> = new Map([
  // ActivityPods' SAI community implementation registers vcard:Individual with as/Profile:
  // https://github.com/activitypods/activitypods/blob/4bbdae69dd161a20ec78f1dc3a925f397eaa7305/pod-provider/backend/services/profiles/profile.ts
  // The deployed IRI is recorded in its SAI fixture:
  // https://github.com/activitypods/activitypods/blob/4bbdae69dd161a20ec78f1dc3a925f397eaa7305/tests/templates/actor_default.ttl
  [
    'http://www.w3.org/2006/vcard/ns#Individual',
    ['https://shapes.activitypods.org/shapetrees/as/Profile'],
  ],
]);

// Deliberately small: no verified mappings for the suite's schema.org document, Person,
// address or Event classes, or ical:Vevent, were available locally. The upstream Shape Trees
// test-suite's ContactShapeTree does not assert vcard:Individual, and CalendarShapeTree uses
// ical:Appointment, not Vevent. Do not infer equivalence or invent contacts/calendar IRIs.
