// AUTHORED-BY Codex
import { child, descendants, readXml, type XmlElement } from "./docx-xml";

/** Resolve numbering once for both list mapping and counters, before Mammoth erases IDs. */
export function readNumbering(body: string, numbering: string, styles = "") {
  const root = readXml(numbering);
  const styleNodes = styles ? descendants(readXml(styles), "style") : [];
  const styleById = new Map(styleNodes.map((node) => [node.attrs.styleId, node]));
  const defaultStyle = styleNodes.find(
    (node) => node.attrs.type === "paragraph" && ["1", "true"].includes(node.attrs.default ?? ""),
  )?.attrs.styleId;
  const abstracts = new Map(
    descendants(root, "abstractNum").map((node) => [node.attrs.abstractNumId, node]),
  );
  const nums = new Map(descendants(root, "num").map((node) => [node.attrs.numId ?? "", node]));
  const numId = (properties: XmlElement | undefined) => properties && child(properties, "numPr");
  const styleChain = (initial: string | undefined) => {
    const ids = new Set<string>();
    const properties: (XmlElement | undefined)[] = [];
    let id = initial;
    while (id !== undefined && !ids.has(id)) {
      ids.add(id);
      const style = styleById.get(id);
      if (!style) break;
      properties.push(child(style, "pPr"));
      id = child(style, "basedOn")?.attrs.val;
    }
    return { ids, properties };
  };
  const numberingValue = (properties: (XmlElement | undefined)[], name: string) =>
    properties
      .map(numId)
      .map((num) => num && child(num, name)?.attrs.val)
      .find((value) => value !== undefined);
  // A numbering style can redirect an abstract definition to another instance.
  // Resolve links with a cycle guard, then apply this instance's overrides.
  const levelsFor = (id: string, seen = new Set<string>()): Map<string, XmlElement> => {
    if (seen.has(id)) return new Map();
    seen.add(id);
    const num = nums.get(id);
    if (!num) return new Map();
    const abstract = abstracts.get(child(num, "abstractNumId")?.attrs.val);
    const link = abstract && child(abstract, "numStyleLink")?.attrs.val;
    const linkedId = numberingValue(styleChain(link).properties, "numId");
    const levels =
      linkedId !== undefined ? levelsFor(linkedId, seen) : new Map<string, XmlElement>();
    if (abstract)
      for (const level of descendants(abstract, "lvl")) levels.set(level.attrs.ilvl ?? "0", level);
    for (const override of descendants(num, "lvlOverride")) {
      const index = override.attrs.ilvl ?? "0";
      let level = child(override, "lvl") ?? levels.get(index);
      const start = child(override, "startOverride");
      if (start) {
        level = {
          ...(level ?? { name: "lvl", attrs: {}, text: "", children: [] }),
          children: [
            ...(level?.children ?? []).filter((node) => node.name !== "start"),
            { ...start, name: "start" },
          ],
        };
      }
      if (level) levels.set(index, level);
    }
    return levels;
  };
  const starts = new Map<string, Map<string, number>>();
  const restarts = new Map<string, Map<string, number>>();
  const formats = new Map<string, Map<string, boolean>>();
  const byStyle = new Map<string, { id: string; level: string }[]>();
  for (const id of nums.keys()) {
    const levels = new Map<string, number>();
    const resets = new Map<string, number>();
    const ordered = new Map<string, boolean>();
    const setLevel = (level: XmlElement, index: string) => {
      levels.set(index, Number(child(level, "start")?.attrs.val ?? 1));
      // Word's lvlRestart is one-based; zero explicitly disables restarting.
      resets.set(index, Number(child(level, "lvlRestart")?.attrs.val ?? index) - 1);
      ordered.set(index, child(level, "numFmt")?.attrs.val !== "bullet");
      const style = child(level, "pStyle")?.attrs.val;
      if (style !== undefined) {
        const references = byStyle.get(style) ?? [];
        references.push({ id, level: index });
        byStyle.set(style, references);
      }
    };
    for (const [index, level] of levelsFor(id)) setLevel(level, index);
    starts.set(id, levels);
    restarts.set(id, resets);
    formats.set(id, ordered);
  }
  const counters = new Map<string, Map<string, number>>();
  return descendants(readXml(body), "p").map((paragraph) => {
    const properties = child(paragraph, "pPr");
    const style = styleChain(
      (properties && child(properties, "pStyle")?.attrs.val) ?? defaultStyle,
    );
    const chain = [properties, ...style.properties];
    const inheritedId = numberingValue(chain, "numId");
    const association = Array.from(style.ids)
      .flatMap((style) => byStyle.get(style) ?? [])
      .find((reference) => inheritedId === undefined || reference.id === inheritedId);
    const id = inheritedId ?? association?.id;
    const direct = numId(properties);
    const level =
      (direct && child(direct, "ilvl")?.attrs.val) ??
      association?.level ??
      numberingValue(chain, "ilvl") ??
      "0";
    const initial = starts.get(id ?? "")?.get(level) ?? 1;
    const values = counters.get(id ?? "") ?? new Map<string, number>();
    const start = values.get(level) ?? (Number.isSafeInteger(initial) ? initial : 1);
    if (id !== undefined && id !== "0") {
      values.set(level, start + 1);
      for (const deeper of values.keys()) {
        const restart = restarts.get(id)?.get(deeper) ?? Number(deeper) - 1;
        if (Number(level) < Number(deeper) && Number(level) <= restart) values.delete(deeper);
      }
      counters.set(id, values);
    }
    const ordered = formats.get(id ?? "")?.get(level);
    return {
      id,
      start,
      numbering: id !== "0" && ordered !== undefined ? { level, isOrdered: ordered } : null,
    };
  });
}
