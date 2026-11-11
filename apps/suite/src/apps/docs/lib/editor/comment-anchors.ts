// AUTHORED-BY Codex GPT-6.1-Sol
import type { Node } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { decodeRelativePosition, encodeRelativePosition } from "yjs";
import type { CommentAnchor } from "../model/comments";

export interface CommentRange {
  from: number;
  to: number;
}
function encode(position: ReturnType<typeof absolutePositionToRelativePosition>): string {
  return btoa(String.fromCharCode(...encodeRelativePosition(position)));
}
function decode(value: string) {
  return decodeRelativePosition(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}
export function captureCommentAnchor(state: EditorState): CommentAnchor {
  const { from, to } = state.selection;
  const exact = state.doc.textBetween(from, to, "\n", "\ufffc");
  if (from === to || !exact.trim()) throw new Error("Select text to comment on.");
  const sync = ySyncPluginKey.getState(state);
  if (!sync?.binding) throw new Error("The document is still syncing. Try again.");
  return {
    exact,
    prefix: Array.from(state.doc.textBetween(0, from, "\n", "\ufffc"))
      .slice(-32)
      .join(""),
    suffix: Array.from(state.doc.textBetween(to, state.doc.content.size, "\n", "\ufffc"))
      .slice(0, 32)
      .join(""),
    start: encode(absolutePositionToRelativePosition(from, sync.type, sync.binding.mapping)),
    end: encode(absolutePositionToRelativePosition(to, sync.type, sync.binding.mapping)),
  };
}
/** A text projection with explicit offsets; inline formatting never splits a quote. */
export function quoteRange(doc: Node, anchor: CommentAnchor): CommentRange | undefined {
  if (!anchor.exact) return undefined;
  let text = "";
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && text.length) {
      text += "\n";
      positions.push(pos);
    }
    if (node.isText) {
      const value = node.text as string;
      text += value;
      for (let i = 0; i < value.length; i++) positions.push(pos + i);
    } else if (node.isLeaf && node.isInline) {
      text += "\ufffc";
      positions.push(pos);
    }
  });
  let best: CommentRange | undefined;
  let bestScore = -1;
  const { exact, prefix, suffix } = anchor;
  for (let index = text.indexOf(exact); index !== -1; index = text.indexOf(exact, index + 1)) {
    // Linear common-context lengths, compared in place (no per-match slices).
    let score = 0;
    while (
      score < prefix.length &&
      score < index &&
      text[index - 1 - score] === prefix[prefix.length - 1 - score]
    )
      score++;
    const after = index + exact.length;
    let tail = 0;
    while (
      tail < suffix.length &&
      after + tail < text.length &&
      text[after + tail] === suffix[tail]
    )
      tail++;
    score += tail;
    if (score > bestScore) {
      bestScore = score;
      best = {
        from: positions[index] as number,
        to: (positions[index + exact.length - 1] as number) + 1,
      };
    }
  }
  return best;
}
export function resolveCommentAnchor(
  state: EditorState,
  anchor: CommentAnchor,
): CommentRange | undefined {
  const sync = ySyncPluginKey.getState(state);
  if (sync?.binding) {
    let from: number | null = null;
    let to: number | null = null;
    try {
      from = relativePositionToAbsolutePosition(
        sync.doc,
        sync.type,
        decode(anchor.start),
        sync.binding.mapping,
      );
      to = relativePositionToAbsolutePosition(
        sync.doc,
        sync.type,
        decode(anchor.end),
        sync.binding.mapping,
      );
    } catch {
      /* Invalid or retired Yjs identities fall back to the text quote. */
    }
    if (from !== null && to !== null) {
      // Both positions still resolve, so they are authoritative: a collapsed or
      // blank range means the commented text was deleted. Never move the
      // highlight to another occurrence of the same words.
      if (
        from >= 0 &&
        to > from &&
        to <= state.doc.content.size &&
        state.doc.textBetween(from, to).trim()
      )
        return { from, to };
      return undefined;
    }
  }
  return quoteRange(state.doc, anchor);
}
