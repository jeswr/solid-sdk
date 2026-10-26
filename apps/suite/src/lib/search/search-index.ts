// AUTHORED-BY Codex GPT-6.1-Sol
import { createSnippet, type SearchSnippet } from "./snippet";
import { queryTerms, SearchIndexError, tokenize, validateText } from "./text";

export interface SearchDocument {
  id: string;
  title: string;
  body: string;
}

export interface SearchHit {
  document: SearchDocument;
  score: number;
  snippet: SearchSnippet;
}

type IndexedDocument = {
  document: SearchDocument;
  length: number;
  frequencies: Map<string, number>;
};

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return (
        property !== undefined && property.enumerable === true && Object.hasOwn(property, "value")
      );
    })
  );
}

function validateId(id: unknown): asserts id is string {
  validateText(id);
  if (id.length === 0) throw new SearchIndexError("invalid-input", "Document id must not be empty");
}

function prepare(document: SearchDocument): IndexedDocument {
  if (!record(document, ["id", "title", "body"])) {
    throw new SearchIndexError("invalid-input", "Expected exactly id, title and body");
  }
  validateId(document.id);
  const title = tokenize(document.title);
  const body = tokenize(document.body);
  const frequencies = new Map<string, number>();
  for (const [tokens, weight] of [
    [title, 3],
    [body, 1],
  ] as const) {
    for (const { term } of tokens) frequencies.set(term, (frequencies.get(term) ?? 0) + weight);
  }
  return {
    document: { ...document },
    length: title.length + body.length,
    frequencies,
  };
}

/**
 * Local plain-text index. Use one instance per account; callers own cache population,
 * permissions and persistence. add/update are strict and atomic; remove is idempotent.
 * Search uses AND, final-term prefix matching, title/body weights 3/1, BM25 k1=1.2,
 * b=0.75 and positive log1p IDF. Length is the unweighted word count. Prefix expansions
 * form one term group (combined tf, union df). Equal scores sort by opaque id (UTF-16).
 */
export class SearchIndex {
  readonly #documents = new Map<string, IndexedDocument>();
  readonly #postings = new Map<string, Map<string, number>>();
  #totalLength = 0;

  get size(): number {
    return this.#documents.size;
  }

  add(document: SearchDocument): void {
    const prepared = prepare(document);
    if (this.#documents.has(document.id)) {
      throw new SearchIndexError("duplicate-id", "Document already exists");
    }
    this.#insert(prepared);
  }

  update(document: SearchDocument): void {
    const prepared = prepare(document);
    if (!this.#documents.has(document.id)) {
      throw new SearchIndexError("not-found", "Document does not exist");
    }
    this.remove(document.id);
    this.#insert(prepared);
  }

  #insert(indexed: IndexedDocument): void {
    const id = indexed.document.id;
    this.#documents.set(id, indexed);
    this.#totalLength += indexed.length;
    for (const [term, frequency] of indexed.frequencies) {
      let posting = this.#postings.get(term);
      if (!posting) {
        posting = new Map();
        this.#postings.set(term, posting);
      }
      posting.set(id, frequency);
    }
  }

  remove(id: string): boolean {
    validateId(id);
    const indexed = this.#documents.get(id);
    if (!indexed) return false;
    for (const term of indexed.frequencies.keys()) {
      const posting = this.#postings.get(term) as Map<string, number>;
      posting.delete(id);
      if (posting.size === 0) this.#postings.delete(term);
    }
    this.#totalLength -= indexed.length;
    this.#documents.delete(id);
    return true;
  }

  search(query: string): SearchHit[] {
    const terms = queryTerms(query);
    if (terms.length === 0 || this.size === 0) return [];
    const groups = terms.map((queryTerm, index) => {
      const group = new Map<string, number>();
      for (const [term, posting] of this.#postings) {
        if (index === terms.length - 1 ? term.startsWith(queryTerm) : term === queryTerm) {
          for (const [id, frequency] of posting) {
            group.set(id, (group.get(id) ?? 0) + frequency);
          }
        }
      }
      return group;
    });
    const hits: SearchHit[] = [];
    const first = groups[0] as Map<string, number>;
    for (const id of first.keys()) {
      if (!groups.every((group) => group.has(id))) continue;
      const indexed = this.#documents.get(id) as IndexedDocument;
      let score = 0;
      for (const group of groups) {
        const tf = group.get(id) as number;
        const idf = Math.log1p((this.size - group.size + 0.5) / (group.size + 0.5));
        const norm = 1.2 * (0.25 + 0.75 * (indexed.length / (this.#totalLength / this.size)));
        score += (idf * tf * 2.2) / (tf + norm);
      }
      hits.push({
        document: { ...indexed.document },
        score,
        snippet: createSnippet(indexed.document.body || indexed.document.title, query),
      });
    }
    return hits.sort((a, b) => b.score - a.score || (a.document.id < b.document.id ? -1 : 1));
  }

  /** Versioned JSON source data, with no trusted derived postings or statistics. */
  serialize(): string {
    return JSON.stringify({
      version: 1,
      documents: [...this.#documents.values()].map(({ document }) => document),
    });
  }

  static restore(json: string): SearchIndex {
    try {
      validateText(json);
      const value: unknown = JSON.parse(json);
      if (
        !record(value, ["version", "documents"]) ||
        value.version !== 1 ||
        !Array.isArray(value.documents)
      ) {
        throw new SearchIndexError("invalid-snapshot", "Unsupported search snapshot");
      }
      const index = new SearchIndex();
      for (const document of value.documents) index.add(document);
      return index;
    } catch {
      throw new SearchIndexError("invalid-snapshot", "Invalid search snapshot");
    }
  }
}
