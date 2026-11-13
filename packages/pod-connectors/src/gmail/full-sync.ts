// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/** Private full-sync journal. The public successful history checkpoint is never advanced here. */
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { DEFAULT_RUN_LIMITS, RunBudgetExceededError } from "../core/budget.js";
import type { ImportContext } from "../core/types.js";
import { CLASSES, PodThing } from "../core/vocab.js";
import { MAIL_SCHEMA } from "../mail/vocab.js";

/**
 * Hand-written like the package's other models: pod-connectors has no codegen profile yet
 * (tracker bead "pod-connectors: move Drive vocab accessors to generated models").
 */
class FullSyncState extends PodThing {
  get pageToken(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}version`, LiteralAs.string);
  }
  set pageToken(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}version`, value, LiteralFrom.string);
  }
  get completed(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${MAIL_SCHEMA}itemListElement`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get seen(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${MAIL_SCHEMA}hasPart`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/**
 * Bounds a saved journal must stay within so the default Pod reader (`@jeswr/fetch-rdf`:
 * 16 MiB, 1,000,000 quads) can load it again, with margin for framing and prefixes.
 */
export const JOURNAL_PERSIST_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024 - 64 * 1024,
  maxQuads: 1_000_000 - 64,
});
/** Fixed document cost (type, history id, page token, prefixes) and per-member framing. */
const BASE_BYTES = 8 * 1024;
const BASE_QUADS = 3;
const MEMBER_FRAMING_BYTES = 16;

export class FullSyncJournal {
  pageToken?: string;
  readonly seen = new Set<string>();
  readonly completed = new Set<string>();
  private readonly retained = new Set<string>();
  private seenBytes = 0;
  /** Upper bound on the serialised Turtle size: absolute member IRIs in both sets. */
  private persistedBytes = BASE_BYTES;
  /**
   * Set once the journal outgrows what the reader accepts. Nothing more is written; an
   * earlier saved journal (a consistent checkpoint) stays, otherwise the sync is not resumable.
   */
  private frozen = false;
  private stored: boolean;
  private constructor(
    readonly historyId: string,
    private readonly ctx: ImportContext,
    private readonly slug: string,
    /** Extra characters an account-relative member gains when resolved to an absolute IRI. */
    private readonly absoluteDelta: number,
    private readonly limits: { readonly maxBytes: number; readonly maxQuads: number },
    stored: boolean,
  ) {
    this.stored = stored;
  }

  static async load(
    ctx: ImportContext,
    accountRoot: string,
    historyId: string,
    limits: { readonly maxBytes: number; readonly maxQuads: number } = JOURNAL_PERSIST_LIMITS,
  ): Promise<FullSyncJournal> {
    const slug = `${accountRoot}_full-sync.ttl`;
    const stored = await ctx.read(slug);
    const state = new FullSyncState(`${ctx.resolve(slug)}#it`, stored ?? new Store(), DataFactory);
    const journal = new FullSyncJournal(
      state.identifier ?? historyId,
      ctx,
      slug,
      new TextEncoder().encode(ctx.resolve(accountRoot)).byteLength - accountRoot.length,
      limits,
      stored !== undefined,
    );
    if (state.pageToken !== undefined && state.pageToken.length > 4096)
      throw new TypeError("Invalid Gmail full-sync journal.");
    journal.pageToken = state.pageToken;
    const base = ctx.resolve(accountRoot);
    for (const [source, target] of [
      [state.seen, journal.seen],
      [state.completed, journal.completed],
    ] as const) {
      for (const iri of source) {
        if (!iri.startsWith(base)) throw new TypeError("Invalid Gmail full-sync journal member.");
        const member = `${accountRoot}${iri.slice(base.length)}`;
        journal.retain(member);
        journal.add(target, member);
      }
    }
    return journal;
  }

  remember(iri: string): void {
    this.retain(iri);
    this.add(this.seen, iri);
  }

  complete(iri: string): void {
    this.retain(iri);
    this.add(this.completed, iri);
  }

  /** Upper bound on the next save's Turtle size, in bytes. */
  get persistedSize(): number {
    return this.persistedBytes;
  }

  /** Whether later saves still write: false once the journal outgrew the reader's limits. */
  get persistable(): boolean {
    return !this.frozen;
  }

  /** Restart reconciliation while retaining completed work for cheap token-expiry retries. */
  restart(): void {
    this.pageToken = undefined;
    for (const iri of this.seen) this.persistedBytes -= this.memberBytes(iri);
    this.seen.clear();
  }

  private memberBytes(iri: string): number {
    return new TextEncoder().encode(iri).byteLength + this.absoluteDelta + MEMBER_FRAMING_BYTES;
  }

  private add(target: Set<string>, iri: string): void {
    if (target.has(iri)) return;
    target.add(iri);
    this.persistedBytes += this.memberBytes(iri);
    if (
      this.persistedBytes > this.limits.maxBytes ||
      BASE_QUADS + this.seen.size + this.completed.size > this.limits.maxQuads
    )
      this.frozen = true;
  }

  private retain(iri: string): void {
    if (this.retained.has(iri)) return;
    const bytes = new TextEncoder().encode(iri).byteLength;
    // Bound reconciliation memory across repeated capped runs as well as within one run.
    if (this.retained.size >= DEFAULT_RUN_LIMITS.maxItems)
      throw new RunBudgetExceededError("gmail", "items", DEFAULT_RUN_LIMITS.maxItems);
    if (bytes > 16 * 1024 * 1024 - this.seenBytes)
      throw new RunBudgetExceededError("gmail", "bytes", 16 * 1024 * 1024);
    this.retained.add(iri);
    this.seenBytes += bytes;
  }

  async save(): Promise<void> {
    // Never write a document the reader would refuse: that would block every later resume.
    if (this.frozen) return;
    const dataset = new Store();
    const state = new FullSyncState(`${this.ctx.resolve(this.slug)}#it`, dataset, DataFactory);
    state.types.add(CLASSES.Dataset);
    state.identifier = this.historyId;
    state.pageToken = this.pageToken;
    for (const iri of this.seen) state.seen.add(this.ctx.resolve(iri));
    for (const iri of this.completed) state.completed.add(this.ctx.resolve(iri));
    // load() retained the conditional write precondition.
    await this.ctx.write({
      slug: this.slug,
      category: "mail",
      forClass: CLASSES.Dataset,
      dataset,
      skipRegistration: true,
    });
    this.stored = true;
  }

  async clear(): Promise<void> {
    if (!this.stored) return;
    await this.ctx.remove(this.slug);
    this.stored = false;
  }
}
