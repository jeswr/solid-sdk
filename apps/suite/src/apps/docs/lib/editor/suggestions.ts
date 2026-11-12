// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, type Mark, type MarkType, type Node, Slice } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Mapping, ReplaceStep, type Step, StepMap } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import { ySyncPluginKey, yUndoPluginKey } from "@tiptap/y-tiptap";

export interface SuggestionMode {
  enabled: boolean;
  author: string;
}
export interface Suggestion {
  id: string;
  author: string;
  created: string;
  kind: "suggestionInsert" | "suggestionDelete";
}
export const suggestionKey = new PluginKey<SuggestionMode>("docsSuggestions");
export const suggestionAction = "docsSuggestionAction";
export const suggestionUnsupported = "docs-unsupported-suggestion";
const isSuggestion = (mark: Mark) =>
  mark.type.name === "suggestionInsert" || mark.type.name === "suggestionDelete";

/** Persist selected paragraph edges as well as text. This also represents empty
 * paragraphs and closed slices without inventing visible placeholder text. */
interface BreakSuggestion extends Suggestion {
  edge?: "start" | "end";
}
function breaks(node: Node): BreakSuggestion[] {
  return node.attrs.suggestionBreaks ?? [];
}
function boundaries(doc: Node) {
  const blocks: { node: Node; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) blocks.push({ node, pos });
  });
  return blocks.flatMap(({ node, pos }, i) => {
    const end = pos + node.nodeSize;
    const next = blocks[i + 1];
    return [
      { node, pos, from: pos, to: pos + 1, edge: "start" as const },
      { node, pos, from: end - 1, to: end, edge: "end" as const },
      ...(next ? [{ node, pos, from: end - 1, to: next.pos + 1, edge: undefined }] : []),
    ];
  });
}
function writeBreaks(tr: Transaction, rebuilt: Map<number, BreakSuggestion[]>) {
  // Splits and joins copy attributes. Only retain entries whose original token
  // ranges still identify this block's current edges.
  tr.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const items = rebuilt.get(pos) as BreakSuggestion[];
    const value = items.length ? items : null;
    if (JSON.stringify(node.attrs.suggestionBreaks) !== JSON.stringify(value))
      tr.setNodeAttribute(pos, "suggestionBreaks", value);
  });
}

export function suggestions(doc: Node): Suggestion[] {
  const found = new Map<string, Suggestion>();
  doc.descendants((node) => {
    for (const { edge: _edge, ...item } of breaks(node)) found.set(item.id, item);
    for (const mark of node.marks) {
      if (isSuggestion(mark))
        found.set(mark.attrs.id, { ...mark.attrs, kind: mark.type.name } as Suggestion);
    }
  });
  return [...found.values()];
}

export function suggestionAt(state: EditorState): Suggestion | undefined {
  const { $from } = state.selection;
  const after = $from.nodeAfter?.marks.filter(isSuggestion) ?? [];
  const before = $from.nodeBefore?.marks.filter(isSuggestion) ?? [];
  // The outer insertion remains pending while its newer deletion is reviewed.
  const mark = (after.length ? after : before).at(-1);
  if (mark) return { ...mark.attrs, kind: mark.type.name } as Suggestion;
  const boundary = breaks($from.parent).find((item) =>
    item.edge === "start"
      ? $from.parentOffset === 0
      : $from.parentOffset === $from.parent.content.size,
  );
  if (!boundary) return undefined;
  const { edge: _edge, ...item } = boundary;
  return item;
}

/** A single transaction, shared by inline and bulk actions. Permissions are checked at dispatch too. */
export function resolveSuggestions(state: EditorState, accept: boolean, id?: string): Transaction {
  const tr = state.tr.setMeta(suggestionAction, true);
  const deletions: { from: number; to: number }[] = [];
  const matches = (item: Suggestion) => id === undefined || item.id === id;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const marks = node.marks.filter(
      (mark) => isSuggestion(mark) && matches(mark.attrs as Suggestion),
    );
    if (marks.some((mark) => accept === (mark.type.name === "suggestionDelete")))
      deletions.push({ from: pos, to: pos + node.nodeSize });
    else for (const mark of marks) tr.removeMark(pos, pos + node.nodeSize, mark);
  });
  for (const boundary of boundaries(state.doc))
    if (
      breaks(boundary.node).some(
        (item) =>
          item.edge === boundary.edge &&
          matches(item) &&
          accept === (item.kind === "suggestionDelete"),
      )
    )
      deletions.push(boundary);
  // Joining/deleting paragraph edges and their text is one replacement. Separate
  // token deletions would make the schema fitter insert temporary blank blocks.
  const merged: { from: number; to: number }[] = [];
  for (const range of deletions.sort((a, b) => a.from - b.from)) {
    const previous = merged.at(-1);
    if (previous && previous.to >= range.from) previous.to = Math.max(previous.to, range.to);
    else merged.push({ from: range.from, to: range.to });
  }
  for (const range of merged.reverse()) {
    // Reuse the final closing token when the deletion keeps a textblock prefix.
    // A replacement from inside a paragraph to the document end otherwise asks
    // the schema fitter to supply an additional empty paragraph at depth zero.
    const to =
      range.to === tr.doc.content.size && tr.doc.resolve(range.from).parent.isTextblock
        ? range.to - 1
        : range.to;
    tr.deleteRange(range.from, to);
  }
  const remaining = new Map<string, BreakSuggestion[]>();
  for (const boundary of boundaries(state.doc))
    remaining.set(
      `${boundary.edge}:${tr.mapping.map(boundary.from, 1)}:${tr.mapping.map(boundary.to, 1)}`,
      breaks(boundary.node).filter((item) => item.edge === boundary.edge && !matches(item)),
    );
  const rebuilt = new Map<number, BreakSuggestion[]>();
  for (const boundary of boundaries(tr.doc))
    rebuilt.set(boundary.pos, [
      ...(rebuilt.get(boundary.pos) ?? []),
      ...(remaining.get(`${boundary.edge}:${boundary.from}:${boundary.to}`) ?? []),
    ]);
  writeBreaks(tr, rebuilt);
  return tr;
}

/**
 * Edits outside Suggesting mode (and local edits Suggesting mode does not rewrite) move
 * paragraph edges too. Keep each stored edge on the boundary its tokens map to, and drop
 * copies a split or join left on other blocks; an edge whose tokens were deleted goes.
 */
function remapBreaks(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  const mapping = new Mapping();
  for (const tr of transactions) mapping.appendMapping(tr.mapping);
  const remaining = new Map<string, BreakSuggestion[]>();
  let tracked = false;
  for (const boundary of boundaries(oldState.doc)) {
    const items = breaks(boundary.node).filter((item) => item.edge === boundary.edge);
    if (!items.length) continue;
    tracked = true;
    const from = mapping.mapResult(boundary.from, 1);
    const to = mapping.mapResult(boundary.to, 1);
    if (from.deleted || to.deleted) continue;
    const key = `${boundary.edge}:${from.pos}:${to.pos}`;
    remaining.set(key, [...(remaining.get(key) ?? []), ...items]);
  }
  // Without stored edges, a split can only copy an empty value.
  if (!tracked) return null;
  const rebuilt = new Map<number, BreakSuggestion[]>();
  for (const boundary of boundaries(newState.doc))
    rebuilt.set(boundary.pos, [
      ...(rebuilt.get(boundary.pos) ?? []),
      ...(remaining.get(`${boundary.edge}:${boundary.from}:${boundary.to}`) ?? []),
    ]);
  const tr = newState.tr.setMeta(suggestionAction, true);
  writeBreaks(tr, rebuilt);
  return tr.docChanged ? tr : null;
}

function bypass(tr: Transaction) {
  return (
    tr.getMeta(suggestionAction) ||
    tr.getMeta(ySyncPluginKey) ||
    tr.getMeta(yUndoPluginKey) ||
    isHistoryTransaction(tr)
  );
}

/** Track only text and textblock slices. Other local document mutations fail
 * closed, including deletion of inline atoms and whole tables or images. */
function textEdit(step: ReplaceStep, before: Node) {
  let supported = true;
  let deletedText = false;
  const inspect = (node: Node) => {
    if (node.isLeaf && !node.isText) supported = false;
    if (
      node.isTextblock &&
      !node.type.allowsMarkType(before.type.schema.marks.suggestionInsert as MarkType)
    )
      supported = false;
  };
  const $from = before.resolve(step.from);
  if ($from.parent.isTextblock) inspect($from.parent);
  before.nodesBetween(step.from, step.to, (node, pos) => {
    inspect(node);
    if (node.isText) deletedText = true;
    // Text selections within a table can be marked while retaining its cells.
    // Removing the table node itself cannot be represented by text marks.
    if (node.type.name === "table" && step.from <= pos && step.to >= pos + node.nodeSize)
      supported = false;
  });
  step.slice.content.descendants((node) => {
    inspect(node);
    if (!node.isText && !node.isTextblock) supported = false;
  });
  return supported && (step.from === step.to || step.slice.size > 0 || deletedText);
}

function rewriteText(
  tr: Transaction,
  step: ReplaceStep,
  mode: SuggestionMode,
  backwards: boolean,
  fresh: boolean,
  shared?: Mark["attrs"],
) {
  // Replacing AllSelection with nothing makes ProseMirror supply an empty
  // paragraph to keep the native document valid. The retained blocks already
  // satisfy that constraint, so this placeholder must not add a blank paragraph.
  const source =
    step.from === 0 &&
    step.to === tr.doc.content.size &&
    step.slice.content.childCount === 1 &&
    step.slice.content.firstChild?.isTextblock &&
    step.slice.content.firstChild.content.size === 0
      ? Slice.empty
      : step.slice;
  const insertType = tr.doc.type.schema.marks.suggestionInsert as MarkType;
  const deleteType = tr.doc.type.schema.marks.suggestionDelete as MarkType;
  const $from = tr.doc.resolve(step.from);
  const $to = tr.doc.resolve(step.to);
  const kind = source.size ? insertType : deleteType;
  const adjacent = [$from.nodeBefore, $from.nodeAfter, $to.nodeBefore, $to.nodeAfter]
    .flatMap((node) => node?.marks ?? [])
    .find((mark) => mark.type === kind && mark.attrs.author === mode.author);
  const attrs =
    shared ??
    (!fresh && adjacent && (!source.size || step.from === step.to)
      ? adjacent.attrs
      : { id: crypto.randomUUID(), author: mode.author, created: new Date().toISOString() });
  const ranges: { from: number; to: number; own: boolean; deleted: boolean }[] = [];
  tr.doc.nodesBetween(step.from, step.to, (node, pos) => {
    if (!node.isText) return;
    ranges.push({
      from: Math.max(step.from, pos),
      to: Math.min(step.to, pos + node.nodeSize),
      own: node.marks.some((mark) => mark.type === insertType && mark.attrs.author === mode.author),
      deleted: node.marks.some((mark) => mark.type === deleteType),
    });
  });
  let retainedEnd = step.to;
  const structuralStart = tr.steps.length;
  const originalBoundaries = boundaries(tr.doc).map((boundary) => {
    let items = breaks(boundary.node).filter((item) => item.edge === boundary.edge);
    const selected = step.from <= boundary.from && step.to >= boundary.to;
    const own =
      selected &&
      items.some((item) => item.kind === "suggestionInsert" && item.author === mode.author);
    if (own) {
      items = [];
      ranges.push({ from: boundary.from, to: boundary.to, own: true, deleted: false });
    }
    if (selected && !own && !items.some((item) => item.kind === "suggestionDelete"))
      items.push({ ...attrs, kind: "suggestionDelete", edge: boundary.edge } as BreakSuggestion);
    return { ...boundary, items };
  });
  const ownRanges: typeof ranges = [];
  for (const range of ranges.filter((range) => range.own).sort((a, b) => a.from - b.from)) {
    const previous = ownRanges.at(-1);
    if (previous && previous.to >= range.from) previous.to = Math.max(previous.to, range.to);
    else ownRanges.push({ ...range });
  }
  const changes = [...ranges.filter((range) => !range.own), ...ownRanges].sort(
    (a, b) => b.from - a.from,
  );
  for (const range of changes) {
    if (range.own) {
      tr.delete(range.from, range.to);
      retainedEnd -= range.to - range.from;
    } else if (!range.deleted) tr.addMark(range.from, range.to, deleteType.create(attrs));
  }
  const markText = (node: Node): Node =>
    node.isText
      ? node.mark(
          insertType.create(attrs).addToSet(node.marks.filter((mark) => !isSuggestion(mark))),
        )
      : node.copy(
          Fragment.fromArray(
            Array.from({ length: node.childCount }, (_, i) => markText(node.child(i))),
          ),
        );
  const inserted: Node[] = [];
  source.content.forEach((node) => {
    inserted.push(markText(node));
  });
  const slice = new Slice(Fragment.fromArray(inserted), source.openStart, source.openEnd);
  const start = tr.steps.length;
  if (slice.size) tr.replaceRange(step.from, step.from, slice);
  const insertedRanges: { from: number; to: number }[] = [];
  for (const map of tr.mapping.maps.slice(start))
    map.forEach((_oldFrom, _oldTo, from, to) => {
      insertedRanges.push({ from, to });
    });
  const structuralMapping = tr.mapping.slice(structuralStart);
  const mappedBoundaries = new Map<string, BreakSuggestion[]>();
  for (const original of originalBoundaries)
    mappedBoundaries.set(
      `${original.edge}:${structuralMapping.map(original.from, 1)}:${structuralMapping.map(original.to, 1)}`,
      original.items,
    );
  const rebuilt = new Map<number, BreakSuggestion[]>();
  for (const boundary of boundaries(tr.doc)) {
    const items = [
      ...(mappedBoundaries.get(`${boundary.edge}:${boundary.from}:${boundary.to}`) ?? []),
    ];
    if (insertedRanges.some(({ from, to }) => boundary.from >= from && boundary.to <= to))
      items.push({ ...attrs, kind: "suggestionInsert", edge: boundary.edge } as BreakSuggestion);
    if (
      boundary.edge === "end" &&
      insertedRanges.some(({ to }) => boundary.to === to) &&
      originalBoundaries.some(
        (original) =>
          original.edge === "start" &&
          step.from <= original.from &&
          step.to >= original.to &&
          original.from === step.from,
      )
    )
      items.push({ ...attrs, kind: "suggestionDelete", edge: "end" } as BreakSuggestion);
    if (
      boundary.edge === undefined &&
      source.openEnd === 0 &&
      step.to > step.from &&
      insertedRanges.some(({ to }) => boundary.from < to && boundary.to >= to)
    )
      items.push({ ...attrs, kind: "suggestionDelete" } as BreakSuggestion);
    rebuilt.set(boundary.pos, [...(rebuilt.get(boundary.pos) ?? []), ...items]);
  }
  writeBreaks(tr, rebuilt);
  return {
    caret: slice.size
      ? tr.mapping.slice(start).map(step.from, 1)
      : backwards
        ? step.from
        : retainedEnd,
    attrs,
  };
}

function rewriteTransactions(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  composition = false,
) {
  if (composition && oldState.doc.eq(newState.doc)) return null;
  let mode = suggestionKey.getState(oldState) as SuggestionMode;
  if (!mode.enabled || !transactions.some((tr) => tr.docChanged && !bypass(tr))) return null;
  const replay = oldState.tr;
  let mapping = new Mapping();
  let caret: number | undefined;
  let shared: Mark["attrs"] | undefined;
  let selection = oldState.selection;
  for (const original of transactions) {
    for (let i = 0; i < original.steps.length; i++) {
      const step = original.steps[i] as Step;
      const mapped = step.map(mapping);
      const start = replay.steps.length;
      if (
        mode.enabled &&
        !bypass(original) &&
        step instanceof ReplaceStep &&
        mapped instanceof ReplaceStep
      ) {
        const rewritten = rewriteText(
          replay,
          mapped,
          mode,
          selection.to > step.from,
          !!original.getMeta("paste"),
          shared,
        );
        caret = rewritten.caret;
        if (composition) shared = rewritten.attrs;
      } else if (mapped) {
        replay.step(mapped);
        if (caret !== undefined) caret = replay.mapping.slice(start).map(caret);
      }
      const next = new Mapping();
      next.appendMap(step.getMap().invert());
      next.appendMapping(mapping);
      const rewritten = replay.mapping.maps.slice(start);
      // Recover offsets inside text inserted earlier in the same transaction.
      const recover = mapped && (!(step instanceof ReplaceStep) || step.slice.size > 0);
      const recoveryIndex = rewritten.findLastIndex((map) => map !== StepMap.empty);
      for (const [index, map] of rewritten.entries())
        next.appendMap(map, recover && index === recoveryIndex ? 0 : undefined);
      mapping = next;
    }
    selection = original.selection;
    mode = original.getMeta(suggestionKey) ?? mode;
  }
  // A composition may switch to Editing before making any suggested edits.
  if (caret === undefined) return null;
  // Only the final document reaches the ordinary Yjs update. The appended
  // rewrite remains in the same undo item as the user's original transaction.
  const tr = newState.tr.setMeta(suggestionAction, true);
  for (const original of [...transactions].reverse())
    for (let i = original.steps.length - 1; i >= 0; i--)
      tr.step((original.steps[i] as Step).invert(original.docs[i] as Node));
  for (const step of replay.steps) tr.step(step);
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret), -1));
  tr.setStoredMarks(newState.storedMarks?.filter((mark) => !isSuggestion(mark)) ?? null);
  return tr;
}

export function createSuggestionPlugin() {
  let view: EditorView | undefined;
  let pending: { state: EditorState; transactions: Transaction[] } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Plugin<SuggestionMode>({
    key: suggestionKey,
    state: {
      init: () => ({ enabled: false, author: "" }),
      apply: (tr, previous) => tr.getMeta(suggestionKey) ?? previous,
    },
    filterTransaction(tr, state) {
      if (!suggestionKey.getState(state)?.enabled || !tr.docChanged || bypass(tr)) return true;
      if (
        tr.steps.every(
          (step, i) => step instanceof ReplaceStep && textEdit(step, tr.docs[i] as Node),
        )
      )
        return true;
      view?.dom.dispatchEvent(new Event(suggestionUnsupported));
      return false;
    },
    view(editorView) {
      view = editorView;
      const end = () => {
        // ProseMirror ends its native composition handler before this runs.
        timer = setTimeout(() => {
          if (!pending || editorView.composing) return;
          const batch = pending;
          pending = undefined;
          const tr = rewriteTransactions(batch.transactions, batch.state, editorView.state, true);
          if (tr) editorView.dispatch(tr);
        }, 0);
      };
      editorView.dom.addEventListener("compositionend", end);
      return {
        destroy() {
          clearTimeout(timer);
          editorView.dom.removeEventListener("compositionend", end);
        },
      };
    },
    appendTransaction(transactions, oldState, newState) {
      if (view?.composing) {
        if (pending || suggestionKey.getState(oldState)?.enabled) {
          pending ??= { state: oldState, transactions: [] };
          pending.transactions.push(...transactions);
        }
        return null;
      }
      if (pending) {
        const batch = pending;
        pending = undefined;
        return rewriteTransactions(
          [...batch.transactions, ...transactions],
          batch.state,
          newState,
          true,
        );
      }
      const rewritten = rewriteTransactions(transactions, oldState, newState);
      if (rewritten || !transactions.some((tr) => tr.docChanged && !bypass(tr))) return rewritten;
      return remapBreaks(transactions, oldState, newState);
    },
  });
}

export const Suggestions = Extension.create({
  name: "docsSuggestions",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "codeBlock"],
        attributes: {
          suggestionBreaks: {
            default: null,
            // A split must not copy another block's edges; remapBreaks places them.
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => {
              try {
                const value: unknown = JSON.parse(
                  element.getAttribute("data-suggestion-breaks") ?? "null",
                );
                return Array.isArray(value)
                  ? value.filter(
                      (item) =>
                        item &&
                        typeof item.id === "string" &&
                        typeof item.author === "string" &&
                        typeof item.created === "string" &&
                        ["suggestionInsert", "suggestionDelete"].includes(item.kind) &&
                        [undefined, "start", "end"].includes(item.edge),
                    )
                  : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.suggestionBreaks
                ? { "data-suggestion-breaks": JSON.stringify(attrs.suggestionBreaks) }
                : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins: () => [createSuggestionPlugin()],
});
