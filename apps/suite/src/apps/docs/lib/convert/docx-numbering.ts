// AUTHORED-BY Codex
import { child, descendants, readXml, type XmlElement } from "./docx-xml";

/** Mammoth exposes list levels but erases numId and start/startOverride. Read those first. */
export function readNumbering(body: string, numbering: string) {
  const root = readXml(numbering);
  const abstracts = new Map(
    descendants(root, "abstractNum").map((node) => [node.attrs.abstractNumId, node]),
  );
  const starts = new Map<string, Map<string, number>>();
  const restarts = new Map<string, Map<string, number>>();
  for (const num of descendants(root, "num")) {
    const abstract = abstracts.get(child(num, "abstractNumId")?.attrs.val);
    const levels = new Map<string, number>();
    const resets = new Map<string, number>();
    const setLevel = (level: XmlElement, index: string) => {
      levels.set(index, Number(child(level, "start")?.attrs.val ?? 1));
      // Word's lvlRestart is one-based; zero explicitly disables restarting.
      resets.set(index, Number(child(level, "lvlRestart")?.attrs.val ?? index) - 1);
    };
    if (abstract) {
      for (const level of descendants(abstract, "lvl")) {
        setLevel(level, level.attrs.ilvl ?? "0");
      }
    }
    for (const override of descendants(num, "lvlOverride")) {
      const level = child(override, "lvl");
      if (level) setLevel(level, override.attrs.ilvl ?? "0");
      const start =
        child(override, "startOverride") ?? child(child(override, "lvl") ?? override, "start");
      if (start) levels.set(override.attrs.ilvl ?? "0", Number(start.attrs.val));
    }
    starts.set(num.attrs.numId ?? "", levels);
    restarts.set(num.attrs.numId ?? "", resets);
  }
  const counters = new Map<string, Map<string, number>>();
  return descendants(readXml(body), "p").map((paragraph) => {
    const properties = child(paragraph, "pPr");
    const num = properties && child(properties, "numPr");
    const id = num && child(num, "numId")?.attrs.val;
    const level = (num && child(num, "ilvl")?.attrs.val) ?? "0";
    const initial = starts.get(id ?? "")?.get(level) ?? 1;
    const values = counters.get(id ?? "") ?? new Map<string, number>();
    const start = values.get(level) ?? (Number.isSafeInteger(initial) ? initial : 1);
    if (id !== undefined) {
      values.set(level, start + 1);
      for (const deeper of values.keys()) {
        const restart = restarts.get(id)?.get(deeper) ?? Number(deeper) - 1;
        if (Number(level) < Number(deeper) && Number(level) <= restart) values.delete(deeper);
      }
      counters.set(id, values);
    }
    return { id, start };
  });
}
