// AUTHORED-BY Codex
import { SaxesParser } from "saxes";

export const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}
const qualified = (uri: string, local: string) => (uri === WORD ? local : `${uri}:${local}`);

/** Namespace-aware OOXML reading, shared by payload checks and fallback list mapping. */
export function readXml(source: string): XmlElement {
  const root: XmlElement = { name: "", attrs: {}, children: [], text: "" };
  const stack = [root];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    const node: XmlElement = {
      name: qualified(tag.uri, tag.local),
      attrs: Object.fromEntries(
        Object.values(tag.attributes).map((attr) => [qualified(attr.uri, attr.local), attr.value]),
      ),
      children: [],
      text: "",
    };
    (stack.at(-1) as XmlElement).children.push(node);
    stack.push(node);
  });
  parser.on("text", (value) => {
    (stack.at(-1) as XmlElement).text += value;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.write(source).close();
  return root;
}

export function descendants(node: XmlElement, name: string): XmlElement[] {
  return node.children.flatMap((child) => [
    ...(child.name === name ? [child] : []),
    ...descendants(child, name),
  ]);
}
export function child(node: XmlElement, name: string): XmlElement | undefined {
  return node.children.find((child) => child.name === name);
}
