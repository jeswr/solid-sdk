// AUTHORED-BY Codex
import { colour, fontFamily, fontSize, lineHeight, paragraphSpace } from "../editor/styles";
import { WORD } from "./docx-xml";

const direct = (element: Element | undefined, name: string) =>
  Array.from(element?.children ?? []).find(
    (child) => child.namespaceURI === WORD && child.localName === name,
  );
const value = (element: Element | undefined, key = "val") => element?.getAttributeNS(WORD, key);

/** Read native Word properties before Mammoth drops colour, shading and spacing. */
export function docxStyles(document: Document, definitions: Document) {
  const styles = new Map<string, Element>();
  for (const style of definitions.getElementsByTagNameNS(WORD, "style")) {
    const id = value(style, "styleId");
    if (id && !styles.has(id)) styles.set(id, style);
  }
  const inherited = (
    id: string | null | undefined,
    kind: string,
    seen = new Set<string>(),
  ): Element[] => {
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const style = styles.get(id);
    if (!style) return [];
    const properties = direct(style, kind);
    return [
      ...inherited(value(direct(style, "basedOn")), kind, seen),
      ...(properties ? [properties] : []),
    ];
  };
  function css(properties: Element[], paragraph: boolean) {
    const result = new Map<string, string>();
    const set = (name: string, safe: string | null) => {
      if (safe) result.set(name, safe);
    };
    for (const props of properties) {
      if (paragraph) {
        const spacing = direct(props, "spacing");
        if (value(spacing, "lineRule") !== "exact" && value(spacing, "lineRule") !== "atLeast") {
          const line = value(spacing, "line");
          if (line) set("line-height", lineHeight(String(Number(line) / 240)));
        }
        for (const [word, property] of [
          ["before", "margin-top"],
          ["after", "margin-bottom"],
        ]) {
          const space = value(spacing, word);
          if (space) set(property as string, paragraphSpace(`${Number(space) / 20}pt`));
        }
      } else {
        set("font-family", fontFamily(value(direct(props, "rFonts"), "ascii")));
        const size = value(direct(props, "sz"));
        if (size) set("font-size", fontSize(`${Number(size) / 2}pt`));
        const ink = value(direct(props, "color"));
        if (ink) set("color", colour(`#${ink}`));
        const fill = value(direct(props, "shd"), "fill");
        if (fill) set("background-color", colour(`#${fill}`));
      }
    }
    return [...result].map(([name, safe]) => `${name}: ${safe}`).join("; ");
  }
  const paragraph = (element: Element) => {
    const props = direct(element, "pPr");
    return css(
      [...inherited(value(direct(props, "pStyle")), "pPr"), ...(props ? [props] : [])],
      true,
    );
  };
  const runs = new Map<string, { styleId: string | null; css: string }>();
  const prefix = `SuiteRun${crypto.randomUUID()}`;
  for (const run of document.getElementsByTagNameNS(WORD, "r")) {
    let props = direct(run, "rPr");
    if (!props) {
      props = document.createElementNS(WORD, "w:rPr");
      run.prepend(props);
    }
    let reference = direct(props, "rStyle");
    const styleId = value(reference) ?? null;
    const paragraphProps = direct(run.closest("p") ?? run.parentElement ?? undefined, "pPr");
    // Code runs and code blocks carry their own font and shading through the code mark/node;
    // reading those as text styles would add a spurious highlight to every code span.
    if (styleId === "InlineCode" || value(direct(paragraphProps, "pStyle")) === "Code") continue;
    // Paragraph styles (headings, titles) and the Hyperlink character style are carried by the
    // block type and link mark; only the run's own formatting and other character styles become text styles.
    const safe = css(
      [...(styleId === "Hyperlink" ? [] : inherited(styleId, "rPr")), props],
      false,
    );
    if (!safe) continue;
    const id = `${prefix}${runs.size}`;
    runs.set(id, { styleId, css: safe });
    if (!reference) {
      reference = document.createElementNS(WORD, "w:rStyle");
      props.prepend(reference);
    }
    reference.setAttributeNS(WORD, "w:val", id);
    const alias = definitions.createElementNS(WORD, "w:style");
    alias.setAttributeNS(WORD, "w:type", "character");
    alias.setAttributeNS(WORD, "w:styleId", id);
    const name = direct(styles.get(styleId ?? ""), "name");
    if (name) alias.append(name.cloneNode(true));
    definitions.documentElement.append(alias);
  }
  return { paragraph, runs };
}
