// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { walletVerification } from "@/apps/wallet/lib/data/client";
import type { PodSession } from "@/lib/session/pod-session";

it("uses only the unauthenticated public transport for a real issuer lookup", async () => {
  const authenticated = vi.fn();
  const publicFetch = vi.fn(async () => new Response(null, { status: 404 }));
  const session = { mode: "solid", fetch: authenticated, publicFetch } as unknown as PodSession;
  const options = walletVerification(session, new Date("2026-11-11"));
  await options.resolveKey("https://academy.example/profile#key");
  expect(authenticated).not.toHaveBeenCalled();
  expect(publicFetch).toHaveBeenCalled();
});

it("a real session with unavailable storage discovery never falls back to the demo", async () => {
  const { openWallet } = await import("@/apps/wallet/lib/data/client");
  const fetch = vi.fn(async () => new Response(null, { status: 404 }));
  const session = {
    mode: "solid",
    fetch,
    publicFetch: fetch,
    storageUrl: "https://unavailable.example/",
    webId: "https://unavailable.example/profile#me",
  } as unknown as PodSession;
  await expect(openWallet(session)).rejects.toThrow();
  expect(fetch).toHaveBeenCalled();
});
