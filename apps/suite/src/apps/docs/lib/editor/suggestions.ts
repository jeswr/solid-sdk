// AUTHORED-BY Codex GPT-6.1-Sol
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
  const mark = [...($from.nodeAfter?.marks ?? []), ...($from.nodeBefore?.marks ?? [])].find(
    isSuggestion,
  );
  if (mark) return { ...mark.attrs, kind: mark.type.name } as Suggestion;
  return undefined;
}

/** A single transaction, shared by inline and bulk actions. Permissions are checked at dispatch too. */
export function resolveSuggestions(state: EditorState, accept: boolean, id?: string): Transaction {
  const ranges: { from: number; to: number; mark: Mark }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks)
      if (isSuggestion(mark) && (id === undefined || mark.attrs.id === id))
        ranges.push({ from: pos, to: pos + node.nodeSize, mark });
  });
  const tr = state.tr.setMeta(suggestionAction, true);
  for (const { from, to, mark } of ranges.reverse()) {
    if (accept === (mark.type.name === "suggestionDelete")) tr.delete(from, to);
    else tr.removeMark(from, to, mark);
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

/** Only flat text edits are tracked in slice 1. Formatting and structural edits
 * (paragraph splits/joins, block paste, tables, images) apply normally. */
function textEdit(step: ReplaceStep, before: Node) {
  const $from = before.resolve(step.from);
  const $to = before.resolve(step.to);
  if (
    !$from.sameParent($to) ||
    !$from.parent.isTextblock ||
    step.slice.openStart ||
    step.slice.openEnd
  )
    return false;
  let text = true;
  $from.parent.nodesBetween($from.parentOffset, $to.parentOffset, (node) => {
    if (!node.isText) text = false;
  });
  step.slice.content.forEach((node) => {
    if (!node.isText) text = false;
  });
  return (
    text && $from.parent.type.allowsMarkType(before.type.schema.marks.suggestionInsert as MarkType)
  );
}

function rewriteText(tr: Transaction, step: ReplaceStep, mode: SuggestionMode, backwards: boolean) {
  const insertType = tr.doc.type.schema.marks.suggestionInsert as MarkType;
  const deleteType = tr.doc.type.schema.marks.suggestionDelete as MarkType;
  const $from = tr.doc.resolve(step.from);
  const adjacent = [$from.nodeBefore, $from.nodeAfter]
    .flatMap((node) => node?.marks ?? [])
    .find((mark) => mark.type === insertType && mark.attrs.author === mode.author);
  const attrs =
    step.from === step.to && adjacent
      ? adjacent.attrs
      : { id: crypto.randomUUID(), author: mode.author, created: new Date().toISOString() };
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
  const inserted: Node[] = [];
  step.slice.content.forEach((node) => {
    inserted.push(
      node.mark(
        insertType.create(attrs).addToSet(node.marks.filter((mark) => !isSuggestion(mark))),
      ),
    );
  });
  const slice = new Slice(Fragment.fromArray(inserted), 0, 0);
  if (slice.size) tr.replace(step.from, step.from, slice);
  return slice.size ? step.from + slice.size : backwards ? step.from : retainedEnd;
}

export function createSuggestionPlugin() {
  return new Plugin<SuggestionMode>({
    key: suggestionKey,
    state: {
      init: () => ({ enabled: false, author: "" }),
      apply: (tr, previous) => tr.getMeta(suggestionKey) ?? previous,
    },
    appendTransaction(transactions, oldState, newState) {
      const mode = suggestionKey.getState(oldState) as SuggestionMode;
      if (!mode.enabled || !transactions.some((tr) => tr.docChanged && !bypass(tr))) return null;
      const replay = oldState.tr;
      let mapping = new Mapping();
      let changed = false;
      let caret: number | undefined;
      let selection = oldState.selection;
      for (const original of transactions) {
        for (let i = 0; i < original.steps.length; i++) {
          const step = original.steps[i] as Step;
          const mapped = step.map(mapping);
          const start = replay.steps.length;
          if (
            !bypass(original) &&
            step instanceof ReplaceStep &&
            textEdit(step, original.docs[i] as Node) &&
            mapped instanceof ReplaceStep
          ) {
            caret = rewriteText(replay, mapped, mode, selection.to > step.from);
            changed = true;
          } else if (mapped) {
            replay.step(mapped);
            if (caret !== undefined) caret = replay.mapping.slice(start).map(caret);
          }
          const next = new Mapping();
          next.appendMap(step.getMap().invert());
          next.appendMapping(mapping);
          const rewritten = replay.mapping.maps.slice(start);
          // Recover offsets inside newly inserted text when a later step in the
          // same transaction formats or edits it. Without a mirror those offsets
          // collapse to an insertion boundary during the inverse mapping.
          const recover = mapped && (!(step instanceof ReplaceStep) || step.slice.size > 0);
          for (const [index, map] of rewritten.entries())
            next.appendMap(map, recover && index === rewritten.length - 1 ? 0 : undefined);
          mapping = next;
        }
        selection = original.selection;
      }
      if (!changed) return null;
      // appendTransaction runs before the Yjs binding's view update: only the final
      // document reaches Yjs. Invert/replay also keeps this in the original undo item.
      const tr = newState.tr.setMeta(suggestionAction, true);
      for (const original of [...transactions].reverse())
        for (let i = original.steps.length - 1; i >= 0; i--)
          tr.step((original.steps[i] as Step).invert(original.docs[i] as Node));
      for (const step of replay.steps) tr.step(step);
      // changed implies at least one tracked text step supplied a caret.
      tr.setSelection(TextSelection.near(tr.doc.resolve(caret as number)));
      tr.setStoredMarks(newState.storedMarks?.filter((mark) => !isSuggestion(mark)) ?? null);
      return tr;
    },
  });
}

export const Suggestions = Extension.create({
  name: "docsSuggestions",
  addProseMirrorPlugins: () => [createSuggestionPlugin()],
});
