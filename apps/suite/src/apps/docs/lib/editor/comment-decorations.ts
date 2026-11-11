// AUTHORED-BY Codex GPT-6.1-Sol
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import type { DocumentComment } from "../model/comments";
import { resolveCommentAnchor } from "./comment-anchors";

interface CommentDecorationsState {
  comments: DocumentComment[];
  active?: string | undefined;
  activate?: ((url: string) => void) | undefined;
}
export const commentKey = new PluginKey<CommentDecorationsState>("docsComments");
export function createCommentPlugin() {
  return new Plugin<CommentDecorationsState>({
    key: commentKey,
    state: {
      init: () => ({ comments: [] }),
      apply: (tr, previous) => tr.getMeta(commentKey) ?? previous,
    },
    props: {
      decorations(state) {
        const data = commentKey.getState(state) as CommentDecorationsState;
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
      },
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
