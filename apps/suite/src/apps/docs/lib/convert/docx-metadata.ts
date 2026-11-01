// AUTHORED-BY Codex
import type { readNumbering } from "./docx-numbering";
import { WORD } from "./docx-xml";

export type DocxBlockMetadata = { styleId: string | null } & (
  | { type: "paragraph"; numbering: ReturnType<typeof readNumbering>[number] }
  | { type: "table"; indent: number }
);

/** Carry identity through Mammoth, which can drop entire cells and their blocks. */
export function identifyDocxBlocks(
  body: string,
  styles: string,
  numbering: ReturnType<typeof readNumbering>,
) {
  const parser = new DOMParser();
  const document = parser.parseFromString(body, "application/xml");
  const definitions = parser.parseFromString(
    styles || `<w:styles xmlns:w="${WORD}"/>`,
    "application/xml",
  );
  const originalStyles = {
    paragraph: new Map<string, Element>(),
    table: new Map<string, Element>(),
  };
  for (const style of definitions.getElementsByTagNameNS(WORD, "style")) {
    const id = style.getAttributeNS(WORD, "styleId");
    const type = style.getAttributeNS(WORD, "type");
    // Match Mammoth's per-kind, first-definition lookup. An absent/empty
    // reference never applies a style, including definitions without an ID.
    if (id && (type === "paragraph" || type === "table") && !originalStyles[type].has(id))
      originalStyles[type].set(id, style);
  }
  const blocks = new Map<string, DocxBlockMetadata>();
  const prefix = `SuiteImport${crypto.randomUUID()}`;
  let paragraphIndex = 0;
  for (const element of Array.from(document.getElementsByTagNameNS(WORD, "*"))) {
    if (element.localName !== "p" && element.localName !== "tbl") continue;
    const paragraph = element.localName === "p";
    const propertiesName = paragraph ? "pPr" : "tblPr";
    const styleName = paragraph ? "pStyle" : "tblStyle";
    let properties = Array.from(element.children).find(
      (child) => child.namespaceURI === WORD && child.localName === propertiesName,
    );
    if (!properties) {
      properties = document.createElementNS(WORD, `w:${propertiesName}`);
      element.prepend(properties);
    }
    let style = Array.from(properties.children).find(
      (child) => child.namespaceURI === WORD && child.localName === styleName,
    );
    const styleId = style?.getAttributeNS(WORD, "val") ?? null;
    const id = `${prefix}${blocks.size}`;
    const indent = Array.from(properties.children).find(
      (child) => child.namespaceURI === WORD && child.localName === "tblInd",
    );
    blocks.set(id, {
      styleId,
      ...(paragraph
        ? {
            type: "paragraph",
            numbering: numbering[paragraphIndex++] as ReturnType<typeof readNumbering>[number],
          }
        : { type: "table", indent: Number(indent?.getAttributeNS(WORD, "w") ?? 0) }),
    });
    if (!style) {
      style = document.createElementNS(WORD, `w:${styleName}`);
      properties.prepend(style);
    }
    style.setAttributeNS(WORD, "w:val", id);
    // Mammoth reads only the style name here. Retain it while using a unique
    // style ID as an internal carrier, then restore the original ID on its AST.
    const alias = definitions.createElementNS(WORD, "w:style");
    alias.setAttributeNS(WORD, "w:styleId", id);
    alias.setAttributeNS(WORD, "w:type", paragraph ? "paragraph" : "table");
    const original = styleId
      ? originalStyles[paragraph ? "paragraph" : "table"].get(styleId)
      : undefined;
    const name = original?.getElementsByTagNameNS(WORD, "name")[0];
    if (name) alias.append(name.cloneNode(true));
    definitions.documentElement.append(alias);
  }
  const serializer = new XMLSerializer();
  return {
    xml: serializer.serializeToString(document),
    styles: serializer.serializeToString(definitions),
    blocks,
  };
}
