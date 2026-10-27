// AUTHORED-BY Codex GPT-6.1-Sol
import { LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, SetFrom } from "@rdfjs/wrapper";
import { PodThing } from "../core/vocab.js";

/** Exact federation terms; isolated here until CON-13's constants migration. */
export const MEDIA = "https://jeswr.org/ns/sectors/media#";
export const CORE = "https://jeswr.org/ns/core#";
export const TIME = "http://www.w3.org/2006/time#";
export const SCHEMA = "https://schema.org/";

/** Adapter-local typed accessors for the solid-listening/federation wire contract. */
export class MediaThing extends PodThing {
  set title(value: string | undefined) {
    OptionalAs.object(this, "http://purl.org/dc/terms/title", value, LiteralFrom.string);
  }
  set artistName(value: string | undefined) {
    OptionalAs.object(this, "http://xmlns.com/foaf/0.1/name", value, LiteralFrom.string);
  }
  set playedWork(value: string) {
    OptionalAs.object(this, `${MEDIA}playedWork`, value, NamedNodeFrom.string);
  }
  set atTime(value: string) {
    OptionalAs.object(this, `${CORE}atTime`, value, NamedNodeFrom.string);
  }
  set instant(value: Date) {
    OptionalAs.object(this, `${TIME}inXSDDateTime`, value, LiteralFrom.dateTime);
  }
  set playedVia(value: string) {
    OptionalAs.object(this, `${MEDIA}playedVia`, value, NamedNodeFrom.string);
  }
  get entries(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}itemListElement`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  set item(value: string) {
    OptionalAs.object(this, `${SCHEMA}item`, value, NamedNodeFrom.string);
  }
  set position(value: number) {
    OptionalAs.object(this, `${SCHEMA}position`, value, LiteralFrom.integer);
  }
}
