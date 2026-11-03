// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { resolveRoute } from "../scripts/route-resolver.mjs";

const vectors = JSON.parse(
  await readFile(new URL("../../mobile/test/vectors/routes.json", import.meta.url), "utf8"),
);
it.each(vectors.cases)("resolves raw request $request", ({ request, path, status }) => {
  expect(resolveRoute(vectors.manifest, request)).toEqual({ path, status });
});
