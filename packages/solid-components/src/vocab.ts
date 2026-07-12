// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The RDF CLASS IRIs the read components bind to — the keys of the resolver map and
// the `rdf:type` values the elements scan for.
//
// WHY THESE ARE LOCAL CONSTANTS (not imported from the data models): the class IRIs
// live in each model's `vocab.ts`, but the data models DON'T re-export them from the
// browser-safe public subpaths we consume:
//   - `@jeswr/solid-task-model/task` / `/contacts` export the wrappers + parsers but
//     NOT the bare class IRIs, and there is no published `./vocab` subpath; and
//   - the model's `.` index DOES export them, but pulls in `./shape.js` which uses
//     `node:fs` — importing `.` into a BROWSER bundle would drag a Node built-in in,
//     breaking the §8 self-contained browser dist.
// So we name the (stable, dereferenceable, standard-vocabulary) class IRIs here, as a
// tiny set of string constants — NOT a re-implemented model and NOT hand-built RDF.
// Each is the EXACT value the model mints (verified against the installed dist), so
// the resolver/scan match the model's own typing. A CEM-accuracy test asserts these
// equal the `@solid-class` JSDoc tags on the components.
//
// SOURCE OF TRUTH for each value (cross-checked against the installed dist):
//   - wf:Task            @jeswr/solid-task-model `vocab.TASK_CLASS`
//   - vcard:Individual   @jeswr/solid-task-model `vocab.VCARD_INDIVIDUAL`
//   - vcard:AddressBook  @jeswr/solid-task-model `vocab.VCARD_ADDRESS_BOOK`
//   - book:Bookmark      @jeswr/solid-bookmark   `vocab.BOOKMARK_CLASS`
//   - as:Note            @jeswr/solid-chat-interop `vocab.AS_NOTE` (the canonical message class)
//   - ldp:Container / ldp:BasicContainer — the LDP spec (generic container listing)

/** `wf:Task` — the federated task/issue class (`@jeswr/solid-task-model`). */
export const TASK_CLASS = "http://www.w3.org/2005/01/wf/flow#Task";

/** `vcard:Individual` — a single contact (`@jeswr/solid-task-model/contacts`). */
export const VCARD_INDIVIDUAL = "http://www.w3.org/2006/vcard/ns#Individual";

/** `vcard:AddressBook` — a contacts address book (`@jeswr/solid-task-model/contacts`). */
export const VCARD_ADDRESS_BOOK = "http://www.w3.org/2006/vcard/ns#AddressBook";

/** `book:Bookmark` — a bookmark / read-it-later item (`@jeswr/solid-bookmark`). */
export const BOOKMARK_CLASS = "https://w3id.org/jeswr/bookmark#Bookmark";

/** `as:Note` — the canonical chat message class (`@jeswr/solid-chat-interop`). */
export const AS_NOTE = "https://www.w3.org/ns/activitystreams#Note";

/** `ldp:Container` — a generic LDP container (the `<jeswr-collection>` listing). */
export const LDP_CONTAINER = "http://www.w3.org/ns/ldp#Container";

/** `ldp:BasicContainer` — a basic LDP container (sub-type of `ldp:Container`). */
export const LDP_BASIC_CONTAINER = "http://www.w3.org/ns/ldp#BasicContainer";

/** The `rdf:type` predicate IRI (subject-class existence scans). */
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
