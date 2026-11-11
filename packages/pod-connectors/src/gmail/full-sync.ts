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

export class FullSyncJournal {
  pageToken?: string;
  readonly seen = new Set<string>();
  readonly completed = new Set<string>();
  private readonly retained = new Set<string>();
  private seenBytes = 0;
  private constructor(
    readonly historyId: string,
    private readonly ctx: ImportContext,
    private readonly slug: string,
  ) {}

  static async load(
    ctx: ImportContext,
    accountRoot: string,
    historyId: string,
  ): Promise<FullSyncJournal> {
    const slug = `${accountRoot}_full-sync.ttl`;
    const stored = await ctx.read(slug);
    const state = new FullSyncState(`${ctx.resolve(slug)}#it`, stored ?? new Store(), DataFactory);
    const journal = new FullSyncJournal(state.identifier ?? historyId, ctx, slug);
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
        target.add(member);
      }
    }
    return journal;
  }

  remember(iri: string): void {
    this.retain(iri);
    this.seen.add(iri);
  }

  complete(iri: string): void {
    this.retain(iri);
    this.completed.add(iri);
  }

  /** Restart reconciliation while retaining completed work for cheap token-expiry retries. */
  restart(): void {
    this.pageToken = undefined;
    this.seen.clear();
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
  }

  async clear(): Promise<void> {
    await this.ctx.remove(this.slug);
  }
}
