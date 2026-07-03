// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureContainer, ensureDiaryReady, resetDiaryReadyMemo } from "./pod-fs";

const ROOT = "https://alice.example/";
const OWNER = "https://alice.example/profile/card#me";

/** A recording fetch: HEAD → 404 (create), PUT → 201. */
function recordingFetch() {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "HEAD") return new Response(null, { status: 404 });
    return new Response("", { status: 201 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

beforeEach(() => resetDiaryReadyMemo());

describe("ensureDiaryReady", () => {
  it("writes an OWNER-ONLY ACL on the diary root BEFORE any other container", async () => {
    const { fetch, calls } = recordingFetch();
    await ensureDiaryReady(fetch, ROOT, OWNER);

    const aclPut = calls.find((c) => c.method === "PUT" && c.url.endsWith("/health/diary/.acl"));
    expect(aclPut).toBeTruthy();
    // No public / agentClass grant anywhere in the ACL body (fail-closed).
    expect(aclPut?.body ?? "").not.toMatch(/agentClass|foaf:Agent|Public/i);
    // The owner IS granted.
    expect(aclPut?.body ?? "").toContain(OWNER);

    // The ACL is written before the meals container PUT.
    const aclIndex = calls.findIndex((c) => c.url.endsWith("/health/diary/.acl") && c.method === "PUT");
    const mealsIndex = calls.findIndex((c) => c.url.endsWith("/health/diary/meals/") && c.method === "PUT");
    expect(aclIndex).toBeGreaterThanOrEqual(0);
    expect(mealsIndex).toBeGreaterThan(aclIndex);
  });

  it("is memoised — a second call issues no further requests", async () => {
    const { fetch } = recordingFetch();
    await ensureDiaryReady(fetch, ROOT, OWNER);
    const countAfterFirst = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await ensureDiaryReady(fetch, ROOT, OWNER);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(countAfterFirst);
  });
});

describe("ensureContainer", () => {
  it("skips the PUT when the container already exists (HEAD 200)", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${input.toString()}`);
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    await ensureContainer(fetch, "https://alice.example/health/diary/");
    expect(calls.some((c) => c.startsWith("PUT"))).toBe(false);
  });
});
