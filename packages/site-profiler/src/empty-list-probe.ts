// AUTHORED-BY Codex GPT-6.1-Sol
// A saved search can hide every row and therefore the response schema. One bounded GET
// with that ordinary search cleared learns the same endpoint without changing preferences.
import type { RecordedRequest } from "./types.js";
import { isDangerousLink, isJsonType, tryJson } from "./util.js";

function emptyList(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 2) return false;
  return Object.entries(value).some(
    ([key, member]) =>
      (/^(items|results|data|products|hits|records|entries|list)$/i.test(key) &&
        Array.isArray(member) &&
        member.length === 0) ||
      (!Array.isArray(member) && emptyList(member, depth + 1)),
  );
}
export function emptyListProbe(sample: RecordedRequest): string | undefined {
  if (
    sample.method !== "GET" ||
    sample.blocked ||
    sample.bodyTruncated ||
    sample.status !== 200 ||
    !isJsonType(sample.contentType) ||
    isDangerousLink(sample.url) ||
    !emptyList(tryJson(sample.bodySample))
  )
    return undefined;
  const url = new URL(sample.url);
  let changed = false;
  for (const [name, value] of url.searchParams) {
    if (/^(q|query|search|keyword|keywords|term|s|text)$/i.test(name) && value !== "") {
      url.searchParams.set(name, "");
      changed = true;
    } else if (/page.?size|limit|per.?page/i.test(name) && /^\d+$/.test(value))
      url.searchParams.set(name, String(Math.min(Number(value), 25)));
  }
  return changed ? url.href : undefined;
}
