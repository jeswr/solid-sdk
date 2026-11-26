<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# `profile-agent.ts` — source example

<!-- AUTHORED-BY Claude Opus 5.5 -->

Extract the code block to `profile-agent.ts` when adapting the example. The class
was run on 2026-11-18 in Node 22 (`--experimental-strip-types`; the suite targets Node 24, and
nothing here needs more than 22) against
`@solid/object` 0.8.0, `@rdfjs/wrapper` 0.34.0 and `n3` 2.13.12: a literal
`vcard:hasPhoto` fell through to `foaf:img`, a `javascript:` link was refused, and
an empty profile gave the full WebID as its name. The `renderable` usage at the end
calls `fetchRdf` and was not run.

```ts
// ProfileAgent — reference implementation for profile rendering on top of @solid/object.
// Candidate for upstreaming into @solid/object; bundled with the solid-object skill until then.
import { Agent } from "@solid/object";
import { OptionalFrom, LiteralAs, NamedNodeAs } from "@rdfjs/wrapper";

const FOAF = "http://xmlns.com/foaf/0.1/";
const SCHEMA = "http://schema.org/";
const VCARD = "http://www.w3.org/2006/vcard/ns#";
const AS = "https://www.w3.org/ns/activitystreams#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SIOC = "http://rdfs.org/sioc/ns#";

// Only http(s) links are safe to put in an <img src> or <a href>.
const httpUrl = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
};

const first = <T>(...reads: (() => T | undefined)[]): T | undefined => {
  for (const read of reads) {
    try {
      const v = read();
      if (v !== undefined) return v;
    } catch {
      // a predicate present with an unexpected term type (e.g. literal where an
      // IRI is expected) should not abort the chain — fall through
    }
  }
  return undefined;
};

export class ProfileAgent extends Agent {
  /**
   * Display name with the full fallback chain:
   * foaf:name → schema:name → vcard:fn → as:name → rdfs:label → the WebID IRI.
   * (The base Agent.name getter covers vcard:fn → foaf:name, then falls back to the
   * last path segment, e.g. "card" for /profile/card#me, so never display it.)
   * Order is a suggested preference — adjust to the ecosystem you integrate with.
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
   * Avatar/photo IRI: vcard:hasPhoto → as:image → foaf:img → schema:image →
   * vcard:photo → sioc:avatar → foaf:depiction. Only http(s) IRIs count: a literal
   * or another scheme skips to the next predicate. (Base Agent.photoUrl reads
   * vcard:hasPhoto as a plain string and checks no scheme, so never display it.)
   */
  get avatarUrl(): string | undefined {
    return first(
      () => httpUrl(OptionalFrom.subjectPredicate(this, VCARD + "hasPhoto", NamedNodeAs.string)),
      () => httpUrl(OptionalFrom.subjectPredicate(this, AS + "image", NamedNodeAs.string)),
      () => httpUrl(OptionalFrom.subjectPredicate(this, FOAF + "img", NamedNodeAs.string)),
      () => httpUrl(OptionalFrom.subjectPredicate(this, SCHEMA + "image", NamedNodeAs.string)),
      () => httpUrl(OptionalFrom.subjectPredicate(this, VCARD + "photo", NamedNodeAs.string)),
      () => httpUrl(OptionalFrom.subjectPredicate(this, SIOC + "avatar", NamedNodeAs.string)),
      () => httpUrl(OptionalFrom.subjectPredicate(this, FOAF + "depiction", NamedNodeAs.string)),
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

  /** Homepage: foaf:homepage → schema:url → vcard:url, http(s) IRIs only. */
  get homepage(): string | undefined {
    return first(
      () => httpUrl(OptionalFrom.subjectPredicate(this, FOAF + "homepage", NamedNodeAs.string)),
      () => httpUrl(OptionalFrom.subjectPredicate(this, SCHEMA + "url", NamedNodeAs.string)),
      () => httpUrl(OptionalFrom.subjectPredicate(this, VCARD + "url", NamedNodeAs.string)),
    );
  }
}

// usage shape — read the profile of a known WebID
import { DataFactory } from "n3";
import { fetchRdf } from "@jeswr/fetch-rdf";

export async function renderable(webId: string) {
  const { dataset } = await fetchRdf(webId);
  // Read the WebID you were given. WebIdDataset.mainSubject returns the FIRST subject
  // with any solid:oidcIssuer, which can be someone else in the same document.
  const profile = new ProfileAgent(webId, dataset, DataFactory);

  // Multiple storages: surface ALL of them and let the USER choose — never pick silently.
  const storages = [...profile.storageUrls];

  return { name: profile.displayName, avatar: profile.avatarUrl, storages };
}
```
