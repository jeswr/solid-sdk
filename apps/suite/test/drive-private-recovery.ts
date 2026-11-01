// AUTHORED-BY Codex
import { expect } from "vitest";
import type { rdfPod } from "./drive-rdf-pod";

/** A failed compensation must retain durable bytes and prove their anonymous denial. */
export async function expectPrivateRecovery(f: Awaited<ReturnType<typeof rdfPod>>, body: string) {
  const matches: string[] = [];
  for (const [url] of f.pod.snapshot().resources) {
    if (!url.includes("/.drive-recovery-")) continue;
    if ((await (await f.pod.fetch(url)).text()) !== body) continue;
    matches.push(url);
    expect((await f.anonymous(url)).status).toBe(403);
  }
  expect(matches.length).toBeGreaterThan(0);
  return matches;
}
