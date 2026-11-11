// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, type Mark, type MarkType, type Node, Slice } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Mapping, ReplaceStep, type Step } from "@tiptap/pm/transform";
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

export function suggestions(doc: Node): Suggestion[] {
  const found = new Map<string, Suggestion>();
  doc.descendants((node) => {
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
  return undefined;
}

/** A single transaction, shared by inline and bulk actions. Permissions are checked at dispatch too. */
export function resolveSuggestions(state: EditorState, accept: boolean, id?: string): Transaction {
  const ranges: { from: number; to: number; marks: readonly Mark[] }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const marks = node.marks.filter(
      (mark) => isSuggestion(mark) && (id === undefined || mark.attrs.id === id),
    );
    if (marks.length) ranges.push({ from: pos, to: pos + node.nodeSize, marks });
  });
  const tr = state.tr.setMeta(suggestionAction, true);
  // Resolve each text range once: overlapping marks share coordinates.
  for (const { from, to, marks } of ranges.reverse()) {
    if (marks.some((mark) => accept === (mark.type.name === "suggestionDelete")))
      tr.delete(from, to);
    else for (const mark of marks) tr.removeMark(from, to, mark);
  }
  return tr;
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
  for (const range of ranges.reverse()) {
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
      for (const [index, map] of rewritten.entries())
        next.appendMap(map, recover && index === rewritten.length - 1 ? 0 : undefined);
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
      return rewriteTransactions(transactions, oldState, newState);
    },
  });
}

export const Suggestions = Extension.create({
  name: "docsSuggestions",
  addProseMirrorPlugins: () => [createSuggestionPlugin()],
});
