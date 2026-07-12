// ProfileAgent — reference wrapper for rendering a Solid profile on top of
// @solid/object's `Agent`. It adds the full UI fallback chains (name, avatar,
// bio, nickname, homepage) that `Agent` does not cover. Candidate for
// upstreaming into @solid/object; vendored here until then.
//
// HOUSE RULE: this is the sanctioned way to read profile fields — typed
// @rdfjs/wrapper accessors over the dataset, never regex over Turtle, never
// hand-built triples.
import { Agent } from "@solid/object";
import { OptionalFrom, LiteralAs, NamedNodeAs } from "@rdfjs/wrapper";

const FOAF = "http://xmlns.com/foaf/0.1/";
const SCHEMA = "http://schema.org/";
const VCARD = "http://www.w3.org/2006/vcard/ns#";
const AS = "https://www.w3.org/ns/activitystreams#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SIOC = "http://rdfs.org/sioc/ns#";

const first = <T>(...reads: (() => T | undefined)[]): T | undefined => {
  for (const read of reads) {
    try {
      const v = read();
      if (v !== undefined) return v;
    } catch {
      // A predicate present with an unexpected term type (e.g. a literal where
      // an IRI is expected) must not abort the chain — fall through.
    }
  }
  return undefined;
};

export class ProfileAgent extends Agent {
  /**
   * Display name, full fallback chain:
   * foaf:name → schema:name → vcard:fn → as:name → rdfs:label → the WebID IRI.
   * (The base `Agent.name` getter covers vcard:fn → foaf:name only.)
   */
  get displayName(): string {
    return (
      first(
        () => OptionalFrom.subjectPredicate(this, FOAF + "name", LiteralAs.string),
        () => OptionalFrom.subjectPredicate(this, SCHEMA + "name", LiteralAs.string),
        () => OptionalFrom.subjectPredicate(this, VCARD + "fn", LiteralAs.string),
        () => OptionalFrom.subjectPredicate(this, AS + "name", LiteralAs.string),
        () => OptionalFrom.subjectPredicate(this, RDFS + "label", LiteralAs.string),
      ) ?? this.value
    );
  }

  /**
   * Avatar/photo IRI:
   * vcard:hasPhoto → as:image → foaf:img → schema:image → vcard:photo →
   * sioc:avatar → foaf:depiction.
   */
  get avatarUrl(): string | undefined {
    return first(
      () => OptionalFrom.subjectPredicate(this, VCARD + "hasPhoto", NamedNodeAs.string),
      () => OptionalFrom.subjectPredicate(this, AS + "image", NamedNodeAs.string),
      () => OptionalFrom.subjectPredicate(this, FOAF + "img", NamedNodeAs.string),
      () => OptionalFrom.subjectPredicate(this, SCHEMA + "image", NamedNodeAs.string),
      () => OptionalFrom.subjectPredicate(this, VCARD + "photo", NamedNodeAs.string),
      () => OptionalFrom.subjectPredicate(this, SIOC + "avatar", NamedNodeAs.string),
      () => OptionalFrom.subjectPredicate(this, FOAF + "depiction", NamedNodeAs.string),
    );
  }

  /** Short bio: vcard:note → schema:description. */
  get bio(): string | undefined {
    return first(
      () => OptionalFrom.subjectPredicate(this, VCARD + "note", LiteralAs.string),
      () => OptionalFrom.subjectPredicate(this, SCHEMA + "description", LiteralAs.string),
    );
  }

  /** Nickname: foaf:nick → vcard:nickname. */
  get nickname(): string | undefined {
    return first(
      () => OptionalFrom.subjectPredicate(this, FOAF + "nick", LiteralAs.string),
      () => OptionalFrom.subjectPredicate(this, VCARD + "nickname", LiteralAs.string),
    );
  }

  /** Homepage: foaf:homepage → schema:url → vcard:url. */
  get homepage(): string | undefined {
    return first(
      () => OptionalFrom.subjectPredicate(this, FOAF + "homepage", NamedNodeAs.string),
      () => OptionalFrom.subjectPredicate(this, SCHEMA + "url", NamedNodeAs.string),
      () => OptionalFrom.subjectPredicate(this, VCARD + "url", NamedNodeAs.string),
    );
  }
}
