// AUTHORED-BY Codex

/** Lift block images and supply the required paragraph before a list's leading block. */
export function normaliseHtmlLists(root: ParentNode) {
  for (const paragraph of root.querySelectorAll("p")) {
    if (paragraph.querySelector("img") && !paragraph.textContent?.trim())
      paragraph.replaceWith(...paragraph.childNodes);
  }
  // Read rendered controls before schema parsing discards inputs. Match the
  // owning item so a nested checklist cannot turn its parent into a task.
  for (const list of root.querySelectorAll("ul,ol")) {
    const items = Array.from(list.children).filter((child) => child.tagName === "LI");
    const checks = items.map((item) =>
      Array.from(item.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
        (input) => input.closest("li") === item,
      ),
    );
    if (!checks.some(Boolean)) continue;
    // The schema has homogeneous lists. Split on item kind, as the Markdown
    // importer does, and count task items when resuming ordinary numbering.
    const groups: Element[] = [];
    items.forEach((item, index) => {
      const check = checks[index];
      const task = Boolean(check);
      let group = groups.at(-1);
      if (!group || (group.getAttribute("data-type") === "taskList") !== task) {
        group = task ? list.ownerDocument.createElement("ul") : (list.cloneNode(false) as Element);
        if (task) group.setAttribute("data-type", "taskList");
        else {
          group.removeAttribute("data-type");
          if (list.tagName === "OL")
            group.setAttribute("start", String((list as HTMLOListElement).start + index));
        }
        groups.push(group);
      }
      if (check) {
        item.setAttribute("data-type", "taskItem");
        item.setAttribute("data-checked", String(check.checked));
        const label = check.closest("label");
        check.remove();
        if (label) label.replaceWith(...label.childNodes);
      }
      group.append(item);
    });
    list.replaceWith(...groups);
  }
  const blocks = "p,h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol,table,hr,img";
  // A div may hold prose, blocks, or both. Wrap each inline run before lifting
  // it so sibling/nested div boundaries survive both schema parsing and the
  // HTML sanitizer. Work inside out, for ordinary lists as well as checklists.
  for (const wrapper of Array.from(root.querySelectorAll("li div")).reverse()) {
    let paragraph: HTMLParagraphElement | undefined;
    for (const child of Array.from(wrapper.childNodes)) {
      if (child instanceof Element && child.matches(blocks)) paragraph = undefined;
      else if (!paragraph && child.nodeType === 3 && !child.textContent?.trim()) child.remove();
      else {
        if (!paragraph) {
          paragraph = wrapper.ownerDocument.createElement("p");
          child.before(paragraph);
        }
        paragraph.append(child);
      }
    }
    if (!wrapper.hasChildNodes()) wrapper.append(wrapper.ownerDocument.createElement("p"));
    wrapper.replaceWith(...wrapper.childNodes);
  }
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
