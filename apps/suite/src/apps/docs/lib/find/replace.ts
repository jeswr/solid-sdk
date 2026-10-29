// AUTHORED-BY Codex GPT-6.1-Sol
import { runs, search, snapshot } from "./find";
import {
  type DocumentNode,
  FindError,
  type FindMatch,
  type FindOptions,
  type ReplaceResult,
} from "./types";

function restore(input: unknown, expected: string, target: string): DocumentNode {
  if (JSON.stringify(snapshot(input)) !== expected) {
    throw new FindError("stale-document", "Change set requires its exact document snapshot");
  }
  return JSON.parse(target) as DocumentNode;
}

function replace(
  document: unknown,
  query: string,
  replacement: string,
  options: FindOptions,
  index: number | null,
): ReplaceResult {
  const before = snapshot(document);
  const matches = search(before, query, options);
  if (
    typeof replacement !== "string" ||
    !replacement.isWellFormed() ||
    replacement.length > 1_000_000
  ) {
    throw new FindError("invalid-replacement", "Expected bounded, well-formed replacement text");
  }
  if (index !== null && index >= matches.length) {
    throw new FindError("invalid-match-index", "Match index is outside the search results");
  }
  const selected = index === null ? matches : [matches[index] as FindMatch];
  if (replacement.length * selected.length > 1_000_000) {
    throw new FindError("invalid-replacement", "Replacement output exceeds document limits");
  }
  const edits = new Map<DocumentNode, DocumentNode[]>();
  let cursor = 0;
  for (const run of runs(before)) {
    for (const segment of run.segments) {
      const pieces: DocumentNode[] = [];
      const text = segment.node.text as string;
      let offset = 0;
      while (cursor < selected.length) {
        const match = selected[cursor] as FindMatch;
        if (match.from >= segment.to) break;
        const start = Math.max(0, match.from - segment.from);
        if (start > offset) pieces.push({ ...segment.node, text: text.slice(offset, start) });
        if (match.from >= segment.from && replacement.length > 0) {
          pieces.push({ ...segment.node, text: replacement });
        }
        offset = Math.min(text.length, match.to - segment.from);
        if (match.to > segment.to) break;
        cursor++;
      }
      if (offset < text.length) pieces.push({ ...segment.node, text: text.slice(offset) });
      edits.set(segment.node, pieces);
    }
  }
  function apply(node: DocumentNode): DocumentNode[] {
    const edit = edits.get(node);
    if (edit) return edit;
    return [{ ...node, ...(node.content ? { content: node.content.flatMap(apply) } : {}) }];
  }
  const after = snapshot(apply(before)[0]);
  const oldJson = JSON.stringify(before);
  const newJson = JSON.stringify(after);
  return {
    document: after,
    changeSet: {
      matches: selected,
      apply: (input) => restore(input, oldJson, newJson),
      undo: (input) => restore(input, newJson, oldJson),
    },
  };
}

/** Replace the indexed result from a fresh search; indices are zero-based. */
export function replaceOne(
  document: unknown,
  query: string,
  replacement: string,
  matchIndex = 0,
  options: FindOptions = {},
): ReplaceResult {
  if (!Number.isSafeInteger(matchIndex) || matchIndex < 0) {
    throw new FindError("invalid-match-index", "Expected a nonnegative integer match index");
  }
  return replace(document, query, replacement, options, matchIndex);
}

/** One atomic, undoable operation over the original non-overlapping matches. */
export function replaceAll(
  document: unknown,
  query: string,
  replacement: string,
  options: FindOptions = {},
): ReplaceResult {
  return replace(document, query, replacement, options, null);
}
