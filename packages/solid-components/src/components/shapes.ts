// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Inline SHACL shapes for the per-class EDITABLE forms. These drive the generated
// shacl-form UI (which fields the form shows + their datatypes/cardinalities). They
// are embedded as INLINE Turtle constants rather than read from each model's shape
// file because:
//   - the models' shape files ship under a `./shape` subpath that uses `node:fs`
//     (server-only) — importing it would drag a Node builtin into the browser dist
//     (the §8 self-contained-browser-dist contract; the same reason vocab.ts inlines
//     the class IRIs); and
//   - the form-driving shape is intentionally EDIT-FRIENDLY (flat string fields for
//     a contact's emails/phones, which the model stores as structured blank nodes —
//     the §10 merge converts them back via the model's typed `setEmails`/`setPhones`
//     setters), so it deliberately differs from the model's storage/validation shape.
//
// IMPORTANT — these shapes are non-empty (the §9 empty-shapes fail-close requires a
// non-zero shapes graph to mount a form) and pin a `sh:targetClass` so shacl-form
// binds the edited instance to the matching subject. They MUST stay aligned with the
// model's predicates (a CEM-accuracy-style test asserts the bound classes match the
// resolver map's `mode:"edit"` entries).

/** The editable `wf:Task` shape (a subset of @jeswr/solid-task-model's shape). */
export const TASK_SHAPE_TTL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix wf:     <http://www.w3.org/2005/01/wf/flow#> .
@prefix dct:    <http://purl.org/dc/terms/> .
@prefix schema: <http://schema.org/> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

[] a sh:NodeShape ;
  sh:targetClass wf:Task ;
  sh:property [ sh:path dct:title ;       sh:name "Title" ;       sh:order 1 ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path wf:description ;  sh:name "Description" ; sh:order 2 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path wf:assignee ;     sh:name "Assignee" ;    sh:order 3 ; sh:nodeKind sh:IRI ; sh:maxCount 1 ; sh:pattern "^https?://" ] ;
  sh:property [ sh:path wf:dateDue ;      sh:name "Due date" ;    sh:order 4 ; sh:datatype xsd:dateTime ; sh:maxCount 1 ] ;
  sh:property [ sh:path schema:priority ; sh:name "Priority" ;    sh:order 5 ; sh:datatype xsd:string ; sh:maxCount 1 ; sh:in ( "high" "medium" "low" ) ] .
`;

/** The editable `book:Bookmark` shape (aligned to @jeswr/solid-bookmark). */
export const BOOKMARK_SHAPE_TTL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix book:   <https://w3id.org/jeswr/bookmark#> .
@prefix schema: <http://schema.org/> .
@prefix dct:    <http://purl.org/dc/terms/> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

[] a sh:NodeShape ;
  sh:targetClass book:Bookmark ;
  sh:property [ sh:path schema:url ;         sh:name "URL" ;         sh:order 1 ; sh:nodeKind sh:IRI ; sh:minCount 1 ; sh:maxCount 1 ; sh:pattern "^https?://" ] ;
  sh:property [ sh:path dct:title ;          sh:name "Title" ;       sh:order 2 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path dct:description ;    sh:name "Description" ; sh:order 3 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path book:notes ;         sh:name "Notes" ;       sh:order 4 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path book:archived ;      sh:name "Archived" ;    sh:order 5 ; sh:datatype xsd:boolean ; sh:maxCount 1 ] ;
  sh:property [ sh:path schema:keywords ;    sh:name "Tags" ;        sh:order 6 ; sh:datatype xsd:string ] .
`;

// The EDIT-FRIENDLY contact namespace for the FLAT form fields the generated UI
// collects (plain string email/phone), which the §10 merge converts to the model's
// STRUCTURED storage form via `Contact.setEmails`/`setPhones`. The model stores
// emails as `vcard:hasEmail [ vcard:value <mailto:…> ]`; editing a structured
// blank node in a generated form is awkward, so the form collects bare strings and
// the merge re-structures them. The merge reads these flat fields off the form graph.

/** `vcard:fn` etc. — the editable `vcard:Individual` shape (FLAT string fields). */
export const CONTACT_SHAPE_TTL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix vcard:  <http://www.w3.org/2006/vcard/ns#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

[] a sh:NodeShape ;
  sh:targetClass vcard:Individual ;
  sh:property [ sh:path vcard:fn ;                sh:name "Name" ;         sh:order 1 ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path vcard:organization-name ; sh:name "Organisation" ; sh:order 2 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path vcard:note ;              sh:name "Note" ;         sh:order 3 ; sh:datatype xsd:string ; sh:maxCount 1 ] .
`;
