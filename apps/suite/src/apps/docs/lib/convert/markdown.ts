// AUTHORED-BY Codex
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import { getSchema, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { validLink } from "../editor/logic";
import { MAX_IMPORT_BYTES } from "./docx-import";

const extensions = [
  StarterKit,
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Image,
  Highlight,
];
const markdown = new MarkdownManager({ extensions, markedOptions: { gfm: true } });
const schema = getSchema(extensions);
export const MARKDOWN_NOTES =
  "Underline and alignment are omitted. Nested tables are flattened. Highlights use ==text==. Images link to their absolute URL.";

/** Markdown images are inline tokens; the editor's images are block nodes. */
function splitImages(node: JSONContent): JSONContent[] {
  if (!["paragraph", "heading"].includes(String(node.type)) || !node.content) return [node];
  const blocks: JSONContent[] = [];
  let inline: JSONContent[] = [];
  const flush = () => {
    if (inline.length) blocks.push({ ...node, content: inline });
    inline = [];
  };
  for (const child of node.content) {
    // Sanitizing an unsafe image also produces a block (an empty paragraph).
    if (["image", "paragraph"].includes(String(child.type))) {
      flush();
      blocks.push(child);
    } else inline.push(child);
  }
  flush();
  return blocks.length ? blocks : [node];
}

function clean(node: JSONContent, dropHighlights: boolean, tableDepth = 0): JSONContent {
  const result = { ...node };
  if (result.attrs) {
    result.attrs = { ...result.attrs };
    delete result.attrs.textAlign;
  }
  if (result.marks)
    result.marks = result.marks.filter(
      (mark) =>
        !["underline", "comment"].includes(mark.type) &&
        !(dropHighlights && mark.type === "highlight") &&
        (mark.type !== "link" || !!validLink(String(mark.attrs?.href))),
    );
  if (
    result.type === "image" &&
    (!/^https?:\/\//.test(String(result.attrs?.src)) || !validLink(String(result.attrs?.src)))
  ) {
    return { type: "paragraph" };
  }
  if (result.type === "table" && tableDepth > 0) {
    return { type: "paragraph", content: [{ type: "text", text: textContent(result) }] };
  }
  if (result.content)
    result.content = result.content.flatMap((child) =>
      splitImages(clean(child, dropHighlights, tableDepth + (result.type === "table" ? 1 : 0))),
    );
  if (
    ["listItem", "taskItem"].includes(String(result.type)) &&
    result.content?.[0]?.type === "image"
  )
    result.content.unshift({ type: "paragraph" });
  return result;
}
function textContent(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(textContent).join(" ");
}
export function exportMarkdown(json: JSONContent, dropHighlights = false): string {
  return markdown.serialize(clean(json, dropHighlights));
}
export function importMarkdown(source: string, fileName: string) {
  if (new TextEncoder().encode(source).byteLength > MAX_IMPORT_BYTES)
    throw new Error("Choose a file of 50 MB or less");
  let title = fileName.replace(/\.(md|markdown)$/i, "");
  let body = source.replace(/^\uFEFF/, "");
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body);
  if (frontMatter) {
    const value = /^title:\s*(.+)$/m.exec(String(frontMatter[1]))?.[1]?.trim();
    if (value) title = value.replace(/^(['"])(.*)\1$/, "$2");
    body = body.slice(frontMatter[0].length);
  }
  // Parse into the schema's inert nodes, then sanitize URLs and strip unsupported attrs.
  // Sanitizing the Markdown source as HTML would destroy code samples and autolinks.
  const json = clean(markdown.parse(body), false);
  const parsed = schema.nodeFromJSON(json);
  parsed.check();
  return { title: title.slice(0, 200), json: parsed.toJSON() as JSONContent };
}
