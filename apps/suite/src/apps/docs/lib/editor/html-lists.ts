// AUTHORED-BY Codex

/** Lift block images and supply the required paragraph before a list's leading block. */
export function normaliseHtmlLists(root: ParentNode) {
  for (const paragraph of root.querySelectorAll("p")) {
    if (paragraph.querySelector("img") && !paragraph.textContent?.trim())
      paragraph.replaceWith(...paragraph.childNodes);
  }
  const blocks = "h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol,table,hr,img";
  for (const item of root.querySelectorAll("li")) {
    const first = Array.from(item.childNodes).find(
      (node) => node.nodeType === 1 || (node.nodeType === 3 && node.textContent?.trim()),
    );
    if (
      first instanceof Element &&
      first.tagName !== "P" &&
      (first.matches(blocks) || first.querySelector(blocks))
    ) {
      // Whitespace before a block is structural HTML spacing, not a second
      // paragraph when Markdown's HTML bridge preserves text whitespace.
      while (item.firstChild !== first) item.firstChild?.remove();
      first.before(first.ownerDocument.createElement("p"));
    }
  }
}
