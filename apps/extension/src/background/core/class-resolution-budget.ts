// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** One request-wide deadline and limits, including discovery, body reads and RDF parsing. */
import { parseRdfSync, RdfFetchError } from '@jeswr/fetch-rdf';
import type { Store } from 'n3';
import { BUFFERED_RDF_LIMITS } from './rdf-limits';

export const RESOLUTION_LIMITS = {
  documents: 128,
  milliseconds: 10_000,
  redirects: 3,
  bytes: 1024 * 1024,
  quads: 50_000,
} as const;

export class ResolutionBudget {
  private readonly controller = new AbortController();
  private readonly deadline = Date.now() + RESOLUTION_LIMITS.milliseconds;
  private readonly timer: ReturnType<typeof setTimeout>;
  private documents = 0;
  private limited = false;
  private readonly saiDocuments = new Map<string, Set<string>>();
  private readonly parsed = new Map<string, { text: string; store: Store }>();
  private readonly cancel = () => this.controller.abort();

  constructor(private readonly parent?: AbortSignal) {
    this.timer = setTimeout(() => this.exhaust(), RESOLUTION_LIMITS.milliseconds);
    parent?.addEventListener('abort', this.cancel, { once: true });
    if (parent?.aborted) this.cancel();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get truncated(): boolean {
    this.active();
    return this.limited;
  }

  active(): boolean {
    if (!this.signal.aborted && Date.now() >= this.deadline) this.exhaust();
    return !this.signal.aborted;
  }

  exhaust(): void {
    this.limited = true;
    this.controller.abort();
  }

  document(): boolean {
    if (!this.active()) return false;
    if (this.documents >= RESOLUTION_LIMITS.documents) {
      this.exhaust();
      return false;
    }
    this.documents++;
    return true;
  }

  /** SAI keeps its tighter caps; they too span all requested classes. */
  saiDocument(kind: string, url: string, limit: number): boolean {
    if (!this.active()) return false;
    const documents = this.saiDocuments.get(kind) ?? new Set<string>();
    if (documents.has(url)) return true;
    if (documents.size >= limit) return false;
    documents.add(url);
    this.saiDocuments.set(kind, documents);
    return true;
  }

  /** Race even transports/streams that ignore cancellation; fence their late completions. */
  async run<T>(task: () => Promise<T>, signal = this.signal): Promise<T> {
    signal = signal === this.signal ? signal : AbortSignal.any([this.signal, signal]);
    if (!this.active()) this.signal.throwIfAborted();
    signal.throwIfAborted();
    let cancel = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
    });
    try {
      const result = await Promise.race([aborted, task()]);
      if (!this.active()) this.signal.throwIfAborted();
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  /** Reject a whole document, never expose a partially read/parsed document. */
  checkText(text: string): void {
    if (new TextEncoder().encode(text).byteLength > RESOLUTION_LIMITS.bytes) this.exhaust();
    if (!this.active()) this.signal.throwIfAborted();
  }

  parse(url: string, text: string): Store {
    this.checkText(text);
    const key = url.split('#')[0];
    const cached = this.parsed.get(key);
    if (cached?.text === text) return cached.store;
    let store: Store;
    try {
      store = parseRdfSync(text, {
        ...BUFFERED_RDF_LIMITS,
        baseIRI: key,
        signal: this.signal,
        maxBytes: RESOLUTION_LIMITS.bytes,
        maxQuads: RESOLUTION_LIMITS.quads,
        check: () => {
          if (!this.active()) this.signal.throwIfAborted();
        },
      });
    } catch (error) {
      if (error instanceof RdfFetchError && error.code === 'PARSE_LIMIT') {
        this.exhaust();
        this.signal.throwIfAborted();
      }
      throw error;
    }
    if (!this.active()) this.signal.throwIfAborted();
    this.parsed.set(key, { text, store });
    return store;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.parent?.removeEventListener('abort', this.cancel);
    this.cancel();
  }
}
