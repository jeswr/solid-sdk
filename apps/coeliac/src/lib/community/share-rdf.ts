// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Serialise a sanitised {@link ShareCard} to Turtle (Phase 4B, design §4.1). The
 * card is written as an Activity Streams 2.0 `as:Note` (chat-interop's canonical
 * write vocab, design §1.3) additionally typed as its `diet:*Share` class.
 *
 * RDF is built via `n3` `DataFactory` typed quads + `n3.Writer` — never a
 * hand-concatenated triple (the house rule). Two defence-in-depth guards run at
 * serialisation time, on TOP of {@link assertShareable}:
 *  - every IRI-valued object is filtered http(s)-only (a non-http(s) author is
 *    dropped, matching chat-interop's `canonicalToAs2`); and
 *  - a diary IRI reaching serialisation is a bug — it throws (fail-closed), and the
 *    final Turtle is scanned for the diary scope segment before it is returned.
 */
import { DCT, DIET, PROV, RDF, XSD } from "@jeswr/solid-health-diary";
import { DataFactory, Writer } from "n3";
import type { Quad } from "@rdfjs/types";
import { AS2, DEFAULT_MEDIA_TYPE, type ShareCard } from "./share-card";
import { httpOrigin } from "./identity";
import { containsDiaryScope, isDiaryIri } from "./share-layout";
import { ShareSanitizationError } from "./share";

const { namedNode, literal, quad } = DataFactory;

const RDF_TYPE = `${RDF}type`;
const AS_NOTE = `${AS2}Note`;

/** Whether an IRI is an http(s) IRI safe to serialise as an object (chat-interop parity). */
function isHttpIri(iri: string): boolean {
  return httpOrigin(iri) !== null;
}

/**
 * Add an IRI-valued triple IF the object is a safe http(s) IRI. A diary IRI reaching
 * here is a bug (the generator + `assertShareable` should have refused it) — throw.
 */
function pushIri(quads: Quad[], subject: string, predicate: string, object: string | undefined): void {
  if (object === undefined) return;
  if (isDiaryIri(object)) {
    throw new ShareSanitizationError(`refusing to serialise a diary IRI into a share card: ${object}`);
  }
  if (!isHttpIri(object)) return; // drop a non-http(s) IRI (parity with canonicalToAs2)
  quads.push(quad(namedNode(subject), namedNode(predicate), namedNode(object)));
}

/**
 * Serialise a share card to a Turtle document. `subjectIri` is the card's subject
 * (typically `${resourceUrl}#it`). Assumes {@link assertShareable} has already
 * passed for the card; runs its own fail-closed diary-scope guards regardless.
 */
export async function serializeShareCard(card: ShareCard, subjectIri: string): Promise<string> {
  const { message } = card;
  const s = namedNode(subjectIri);
  const quads: Quad[] = [];

  // rdf:type as:Note + the diet:*Share class.
  quads.push(quad(s, namedNode(RDF_TYPE), namedNode(AS_NOTE)));
  quads.push(quad(s, namedNode(RDF_TYPE), namedNode(card.shareClass)));

  // A share NEVER carries a provenance-derivation link — REFUSE (never silently
  // omit) a card that does, so a direct serializer caller cannot get a clean write
  // payload from a provenance-bearing card by bypassing assertShareable. The source
  // link belongs ONLY in the owner-only sidecar (design §4.1). Fail-closed FIRST.
  if (message.provenance?.derivedFrom !== undefined) {
    throw new ShareSanitizationError(
      "refusing to serialise a card carrying provenance.derivedFrom — the source link belongs only in the owner-only sidecar",
    );
  }

  // A card body is ALWAYS plain text (stored-XSS guard) — enforce here too so a
  // direct serializer caller cannot bypass assertShareable's media-type check.
  if (message.mediaType !== DEFAULT_MEDIA_TYPE) {
    throw new ShareSanitizationError(`refusing to serialise a non-${DEFAULT_MEDIA_TYPE} card body: ${message.mediaType}`);
  }
  // Body (never a diary IRI — assertShareable guaranteed it; belt-and-braces below).
  if (containsDiaryScope(message.content)) {
    throw new ShareSanitizationError("refusing to serialise a card body that leaks a diary IRI");
  }
  quads.push(quad(s, namedNode(`${AS2}content`), literal(message.content)));
  quads.push(quad(s, namedNode(`${AS2}mediaType`), literal(message.mediaType)));

  if (message.published !== undefined) {
    quads.push(quad(s, namedNode(`${AS2}published`), literal(message.published, namedNode(`${XSD}dateTime`))));
  }

  // IRI-valued fields (http(s)-only; diary IRI throws).
  pushIri(quads, subjectIri, `${AS2}attributedTo`, message.author);
  pushIri(quads, subjectIri, `${AS2}context`, message.room);
  pushIri(quads, subjectIri, `${AS2}inReplyTo`, message.inReplyTo);
  pushIri(quads, subjectIri, `${DCT}isReplacedBy`, message.replacedBy);

  // Provenance: attributedTo/generatedBy only. derivedFrom is FORBIDDEN on a share
  // and already rejected fail-closed above (never reaches here).
  pushIri(quads, subjectIri, `${PROV}wasAttributedTo`, message.provenance?.attributedTo);
  pushIri(quads, subjectIri, `${PROV}wasGeneratedBy`, message.provenance?.generatedBy);

  const writer = new Writer({
    format: "text/turtle",
    prefixes: { as: AS2, diet: DIET, prov: PROV, dct: DCT, xsd: XSD },
  });
  for (const q of quads) writer.addQuad(q);

  return await new Promise<string>((resolve, reject) => {
    writer.end((err, result) => {
      if (err) return reject(err);
      // Final structural guard: the serialised document must not carry a diary IRI.
      if (containsDiaryScope(result)) {
        return reject(new ShareSanitizationError("serialised share card leaks a diary IRI"));
      }
      resolve(result);
    });
  });
}
