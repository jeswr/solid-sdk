// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const DEFAULT_CLASS_READS = 100_000;
const MAX_CLASS_READS = 1_000_000;

declare const parseScopeBrand: unique symbol;

/** Read-only scan state, valid only while its original dataset remains unchanged. */
export interface ParseScope {
  readonly [parseScopeBrand]: true;
  /** Once exhausted, every subsequent class-membership check fails closed. */
  readonly exhausted: boolean;
}

export interface ParseScopeOptions {
  /** Shared raw type/subclass read budget: integer 0–1,000,000; default 100,000. */
  readonly maxClassReads?: number;
}

/** Options for parsing an existing, unchanged dataset. Writes never consult a scope. */
export interface ParseOptions {
  readonly scope?: ParseScope;
}

interface ScopeState {
  readonly dataset: DatasetCore;
  /** Dataset size at creation: a cheap tripwire for callers that mutate and keep the scope. */
  readonly size: number;
  readonly maxClassReads: number;
  reads: number;
  exhausted: boolean;
  /** Required-class SET → (class term → membership). Never memoise subject projections. */
  readonly memo: Map<string, Map<string, boolean>>;
}

const states = new WeakMap<ParseScope, ScopeState>();

/**
 * Share class traversal and one budget across parses of ONE unchanged dataset.
 * Discard the scope after any dataset mutation, including writes through a Wrapper
 * (a size change is detected and throws; same-size edits are the caller's contract).
 *
 * Unlike an unscoped parse, whose class check stops at 10,000 reads per call, a scoped
 * check may use the whole shared budget, so a subclass chain deeper than 10,000 links can
 * be recognised under a scope but not without one. Write-time migration audits only the
 * unscoped projection.
 */
export function createParseScope(
  dataset: DatasetCore,
  options: ParseScopeOptions = {},
): ParseScope {
  const maxClassReads =
    options.maxClassReads === undefined ? DEFAULT_CLASS_READS : options.maxClassReads;
  if (!Number.isSafeInteger(maxClassReads) || maxClassReads < 0 || maxClassReads > MAX_CLASS_READS)
    throw new RangeError("maxClassReads must be an integer between 0 and 1,000,000");
  const state: ScopeState = {
    dataset,
    size: dataset.size,
    maxClassReads,
    reads: 0,
    exhausted: false,
    memo: new Map(),
  };
  const scope: ParseScope = Object.freeze({
    get exhausted() {
      return state.exhausted;
    },
  }) as ParseScope;
  states.set(scope, state);
  return scope;
}

/** Internal: reject forged scopes and cross-dataset reuse before beginning a parse. */
export function checkParseScope(scope: ParseScope, dataset: DatasetCore): void {
  const state = states.get(scope);
  if (!state) throw new TypeError("scope must be created by createParseScope");
  if (state.dataset !== dataset) throw new TypeError("parse scope belongs to a different dataset");
  if (dataset.size !== state.size)
    throw new TypeError("parse scope is stale: its dataset changed after the scope was created");
}

/** The caller supplies the runtime's streaming RDF primitive, preserving DatasetCore support. */
export function hasScopedDatasetClass(
  scope: ParseScope,
  dataset: DatasetCore,
  factory: DataFactory,
  subject: string,
  required: readonly string[],
  matchObjects: (dataset: DatasetCore, subject: Term, predicate: Term) => Iterable<Term>,
): boolean {
  checkParseScope(scope, dataset);
  const state = states.get(scope) as ScopeState;
  if (state.exhausted) return false;
  const accepted = new Set(required);
  const requiredKey = JSON.stringify([...accepted].sort());
  let memo = state.memo.get(requiredKey);
  if (!memo) {
    memo = new Map();
    state.memo.set(requiredKey, memo);
  }
  const read = (): boolean => {
    if (state.reads >= state.maxClassReads) {
      state.exhausted = true;
      return false;
    }
    state.reads++;
    return true;
  };
  const key = (term: Term): string => JSON.stringify([term.termType, term.value]);
  const subClassOf = factory.namedNode(RDFS_SUBCLASS);
  const membership = (start: Term): boolean => {
    if (start.termType !== "NamedNode" && start.termType !== "BlankNode") return false;
    const startKey = key(start);
    const cached = memo.get(startKey);
    if (cached !== undefined) return cached;
    const pending: Term[] = [];
    const seen = new Set<string>();
    const enqueue = (term: Term): boolean => {
      if (term.termType !== "NamedNode" && term.termType !== "BlankNode") return false;
      if (term.termType === "NamedNode" && accepted.has(term.value)) return true;
      const termKey = key(term);
      const cached = memo.get(termKey);
      if (cached !== undefined) return cached;
      if (!seen.has(termKey)) {
        seen.add(termKey);
        pending.push(term);
      }
      return false;
    };
    // Start is processed through enqueue too, so direct class assertions need no edge reads.
    if (enqueue(start)) {
      memo.set(startKey, true);
      return true;
    }
    while (pending.length) {
      const type = pending.pop() as Term;
      for (const parent of matchObjects(dataset, type, subClassOf)) {
        if (!read()) return false;
        if (enqueue(parent)) {
          // Only the start is proved: other visited branches may not reach the target.
          memo.set(startKey, true);
          return true;
        }
      }
    }
    // A complete negative walk proves every visited class negative, including cycles.
    for (const termKey of seen) memo.set(termKey, false);
    return false;
  };
  for (const type of matchObjects(
    dataset,
    factory.namedNode(subject),
    factory.namedNode(RDF_TYPE),
  )) {
    if (!read()) return false;
    if (membership(type)) return true;
    if (state.exhausted) return false;
  }
  return false;
}
