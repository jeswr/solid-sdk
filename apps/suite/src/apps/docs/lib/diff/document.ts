// AUTHORED-BY Codex GPT-6.1-Sol
import { myers, spend, type WorkBudget } from "./myers";
import type { BlockChange, DocumentMark, DocumentNode, MarkChange, TextChange } from "./types";

/** Per document; all limits are fixed so untrusted callers cannot disable them. */
export const DIFF_LIMITS = Object.freeze({
  nodes: 10_000,
  text: 100_000,
  depth: 64,
  json: 1_000_000,
  work: 1_000_000,
});

// Validate raw JSON before any normalization, recursive serialization or diff allocation.
function validateJson(value: unknown, budget: { remaining: number }, depth = 0): void {
  if (depth > DIFF_LIMITS.depth || --budget.remaining < 0)
    throw new RangeError("Document JSON limit exceeded");
  if (typeof value === "string") {
    budget.remaining -= value.length;
    if (budget.remaining < 0) throw new RangeError("Document JSON limit exceeded");
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Expected finite JSON number");
  } else if (value !== null && typeof value !== "boolean") {
    if (typeof value !== "object") throw new TypeError("Expected JSON value");
    if (Array.isArray(value)) {
      if (value.length > budget.remaining) throw new RangeError("Document JSON limit exceeded");
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) throw new TypeError("Expected dense JSON array");
        budget.remaining -= String(i).length;
        validateJson(value[i], budget, depth + 1);
      }
      return;
    }
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new TypeError("Expected plain JSON object");
    }
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      budget.remaining -= key.length;
      if (budget.remaining < 0) throw new RangeError("Document JSON limit exceeded");
      validateJson((value as Record<string, unknown>)[key], budget, depth + 1);
    }
  }
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function normalize(node: DocumentNode, count: { nodes: number; text: number }): DocumentNode {
  if (!node || typeof node.type !== "string" || !node.type)
    throw new TypeError("Expected node type");
  if (++count.nodes > DIFF_LIMITS.nodes) throw new RangeError("Document node limit exceeded");
  const attrs = node.attrs ?? {};
  if (typeof attrs !== "object" || Array.isArray(attrs))
    throw new TypeError("Expected node attributes");
  const marks = (node.marks ?? [])
    .map((mark) => {
      if (!mark || typeof mark.type !== "string" || !mark.type)
        throw new TypeError("Expected mark type");
      const markAttrs = mark.attrs ?? {};
      if (typeof markAttrs !== "object" || Array.isArray(markAttrs))
        throw new TypeError("Expected mark attributes");
      return { type: mark.type, attrs: markAttrs };
    })
    .sort((a, b) => stable(a).localeCompare(stable(b)));
  if (node.type === "text") {
    if (typeof node.text !== "string" || !node.text || node.content !== undefined)
      throw new TypeError("Expected nonempty text leaf");
    count.text += node.text.length;
    if (count.text > DIFF_LIMITS.text) throw new RangeError("Document text limit exceeded");
    return { type: node.type, attrs, marks, text: node.text };
  }
  if (node.text !== undefined) throw new TypeError("Only text nodes may contain text");
  const content: DocumentNode[] = [];
  for (const child of node.content ?? []) {
    const normalized = normalize(child, count);
    const previous = content.at(-1);
    if (
      previous?.type === "text" &&
      normalized.type === "text" &&
      stable(previous.marks) === stable(normalized.marks) &&
      stable(previous.attrs) === stable(normalized.attrs)
    ) {
      content[content.length - 1] = {
        ...previous,
        text: previous.text + (normalized.text as string),
      };
    } else content.push(normalized);
  }
  return { type: node.type, attrs, marks, content };
}

interface Token {
  key: string;
  from: number;
  to: number;
  text: string;
  marks: readonly DocumentMark[];
  markSignatures: readonly string[];
  markKey: number;
}
function tokens(block: DocumentNode, markKeys: Map<string, number>): Token[] {
  const result: Token[] = [];
  let position = 0;
  function visit(node: DocumentNode): void {
    if (node.type === "text") {
      const markSignatures = (node.marks as readonly DocumentMark[]).map((mark) => stable(mark));
      const signature = `[${markSignatures.join(",")}]`;
      let markKey = markKeys.get(signature);
      if (markKey === undefined) {
        markKey = markKeys.size;
        markKeys.set(signature, markKey);
      }
      for (const text of node.text as string) {
        result.push({
          key: `text:${text}`,
          text,
          from: position,
          to: position + text.length,
          marks: node.marks as readonly DocumentMark[],
          markSignatures,
          markKey,
        });
        position += text.length;
      }
    } else if (["image", "hardBreak", "horizontalRule"].includes(node.type)) {
      result.push({
        key: `atom:${stable(node)}`,
        text: "",
        from: position,
        to: ++position,
        marks: [],
        markSignatures: [],
        markKey: -1,
      });
    } else {
      result.push({
        key: "open",
        text: "",
        from: position,
        to: ++position,
        marks: [],
        markSignatures: [],
        markKey: -1,
      });
      for (const child of node.content as readonly DocumentNode[]) visit(child);
      result.push({
        key: "close",
        text: "",
        from: position,
        to: ++position,
        marks: [],
        markSignatures: [],
        markKey: -1,
      });
    }
  }
  visit(block);
  return result;
}

function inlineDiff(
  before: DocumentNode,
  after: DocumentNode,
  budget: WorkBudget,
): (TextChange | MarkChange)[] {
  // Intern mark sets once per run, so long mark attributes are not compared per character.
  const markKeys = new Map<string, number>();
  const left = tokens(before, markKeys),
    right = tokens(after, markKeys);
  const changes: (TextChange | MarkChange)[] = [];
  let x = 0,
    y = 0;
  let lastBeforeMarks = -1,
    lastAfterMarks = -1;
  for (const edit of myers(
    left.map((t) => t.key),
    right.map((t) => t.key),
    budget,
  )) {
    const old = left[x],
      next = right[y];
    if (edit === "equal") {
      const a = old as Token,
        b = next as Token;
      if (a.text && a.markKey !== b.markKey) {
        const previous = changes.at(-1);
        if (
          previous?.kind === "marks" &&
          previous.before.to === a.from &&
          previous.after.to === b.from &&
          lastBeforeMarks === a.markKey &&
          lastAfterMarks === b.markKey
        ) {
          previous.before.to = a.to;
          previous.after.to = b.to;
        } else {
          // Charge string hashing/comparison before building sets or scanning the marks.
          spend(
            budget,
            a.markSignatures.reduce((cost, key) => cost + key.length, 0) +
              b.markSignatures.reduce((cost, key) => cost + key.length, 0),
          );
          const oldKeys = new Set(a.markSignatures);
          const newKeys = new Set(b.markSignatures);
          changes.push({
            kind: "marks",
            before: { from: a.from, to: a.to },
            after: { from: b.from, to: b.to },
            removed: a.marks.filter((_, i) => !newKeys.has(a.markSignatures[i] as string)),
            added: b.marks.filter((_, i) => !oldKeys.has(b.markSignatures[i] as string)),
          });
        }
        lastBeforeMarks = a.markKey;
        lastAfterMarks = b.markKey;
      }
      x++;
      y++;
    } else {
      const inserted = edit === "insert";
      const token = (inserted ? next : old) as Token;
      const oldPosition = old?.from ?? (left.at(-1) as Token).to;
      const newPosition = next?.from ?? (right.at(-1) as Token).to;
      if (token.text) {
        const kind = inserted ? "inserted" : "deleted";
        const previous = changes.at(-1);
        const beforeRange = { from: oldPosition, to: inserted ? oldPosition : token.to };
        const afterRange = { from: newPosition, to: inserted ? token.to : newPosition };
        if (
          previous?.kind === kind &&
          previous.before.to === beforeRange.from &&
          previous.after.to === afterRange.from
        ) {
          previous.before.to = beforeRange.to;
          previous.after.to = afterRange.to;
          previous.text += token.text;
        } else changes.push({ kind, before: beforeRange, after: afterRange, text: token.text });
      }
      if (inserted) y++;
      else x++;
    }
  }
  return changes;
}

/**
 * Top-level blocks are aligned by normalized JSON with Myers; unmatched runs pair in order
 * as modifications after reserving exact unmatched counterparts across all runs as moves.
 * Moves are deletion + insertion. Nested changes
 * belong to their outer block. Snapshots are normalized JSON, including structural/attr edits.
 * Inline ranges use UTF-16 PM positions relative to that block, excluding surrogate splits.
 * Standard image/hardBreak/horizontalRule nodes are atoms; other nodes are containers.
 * Returns only changes, never mutates inputs. TypeError = invalid JSON/node; RangeError = bound.
 */
export function diffDocuments(before: DocumentNode, after: DocumentNode): BlockChange[] {
  const documents = [before, after].map((doc) => {
    validateJson(doc, { remaining: DIFF_LIMITS.json });
    if (doc?.type !== "doc") throw new TypeError("Expected doc root");
    return normalize(doc, { nodes: 0, text: 0 });
  });
  const left = documents[0]?.content as readonly DocumentNode[],
    right = documents[1]?.content as readonly DocumentNode[];
  const budget = { remaining: DIFF_LIMITS.work };
  const leftKeys = left.map((n) => stable(n)),
    rightKeys = right.map((n) => stable(n));
  const edits = myers(leftKeys, rightKeys, budget);
  const unmatched = new Map<string, { before: number[]; after: number[] }>();
  let beforeIndex = 0,
    afterIndex = 0;
  for (const edit of edits) {
    if (edit === "equal") {
      beforeIndex++;
      afterIndex++;
    } else {
      const key = (edit === "delete" ? leftKeys[beforeIndex] : rightKeys[afterIndex]) as string;
      const matches = unmatched.get(key) ?? { before: [], after: [] };
      if (edit === "delete") matches.before.push(beforeIndex++);
      else matches.after.push(afterIndex++);
      unmatched.set(key, matches);
    }
  }
  const movedBefore = new Set<number>(),
    movedAfter = new Set<number>();
  for (const matches of unmatched.values()) {
    for (let i = 0; i < Math.min(matches.before.length, matches.after.length); i++) {
      movedBefore.add(matches.before[i] as number);
      movedAfter.add(matches.after[i] as number);
    }
  }
  const changes: BlockChange[] = [];
  let x = 0,
    y = 0,
    deleted: number[] = [],
    inserted: number[] = [];
  function flush(): void {
    let i = 0,
      j = 0;
    while (i < deleted.length || j < inserted.length) {
      const a = deleted[i],
        b = inserted[j];
      if (a !== undefined && movedBefore.has(a)) {
        changes.push({ kind: "deleted", beforeIndex: a, before: left[a] as DocumentNode });
        i++;
      } else if (b !== undefined && movedAfter.has(b)) {
        changes.push({ kind: "inserted", afterIndex: b, after: right[b] as DocumentNode });
        j++;
      } else if (a !== undefined && b !== undefined) {
        const old = left[a] as DocumentNode,
          next = right[b] as DocumentNode;
        changes.push({
          kind: "modified",
          beforeIndex: a,
          afterIndex: b,
          before: old,
          after: next,
          inline: inlineDiff(old, next, budget),
        });
        i++;
        j++;
      } else if (a !== undefined) {
        changes.push({ kind: "deleted", beforeIndex: a, before: left[a] as DocumentNode });
        i++;
      } else {
        changes.push({
          kind: "inserted",
          afterIndex: b as number,
          after: right[b as number] as DocumentNode,
        });
        j++;
      }
    }
    deleted = [];
    inserted = [];
  }
  for (const edit of edits) {
    if (edit === "equal") {
      flush();
      x++;
      y++;
    } else if (edit === "delete") deleted.push(x++);
    else inserted.push(y++);
  }
  flush();
  return changes;
}
