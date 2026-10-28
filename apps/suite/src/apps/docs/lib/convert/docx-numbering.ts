// AUTHORED-BY Codex
import { child, descendants, readXml } from "./docx-xml";

/** Mammoth exposes list levels but erases numId and start/startOverride. Read those first. */
export function readNumbering(body: string, numbering: string) {
  const root = readXml(numbering);
  const abstracts = new Map(
    descendants(root, "abstractNum").map((node) => [node.attrs.abstractNumId, node]),
  );
  const starts = new Map<string, Map<string, number>>();
  for (const num of descendants(root, "num")) {
    const abstract = abstracts.get(child(num, "abstractNumId")?.attrs.val);
    const levels = new Map<string, number>();
    if (abstract) {
      for (const level of descendants(abstract, "lvl")) {
        levels.set(level.attrs.ilvl ?? "0", Number(child(level, "start")?.attrs.val ?? 1));
      }
    }
    for (const override of descendants(num, "lvlOverride")) {
      const start =
        child(override, "startOverride") ?? child(child(override, "lvl") ?? override, "start");
      if (start) levels.set(override.attrs.ilvl ?? "0", Number(start.attrs.val));
    }
    starts.set(num.attrs.numId ?? "", levels);
  }
  return descendants(readXml(body), "p").map((paragraph) => {
    const properties = child(paragraph, "pPr");
    const num = properties && child(properties, "numPr");
    const id = num && child(num, "numId")?.attrs.val;
    const level = (num && child(num, "ilvl")?.attrs.val) ?? "0";
    const start = starts.get(id ?? "")?.get(level) ?? 1;
    return { id, start: Number.isSafeInteger(start) ? start : 1 };
  });
}
