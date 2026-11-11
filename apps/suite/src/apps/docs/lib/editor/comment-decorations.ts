// AUTHORED-BY Codex GPT-6.1-Sol
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import type { DocumentComment } from "../model/comments";
import { resolveCommentAnchor } from "./comment-anchors";

interface CommentDecorationsMeta {
  comments: DocumentComment[];
  active?: string | undefined;
  activate?: ((url: string) => void) | undefined;
}
interface CommentDecorationsState extends CommentDecorationsMeta {
  decorations: DecorationSet;
}
export const commentKey = new PluginKey<CommentDecorationsState>("docsComments");
function build(state: EditorState, data: CommentDecorationsMeta): DecorationSet {
  const decorations: Decoration[] = [];
  for (const comment of data.comments) {
    const range = comment.anchor && resolveCommentAnchor(state, comment.anchor);
    if (range)
      decorations.push(
        Decoration.inline(
          range.from,
          range.to,
          {
            class: `docs-comment-anchor${data.active === comment.url ? " docs-comment-anchor-active" : ""}`,
            "data-comment-id": comment.url,
          },
          { inclusiveStart: false, inclusiveEnd: false },
        ),
      );
  }
  return DecorationSet.create(state.doc, decorations);
}
/**
 * Yjs anchors are resolved only while ProseMirror and Yjs agree: on new comment
 * data and on changes the sync binding applied from Yjs. A local edit reaches
 * Yjs only after this state is computed, so local edits map the existing
 * decorations through the transaction instead of resolving against a lagging doc.
 */
export function createCommentPlugin() {
  return new Plugin<CommentDecorationsState>({
    key: commentKey,
    state: {
      init: () => ({ comments: [], decorations: DecorationSet.empty }),
      apply: (tr, previous, _old, state) => {
        const meta = tr.getMeta(commentKey) as CommentDecorationsMeta | undefined;
        if (meta) return { ...meta, decorations: build(state, meta) };
        if (!tr.docChanged) return previous;
        if (tr.getMeta(ySyncPluginKey)?.isChangeOrigin)
          return { ...previous, decorations: build(state, previous) };
        return { ...previous, decorations: previous.decorations.map(tr.mapping, tr.doc) };
      },
    },
    props: {
      decorations: (state) => commentKey.getState(state)?.decorations,
      handleClick(view, _pos, event) {
        const element = (event.target as Element).closest<HTMLElement>("[data-comment-id]");
        if (!element) return false;
        commentKey.getState(view.state)?.activate?.(element.dataset.commentId as string);
        return true;
      },
    },
  });
}
export const CommentDecorations = Extension.create({
  name: "docsComments",
  addProseMirrorPlugins: () => [createCommentPlugin()],
});
