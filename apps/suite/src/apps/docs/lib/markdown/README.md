<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Docs Markdown subset

```ts
import { markdownToDocs, docsToMarkdown, MarkdownError } from "./markdown";
const document = markdownToDocs("# Plan\n\n- [x] Draft");
const markdown = docsToMarkdown(document);
```

Synchronous, pure TypeScript. Uses only Marked's lexer, never its HTML renderer. There is no
editor, DOM, network, React, hook, file upload, front-matter title extraction, or persistence API.
DOC-L4 is narrower than the eventual editor import/export integration in 05-docs §8.4.

| Markdown | TipTap / ProseMirror JSON |
| --- | --- |
| ATX / setext headings 1–3 | `heading`, `attrs.level` |
| Paragraph, soft newline | `paragraph`, `text` (LF retained) |
| Emphasis / strong / code span | `italic` / `bold` / `code` marks |
| Inline, reference, angle and bare GFM autolinks | `link` mark, `attrs.href`, optional `attrs.title` |
| Fenced / indented code | `codeBlock`, optional `attrs.language`, unmarked text |
| Block quote | `blockquote`, block content |
| Bullet / ordered list | `bulletList` / `orderedList` (`attrs.start`), `listItem` |
| Homogeneous bullet task list | `taskList`, `taskItem` (`attrs.checked`) |
| Horizontal rule / hard line break | `horizontalRule` / `hardBreak` |

Lists and quotes may nest within a maximum traversal depth of 32. List items start with a
paragraph, including an empty paragraph before non-paragraph content. Empty input becomes a `doc`
containing one empty paragraph. Code spans follow CommonMark whitespace normalization. CRLF and
CR become LF. Repeated identical formatting collapses to one mark; adjacent equivalent text
nodes merge, and marks have a stable order. Markdown spelling, bullet characters, tight/loose list
layout, and reference definitions are not retained; exports use canonical inline links and fences.

Links must be syntactically valid absolute http(s) or mailto URLs without whitespace, control
characters, angle brackets, or backslashes. Bare GFM URL/email autolinks decode character references
in their text and destinations. A bare URL hiding CommonMark emphasis fails with `unrepresentable`.
Code fence info supports a single language identifier (`[\w+-]+`). Character references support
`amp`, `lt`, `gt`, `quot`, `apos`, and numeric Unicode scalar values except control ranges.
Numeric references require 1–7 decimal or 1–6 hexadecimal digits; other spellings stay literal.
Other named references and escaped ampersands inside link destinations, titles, or definitions are unsupported;
these are rejected rather than decoded incorrectly. Code content is never entity-decoded.

`markdownToDocs(source, { unsupported: "reject" })` is the default. Recognized unsupported
constructs (including HTML, images, tables, strikethrough, footnotes, front matter, headings 4–6,
mixed/ordered task lists, and fence metadata) throw `MarkdownError`. With
`{ unsupported: "literal" }`, **the entire normalized source** becomes unmarked text in a single
paragraph when an unsupported construct is encountered. This preserves source without partially
interpreting a document. Invalid inputs, parser failures, and limits still throw. Syntax the
lexer recognizes as ordinary text remains ordinary text.

`docsToMarkdown(document)` validates untrusted JSON. It accepts only the node/mark/attribute
subset above; it never drops unknown attributes, alignment, unsupported marks, nodes, or content.
Omitted content/marks and empty attribute objects are accepted. Ordered-list start defaults to 1
(0–999999999 accepted); code language null/empty and link title null/empty mean absent. Task items
require a boolean checked value. All other non-default attributes reject.

Export is checked by reparsing and comparing normalized JSON. If Markdown would change text,
marks, or structure, it throws rather than return a lossy result. Examples include extra empty
paragraphs, blank lines within paragraph text, whitespace-only emphasis, some crossing mark
boundaries, and adjacent lists that would merge. Thus a multiline literal fallback may be
preserved in JSON yet rejected on export if it cannot be expressed as that same paragraph.
Formatting order and adjacent text splitting are the only text-node equivalences used.

Errors carry a `code`: `invalid-input`, `unsupported`, `limit`, or `unrepresentable`. Messages
never contain source content. Each text value and normalized Markdown source is limited to
1,000,000 UTF-16 code units; recursive traversal is limited to 32 levels. Callers can catch
`MarkdownError` and render a typed import/export error without exposing document content.
