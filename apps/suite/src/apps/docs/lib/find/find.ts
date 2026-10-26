// AUTHORED-BY Codex GPT-6.1-Sol
import { readDocument } from "../outline/validation";
import { type Budget, compile, FIND_LIMITS, matchAt, spend } from "./pattern";
import { type DocumentNode, FindError, type FindMatch, type FindOptions } from "./types";

export interface Segment {
  node: DocumentNode;
  from: number;
  to: number;
}
export interface Run {
  text: string;
  from: number;
  segments: Segment[];
}

export function snapshot(input: unknown): DocumentNode {
  try {
    readDocument(input);
    return JSON.parse(JSON.stringify(input)) as DocumentNode;
  } catch {
    throw new FindError("invalid-document", "Expected supported, bounded ProseMirror JSON");
  }
}

function options(input: FindOptions): Required<FindOptions> {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error();
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) throw new Error();
    for (const key of Reflect.ownKeys(input)) {
      if (!["caseSensitive", "wholeWord", "regex", "stepBudget"].includes(key as string))
        throw new Error();
      const descriptor = Object.getOwnPropertyDescriptor(input, key) as PropertyDescriptor;
      if (!("value" in descriptor) || !descriptor.enumerable) throw new Error();
      if (key === "stepBudget") {
        if (
          !Number.isSafeInteger(descriptor.value) ||
          descriptor.value < 1 ||
          descriptor.value > FIND_LIMITS.maxSteps
        )
          throw new Error();
      } else if (typeof descriptor.value !== "boolean") throw new Error();
    }
    return {
      caseSensitive: input.caseSensitive ?? false,
      wholeWord: input.wholeWord ?? false,
      regex: input.regex ?? false,
      stepBudget: input.stepBudget ?? FIND_LIMITS.steps,
    };
  } catch {
    throw new FindError(
      "invalid-options",
      "Expected supported find options and a bounded positive step budget",
    );
  }
}

/** Build editable runs without inventing searchable characters for structure. */
export function runs(document: DocumentNode): Run[] {
  const result: Run[] = [];
  let current: Run | undefined;
  let position = 0;
  function visit(node: DocumentNode): void {
    if (node.type === "text") {
      const text = node.text as string;
      if (!current) {
        current = { text: "", from: position, segments: [] };
        result.push(current);
      }
      current.text += text;
      current.segments.push({ node, from: position, to: position + text.length });
      position += text.length;
    } else {
      current = undefined;
      if (["hardBreak", "image", "horizontalRule"].includes(node.type)) position++;
      else {
        if (node.type !== "doc") position++;
        for (const child of node.content ?? []) visit(child);
        if (node.type !== "doc") position++;
      }
      current = undefined;
    }
  }
  visit(document);
  return result;
}

function word(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{M}\p{N}\p{Pc}]/u.test(char);
}

export function search(document: DocumentNode, query: string, input: FindOptions): FindMatch[] {
  const opts = options(input);
  if (typeof query !== "string" || query.length > FIND_LIMITS.query || !query.isWellFormed()) {
    throw new FindError(
      "invalid-query",
      "Expected a well-formed query of at most 512 UTF-16 units",
    );
  }
  if (query.length === 0 && !opts.regex) return [];
  const pattern = compile(query, opts.regex, opts.caseSensitive);
  const budget: Budget = { remaining: opts.stepBudget };
  const result: FindMatch[] = [];
  for (const run of runs(document)) {
    const chars = Array.from(run.text);
    const offsets = [0];
    for (const char of chars) offsets.push((offsets.at(-1) as number) + char.length);
    for (let start = 0; start < chars.length; ) {
      spend(budget);
      const end = matchAt(pattern, chars, start, budget);
      if (end !== null && (!opts.wholeWord || (!word(chars[start - 1]) && !word(chars[end])))) {
        const from = offsets[start] as number;
        const to = offsets[end] as number;
        result.push({ from: run.from + from, to: run.from + to, text: run.text.slice(from, to) });
        start = end;
      } else start++;
      if (pattern.start) break;
    }
  }
  return result;
}

/** Non-overlapping matches in document order; validates even an empty query/document. */
export function findText(document: unknown, query: string, options: FindOptions = {}): FindMatch[] {
  return search(snapshot(document), query, options);
}
