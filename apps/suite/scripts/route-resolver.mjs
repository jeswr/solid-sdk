// AUTHORED-BY Codex GPT-6
/** Portable E3 reference. Native implementations consume this schema and the shared JSON vectors. */
export const reservedSuffix = (name) =>
  name === "index.html" || name === "index.txt" || /^__next\..+\.txt$/.test(name);

export function matchRoute(segments, values) {
  let index = 0;
  const rank = [];
  for (const segment of segments) {
    if (segment.type === "catch-all") {
      if (index === values.length && !segment.optional) return;
      while (index < values.length) {
        rank.push(1);
        index++;
      }
    } else {
      if (index === values.length) return;
      if (segment.type === "static" && segment.value !== values[index]) return;
      rank.push(segment.type === "static" ? 3 : 2);
      index++;
    }
  }
  if (index === values.length) return rank;
}

export function compareRank(left, right) {
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 3) - (right[i] ?? 3);
    if (difference) return difference;
  }
  return 0;
}

/** Validate the raw encoded path before decoding exactly once (never URL-normalise traversal away). */
export function requestSegments(path) {
  if (!path.startsWith("/") || new TextEncoder().encode(path).length > 2048) return;
  if (/[\\\0?#]/.test(path) || /%2f|%5c|%00/i.test(path)) return;
  try {
    const parts = path.split("/").slice(1);
    if (parts.at(-1) === "") parts.pop();
    const decoded = parts.map(decodeURIComponent);
    if (decoded.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part)))
      return;
    return decoded;
  } catch {
    return undefined;
  }
}

export function resolveRoute(manifest, path) {
  const missing = { path: "404.html", status: 404 };
  const values = requestSegments(path);
  if (!values) return missing;
  const exact = values.join("/");
  if (manifest.assets.includes(exact)) return { path: exact, status: 200 };
  const transport = reservedSuffix(values.at(-1) ?? "");
  const routeValues = transport ? values.slice(0, -1) : values;
  const file = transport ? values.at(-1) : "index.html";
  let best;
  for (const route of manifest.routes) {
    if (!route.files.includes(file)) continue;
    const rank = matchRoute(route.segments, routeValues);
    if (!rank) continue;
    if (!best || compareRank(rank, best.rank) > 0) best = { route, rank };
  }
  if (!best) return missing;
  return {
    path: [best.route.directory, file].filter(Boolean).join("/"),
    status: 200,
  };
}
