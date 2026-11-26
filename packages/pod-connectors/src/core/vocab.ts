// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/**
 * Typed RDF wrappers for everything the Tier-A adapters write — the only way
 * integration data becomes triples (house rule: never hand-build quads).
 * Standard vocabularies only: schema.org + FOAF, matching the category
 * taxonomy's class lists (`src/lib/categories.ts`).
 */
import { escapeIri, safeIri as sharedSafeIri } from "@jeswr/rdf-serialize";
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";

export const SCHEMA = "https://schema.org/";
export const FOAF = "http://xmlns.com/foaf/0.1/";
/**
 * The `http://` schema.org spelling `@jeswr/solid-bookmark` writes for `schema:url` and
 * `schema:keywords` on bookmarks; imported bookmarks keep that exact wire format.
 */
export const SCHEMA_HTTP = "http://schema.org/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/**
 * Retain drop-on-invalid for raw Turtle-forbidden characters, then delegate
 * absolute-IRI validation to the shared guard. See QUESTIONS.md Q2.
 * @deprecated Import from @jeswr/rdf-serialize, rejecting values changed by escapeIri first.
 */
export function safeIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  if (escapeIri(value) !== value) return undefined;
  return sharedSafeIri(value);
}

/** Class IRIs the adapters stamp + register (kept with the wrappers). */
export const CLASSES = {
  MusicRecording: `${SCHEMA}MusicRecording`,
  MusicPlaylist: `${SCHEMA}MusicPlaylist`,
  SoftwareSourceCode: `${SCHEMA}SoftwareSourceCode`,
  ExerciseAction: `${SCHEMA}ExerciseAction`,
  TravelAction: `${SCHEMA}TravelAction`,
  SocialMediaPosting: `${SCHEMA}SocialMediaPosting`,
  WatchAction: `${SCHEMA}WatchAction`,
  TextDigitalDocument: `${SCHEMA}TextDigitalDocument`,
  DigitalDocument: `${SCHEMA}DigitalDocument`,
  Dataset: `${SCHEMA}Dataset`,
  Group: `${FOAF}Group`,
  OnlineAccount: `${FOAF}OnlineAccount`,
  // Tier-C file imports (export-file integrations).
  Invoice: `${SCHEMA}Invoice`,
  Book: `${SCHEMA}Book`,
  VideoGame: `${SCHEMA}VideoGame`,
  Message: `${SCHEMA}Message`,
  Event: `${SCHEMA}Event`,
  Movie: `${SCHEMA}Movie`,
  /** `book:Bookmark`, the `@jeswr/solid-bookmark` class (Pocket). */
  Bookmark: `${NS.BOOKMARK}Bookmark`,
  // Tier-B OAuth integrations (photos, videos, work positions).
  ImageObject: `${SCHEMA}ImageObject`,
  VideoObject: `${SCHEMA}VideoObject`,
  Organization: `${SCHEMA}Organization`,
} as const;

/**
 * Compact typed accessors for the export-file wrappers below: the same @rdfjs/wrapper
 * mappings as the hand-written getters, without repeating each mapping per property.
 */
const readText = (thing: TermWrapper, predicate: string) =>
  OptionalFrom.subjectPredicate(thing, predicate, LiteralAs.string);
const writeText = (thing: TermWrapper, predicate: string, value: string | undefined) =>
  OptionalAs.object(thing, predicate, value, LiteralFrom.string);
const readIri = (thing: TermWrapper, predicate: string) =>
  OptionalFrom.subjectPredicate(thing, predicate, NamedNodeAs.string);
const writeIri = (thing: TermWrapper, predicate: string, value: string | undefined) =>
  OptionalAs.object(thing, predicate, safeIri(value), NamedNodeFrom.string);
const readNumber = (thing: TermWrapper, predicate: string) =>
  OptionalFrom.subjectPredicate(thing, predicate, LiteralAs.number);
const writeDouble = (thing: TermWrapper, predicate: string, value: number | undefined) =>
  OptionalAs.object(thing, predicate, value, LiteralFrom.double);
const textSet = (thing: TermWrapper, predicate: string) =>
  SetFrom.subjectPredicate(thing, predicate, LiteralAs.string, LiteralFrom.string);

/** Shared schema.org basics every imported entity may carry. */
export class PodThing extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}name`, LiteralAs.string);
  }
  set name(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}name`, v, LiteralFrom.string);
  }
  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}description`, LiteralAs.string);
  }
  set description(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}description`, v, LiteralFrom.string);
  }
  /** Canonical page on the source platform. */
  get sourceUrl(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}url`, NamedNodeAs.string);
  }
  set sourceUrl(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}url`, safeIri(v), NamedNodeFrom.string);
  }
  /** The platform's own id for the item (provenance + dedupe). */
  get identifier(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}identifier`, LiteralAs.string);
  }
  set identifier(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}identifier`, v, LiteralFrom.string);
  }
  get dateCreated(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}dateCreated`, LiteralAs.date);
  }
  set dateCreated(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}dateCreated`, v, LiteralFrom.dateTime);
  }
  get dateModified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}dateModified`, LiteralAs.date);
  }
  set dateModified(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}dateModified`, v, LiteralFrom.dateTime);
  }
  get datePublished(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}datePublished`, LiteralAs.date);
  }
  set datePublished(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}datePublished`, v, LiteralFrom.dateTime);
  }
  /** The importing user's own review text. */
  get reviewBody(): string | undefined {
    return readText(this, `${SCHEMA}reviewBody`);
  }
  set reviewBody(v: string | undefined) {
    writeText(this, `${SCHEMA}reviewBody`, v);
  }
  /** Live set of tags (one schema:keywords literal per tag). */
  get keywords(): Set<string> {
    return textSet(this, `${SCHEMA}keywords`);
  }
}

export class MusicRecording extends PodThing {
  mark(): this {
    this.types.add(CLASSES.MusicRecording);
    return this;
  }
  /** Artist display name (schema.org allows Text for byArtist). */
  get byArtist(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}byArtist`, LiteralAs.string);
  }
  set byArtist(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}byArtist`, v, LiteralFrom.string);
  }
  get inAlbum(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}inAlbum`, LiteralAs.string);
  }
  set inAlbum(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}inAlbum`, v, LiteralFrom.string);
  }
  /** ISO-8601 duration (`PT3M52S`). */
  get duration(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}duration`, LiteralAs.string);
  }
  set duration(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}duration`, v, LiteralFrom.string);
  }
}

export class MusicPlaylist extends PodThing {
  mark(): this {
    this.types.add(CLASSES.MusicPlaylist);
    return this;
  }
  get numTracks(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}numTracks`, LiteralAs.number);
  }
  set numTracks(v: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}numTracks`, v, LiteralFrom.integer);
  }
}

export class SoftwareSourceCode extends PodThing {
  mark(): this {
    this.types.add(CLASSES.SoftwareSourceCode);
    return this;
  }
  get programmingLanguage(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}programmingLanguage`, LiteralAs.string);
  }
  set programmingLanguage(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}programmingLanguage`, v, LiteralFrom.string);
  }
  get codeRepository(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}codeRepository`, NamedNodeAs.string);
  }
  set codeRepository(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}codeRepository`, safeIri(v), NamedNodeFrom.string);
  }
}

/** Shared shape for schema.org Actions with time/distance (Strava, Twitch). */
export class ActionThing extends PodThing {
  get startTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}startTime`, LiteralAs.date);
  }
  set startTime(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}startTime`, v, LiteralFrom.dateTime);
  }
  /** ISO-8601 duration. */
  get duration(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}duration`, LiteralAs.string);
  }
  set duration(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}duration`, v, LiteralFrom.string);
  }
  /** schema:distance is Text-or-Distance — store human text ("5.2 km"). */
  get distance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}distance`, LiteralAs.string);
  }
  set distance(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}distance`, v, LiteralFrom.string);
  }
  /**
   * Energy expended, as `schema:Energy` text ("345 kcal"). `schema:calories`
   * is declared on NutritionInformation, but it is schema.org's only energy
   * property — we use it pragmatically for workout/journey energy (Garmin),
   * the same Text-shaped compromise as `distance` above.
   */
  get calories(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}calories`, LiteralAs.string);
  }
  set calories(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}calories`, v, LiteralFrom.string);
  }
}

export class ExerciseAction extends ActionThing {
  mark(): this {
    this.types.add(CLASSES.ExerciseAction);
    return this;
  }
  get exerciseType(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}exerciseType`, LiteralAs.string);
  }
  set exerciseType(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}exerciseType`, v, LiteralFrom.string);
  }
}

export class TravelAction extends ActionThing {
  mark(): this {
    this.types.add(CLASSES.TravelAction);
    return this;
  }
}

export class WatchAction extends ActionThing {
  mark(): this {
    this.types.add(CLASSES.WatchAction);
    return this;
  }
  /** The watched work (schema:object → a {@link Movie} subject), when the export names one. */
  get watchedWork(): string | undefined {
    return readIri(this, `${SCHEMA}object`);
  }
  set watchedWork(v: string | undefined) {
    writeIri(this, `${SCHEMA}object`, v);
  }
  /** The viewer's rating of this viewing, 0.5–5 stars (schema:ratingValue as a number). */
  get ratingValue(): number | undefined {
    return readNumber(this, `${SCHEMA}ratingValue`);
  }
  set ratingValue(v: number | undefined) {
    writeDouble(this, `${SCHEMA}ratingValue`, v);
  }
  /**
   * Whether this viewing was a rewatch. schema.org has no rewatch term, so the flag is
   * the `rewatch` tag among {@link keywords} (Letterboxd shows rewatches as a marker).
   */
  get rewatch(): boolean {
    return this.keywords.has(REWATCH_TAG);
  }
  set rewatch(v: boolean) {
    if (v) this.keywords.add(REWATCH_TAG);
    else this.keywords.delete(REWATCH_TAG);
  }
}

const REWATCH_TAG = "rewatch";

/** A film (Letterboxd) — schema:Movie → Media, with the reader-style status text Book uses. */
export class Movie extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Movie);
    return this;
  }
  /** Release year (schema:copyrightYear, an integer). */
  get copyrightYear(): number | undefined {
    return readNumber(this, `${SCHEMA}copyrightYear`);
  }
  set copyrightYear(v: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}copyrightYear`, v, LiteralFrom.integer);
  }
  /** Status text ("watched", "watchlist"), the same schema:actionStatus text as Book. */
  get watchStatus(): string | undefined {
    return readText(this, `${SCHEMA}actionStatus`);
  }
  set watchStatus(v: string | undefined) {
    writeText(this, `${SCHEMA}actionStatus`, v);
  }
  /** The viewer's overall rating of the film, 0.5–5 stars. */
  get ratingValue(): number | undefined {
    return readNumber(this, `${SCHEMA}ratingValue`);
  }
  set ratingValue(v: number | undefined) {
    writeDouble(this, `${SCHEMA}ratingValue`, v);
  }
}

export class SocialMediaPosting extends PodThing {
  mark(): this {
    this.types.add(CLASSES.SocialMediaPosting);
    return this;
  }
  get headline(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}headline`, LiteralAs.string);
  }
  set headline(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}headline`, v, LiteralFrom.string);
  }
  /** The community/feed it belongs to (subreddit, channel, …) as text. */
  get isPartOf(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}isPartOf`, LiteralAs.string);
  }
  set isPartOf(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}isPartOf`, v, LiteralFrom.string);
  }
}

export class Group extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Group);
    return this;
  }
}

export class OnlineAccount extends PodThing {
  mark(): this {
    this.types.add(CLASSES.OnlineAccount);
    return this;
  }
  get accountName(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${FOAF}accountName`, LiteralAs.string);
  }
  set accountName(v: string | undefined) {
    OptionalAs.object(this, `${FOAF}accountName`, v, LiteralFrom.string);
  }
  get accountServiceHomepage(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${FOAF}accountServiceHomepage`, NamedNodeAs.string);
  }
  set accountServiceHomepage(v: string | undefined) {
    OptionalAs.object(this, `${FOAF}accountServiceHomepage`, safeIri(v), NamedNodeFrom.string);
  }
}

export class DigitalDocument extends PodThing {
  /** Stamp as a generic file (Dropbox) or a text page (Notion). */
  mark(classIri: string = CLASSES.DigitalDocument): this {
    this.types.add(classIri);
    return this;
  }
  get encodingFormat(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}encodingFormat`, LiteralAs.string);
  }
  set encodingFormat(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}encodingFormat`, v, LiteralFrom.string);
  }
  /** schema:contentSize is Text ("1.2 MB"). */
  get contentSize(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}contentSize`, LiteralAs.string);
  }
  set contentSize(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}contentSize`, v, LiteralFrom.string);
  }
}

/** A structured collection (Notion database) — schema:Dataset. */
export class DataCollection extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Dataset);
    return this;
  }
}

/**
 * A financial document — order receipts (Amazon), trip fares (Uber) and bank
 * transactions (statements, ChatGPT-of-money). schema:Invoice lands in the
 * Finance category. Amounts are stored as human text on schema:totalPaymentDue
 * (schema allows Text-or-PriceSpecification) plus a structured currency code,
 * which is faithful without minting a nested MonetaryAmount node per row.
 */
export class Invoice extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Invoice);
    return this;
  }
  /** Vendor / counterparty as plain text (schema:provider is Org|Person). */
  get provider(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}provider`, LiteralAs.string);
  }
  set provider(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}provider`, v, LiteralFrom.string);
  }
  /** Human-readable total ("£42.50", "-$12.00" for a debit). */
  get totalPaymentDue(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}totalPaymentDue`, LiteralAs.string);
  }
  set totalPaymentDue(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}totalPaymentDue`, v, LiteralFrom.string);
  }
  /** ISO 4217 currency code, when the export states one. */
  get priceCurrency(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}priceCurrency`, LiteralAs.string);
  }
  set priceCurrency(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}priceCurrency`, v, LiteralFrom.string);
  }
  /** Order/payment status text, where the export carries one. */
  get paymentStatus(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}paymentStatus`, LiteralAs.string);
  }
  set paymentStatus(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}paymentStatus`, v, LiteralFrom.string);
  }
}

/** A book in a reading library (Goodreads) — schema:Book → Documents. */
export class Book extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Book);
    return this;
  }
  get author(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}author`, LiteralAs.string);
  }
  set author(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}author`, v, LiteralFrom.string);
  }
  get isbn(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}isbn`, LiteralAs.string);
  }
  set isbn(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}isbn`, v, LiteralFrom.string);
  }
  /** The reader's own rating, 0–5 (schema:Rating value as a number). */
  get ratingValue(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}ratingValue`, LiteralAs.number);
  }
  set ratingValue(v: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}ratingValue`, v, LiteralFrom.double);
  }
  /** Reading status text ("read", "currently-reading", "to-read"). */
  get readingStatus(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}actionStatus`, LiteralAs.string);
  }
  set readingStatus(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}actionStatus`, v, LiteralFrom.string);
  }
}

/** A game in a library (Steam) — schema:VideoGame → Media. */
export class VideoGame extends PodThing {
  mark(): this {
    this.types.add(CLASSES.VideoGame);
    return this;
  }
  /** Total playtime as ISO-8601 duration (schema:timeRequired). */
  get timeRequired(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}timeRequired`, LiteralAs.string);
  }
  set timeRequired(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}timeRequired`, v, LiteralFrom.string);
  }
}

/**
 * A chat message (WhatsApp) — schema:Message → Social & interests. The sender
 * is stored as plain text on schema:sender (schema allows Audience|Organization
 * |Person; we keep a literal name from the export, never an invented IRI).
 */
export class Message extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Message);
    return this;
  }
  get text(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}text`, LiteralAs.string);
  }
  set text(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}text`, v, LiteralFrom.string);
  }
  get sender(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}sender`, LiteralAs.string);
  }
  set sender(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}sender`, v, LiteralFrom.string);
  }
  /** The chat the message belongs to, as its display name (schema:isPartOf text, as on posts). */
  get conversation(): string | undefined {
    return readText(this, `${SCHEMA}isPartOf`);
  }
  set conversation(v: string | undefined) {
    writeText(this, `${SCHEMA}isPartOf`, v);
  }
  /** The message this one replies to (social:inReplyTo, never the inverse). */
  get inReplyTo(): string | undefined {
    return readIri(this, `${NS.SOCIAL}inReplyTo`);
  }
  set inReplyTo(v: string | undefined) {
    writeIri(this, `${NS.SOCIAL}inReplyTo`, v);
  }
  /**
   * For a forwarded message, the original author's display name: schema:creator text,
   * while schema:sender stays the person who forwarded it.
   */
  get forwardedFrom(): string | undefined {
    return readText(this, `${SCHEMA}creator`);
  }
  set forwardedFrom(v: string | undefined) {
    writeText(this, `${SCHEMA}creator`, v);
  }
  /** Live set of attached file names (names only; files are never read). */
  get attachmentNames(): Set<string> {
    return textSet(this, `${SCHEMA}messageAttachment`);
  }
}

/** A text document / conversation (ChatGPT, Takeout notes) — schema:TextDigitalDocument. */
export class TextDocument extends PodThing {
  mark(): this {
    this.types.add(CLASSES.TextDigitalDocument);
    return this;
  }
  get text(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}text`, LiteralAs.string);
  }
  set text(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}text`, v, LiteralFrom.string);
  }
}

/** A calendar event (Google Calendar, Takeout activity) — schema:Event → Calendar. */
export class CalendarEvent extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Event);
    return this;
  }
  get startDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}startDate`, LiteralAs.date);
  }
  set startDate(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}startDate`, v, LiteralFrom.dateTime);
  }
  get endDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}endDate`, LiteralAs.date);
  }
  set endDate(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}endDate`, v, LiteralFrom.dateTime);
  }
  /** Free-text location (schema:location allows Text). */
  get location(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}location`, LiteralAs.string);
  }
  set location(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}location`, v, LiteralFrom.string);
  }
}

/**
 * A media object (photo or video) — schema:ImageObject / schema:VideoObject →
 * Media. Carries a content URL (the platform-hosted asset) and, where the API
 * states one, dimensions and a human-readable duration (videos).
 */
export class MediaItem extends PodThing {
  /** Stamp as a photo ({@link CLASSES.ImageObject}) or video ({@link CLASSES.VideoObject}). */
  mark(classIri: string = CLASSES.ImageObject): this {
    this.types.add(classIri);
    return this;
  }
  /** The hosted asset URL (schema:contentUrl). */
  get contentUrl(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}contentUrl`, NamedNodeAs.string);
  }
  set contentUrl(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}contentUrl`, safeIri(v), NamedNodeFrom.string);
  }
  get encodingFormat(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}encodingFormat`, LiteralAs.string);
  }
  set encodingFormat(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}encodingFormat`, v, LiteralFrom.string);
  }
  get width(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}width`, LiteralAs.number);
  }
  set width(v: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}width`, v, LiteralFrom.integer);
  }
  get height(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}height`, LiteralAs.number);
  }
  set height(v: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}height`, v, LiteralFrom.integer);
  }
  /** ISO-8601 duration (videos). */
  get duration(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}duration`, LiteralAs.string);
  }
  set duration(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}duration`, v, LiteralFrom.string);
  }
}

/**
 * An organisation or organisational unit (Slack workspace + its channels) —
 * `schema:Organization` → Work & education. Channels are modelled as member
 * organisations (a faithful, no-invented-IRI mapping that lands in the right
 * category, since `foaf:Group` is claimed by Social).
 */
export class Organisation extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Organization);
    return this;
  }
}

/**
 * A work position the user held (LinkedIn) — modelled as the employer
 * `schema:Organization` carrying the role title (schema:jobTitle, allowed as a
 * Text on the role) and the dates worked. Lands in Work & education.
 */
export class WorkPosition extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Organization);
    return this;
  }
  /** The role/title held at this organisation. */
  get jobTitle(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}jobTitle`, LiteralAs.string);
  }
  set jobTitle(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}jobTitle`, v, LiteralFrom.string);
  }
  get startDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}startDate`, LiteralAs.date);
  }
  set startDate(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}startDate`, v, LiteralFrom.dateTime);
  }
  get endDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}endDate`, LiteralAs.date);
  }
  set endDate(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}endDate`, v, LiteralFrom.dateTime);
  }
}

/**
 * A saved link (Pocket) in the `@jeswr/solid-bookmark` wire format: `book:Bookmark` with
 * `schema:url` (the saved page, `http://` schema.org spelling), `dct:title`, `dct:created`,
 * `book:archived` and one `schema:keywords` literal per tag. The saved page is deliberately
 * not `https://schema.org/url` (PodThing.sourceUrl), which provenance reads as the record's
 * origin: a bookmark is derived from the export, not from the page it points to.
 */
export class Bookmark extends PodThing {
  mark(): this {
    this.types.add(CLASSES.Bookmark);
    return this;
  }
  get url(): string | undefined {
    return readIri(this, `${SCHEMA_HTTP}url`);
  }
  set url(v: string | undefined) {
    writeIri(this, `${SCHEMA_HTTP}url`, v);
  }
  get title(): string | undefined {
    return readText(this, `${NS.DCT}title`);
  }
  set title(v: string | undefined) {
    writeText(this, `${NS.DCT}title`, v);
  }
  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.DCT}created`, LiteralAs.date);
  }
  set created(v: Date | undefined) {
    OptionalAs.object(this, `${NS.DCT}created`, v, LiteralFrom.dateTime);
  }
  get archived(): boolean | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.BOOKMARK}archived`, LiteralAs.boolean);
  }
  set archived(v: boolean | undefined) {
    OptionalAs.object(this, `${NS.BOOKMARK}archived`, v, LiteralFrom.boolean);
  }
  get tags(): Set<string> {
    return textSet(this, `${SCHEMA_HTTP}keywords`);
  }
}

/** Default Turtle prefixes for readable imported documents. */
export const VOCAB_PREFIXES = {
  schema: SCHEMA,
  foaf: FOAF,
} as const;
