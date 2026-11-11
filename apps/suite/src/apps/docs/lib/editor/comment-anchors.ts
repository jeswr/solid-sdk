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
  for (
    let index = text.indexOf(anchor.exact);
    index !== -1;
    index = text.indexOf(anchor.exact, index + 1)
  ) {
    const before = text.slice(0, index);
    const after = text.slice(index + anchor.exact.length);
    let score = 0;
    for (let n = 1; n <= anchor.prefix.length && before.endsWith(anchor.prefix.slice(-n)); n++)
      score++;
    for (let n = 1; n <= anchor.suffix.length && after.startsWith(anchor.suffix.slice(0, n)); n++)
      score++;
    if (score > bestScore) {
      bestScore = score;
      best = {
        from: positions[index] as number,
        to: (positions[index + anchor.exact.length - 1] as number) + 1,
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
    try {
      const from = relativePositionToAbsolutePosition(
        sync.doc,
        sync.type,
        decode(anchor.start),
        sync.binding.mapping,
      );
      const to = relativePositionToAbsolutePosition(
        sync.doc,
        sync.type,
        decode(anchor.end),
        sync.binding.mapping,
      );
      if (
        from !== null &&
        to !== null &&
        from >= 0 &&
        to > from &&
        to <= state.doc.content.size &&
        state.doc.textBetween(from, to).trim()
      )
        return { from, to };
    } catch {
      /* Invalid or retired Yjs identities fall back to the text quote. */
    }
  }
  return quoteRange(state.doc, anchor);
}
