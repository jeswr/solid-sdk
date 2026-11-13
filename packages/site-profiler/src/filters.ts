// AUTHORED-BY Codex GPT-6
// A nested filter query observed on a JSON list supplies its wire prefix; rendered named
// controls on that request's referring page supply the individual filter keys. No endpoint guessed.
import { attr, descendants, parseHtml } from "./html.js";
import type { EndpointCandidate } from "./types.js";
import { varName } from "./util.js";

export function addFilterInputs(
  candidate: EndpointCandidate,
  pages: Array<{ url: string; html: string }>,
): EndpointCandidate {
  if (candidate.method !== "GET" || candidate.responseKind !== "json") return candidate;
  const root = candidate.params
    .map((p) => decodeURIComponent(p.name))
    .map((n) => /^(filters?)\[/.exec(n)?.[1])
    .find(Boolean);
  if (!root) return candidate;
  const referring = new Set(
    candidate.samples.map((s) => s.requestHeaders.referer?.replace(/[?#].*$/, "")).filter(Boolean),
  );
  const params = [...candidate.params];
  for (const page of pages) {
    if (!referring.has(page.url.replace(/[?#].*$/, ""))) continue;
    for (const el of descendants(parseHtml(page.html))) {
      const name = attr(el, "name");
      if (
        !name ||
        !/^[\w-]+(?:\[[\w-]+\])*$/.test(name) ||
        !["input", "select"].includes(el.name) ||
        attr(el, "disabled") !== undefined
      )
        continue;
      if (
        el.name === "input" &&
        !["text", "number", "date", "search"].includes(attr(el, "type") ?? "text")
      )
        continue;
      let parent = el.parent;
      let inForm = false;
      while (parent) {
        if ("name" in parent && parent.name === "form") inForm = true;
        parent = parent.parent;
      }
      if (inForm) continue; // Native forms are modeled separately, with their own method/action.
      const [head = "", ...tail] = name.split("[");
      const wire = name.startsWith(`${root}[`)
        ? name
        : `${root}[${head}]${tail.length ? `[${tail.join("[")}` : ""}`;
      const variable = varName(wire);
      if (!params.some((p) => p.name === variable))
        params.push({ name: variable, location: "query", examples: [], required: false });
    }
  }
  const base = candidate.urlTemplate.replace(/\{[?&][^}]*\}$/, "");
  const names = params.filter((p) => p.location === "query").map((p) => p.name);
  return {
    ...candidate,
    params,
    urlTemplate: `${base}${names.length ? `{${base.includes("?") ? "&" : "?"}${names.join(",")}}` : ""}`,
  };
}
