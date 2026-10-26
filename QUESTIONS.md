<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DOC-L4 scope questions

1. **Subset versus full import/export** (05-docs §8.4; 12-pure-libraries-4; DOC-L4 brief):
   §8.4 names tiptap-markdown, tables, images and front-matter metadata; DOC-L4 asks for a pure
   CommonMark subset plus task lists. Options: implement the full editor integration, or only the
   named subset. Applied the conservative latter reading: no UI or metadata extraction; unsupported
   Markdown rejects by default, with an explicit whole-source literal fallback. Unsupported JSON
   always rejects rather than dropping attributes, nodes or marks.
2. **Heading levels** (05-docs §1, §4.1, §8.2; DOC-L4): CommonMark has six levels but Docs specifies
   levels 1–3. Options: accept all six, clamp, or reject 4–6. Applied rejection (or literal fallback).
3. **Unrepresentable JSON** (DOC-L4 fail-closed rule): Markdown cannot encode every Docs document
   losslessly (e.g. empty paragraphs or whitespace-only emphasis). Options: drop information or
   reject. Applied typed rejection when reparsing the export changes its normalized JSON.
