// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { RedirectRefusedError, refuseRedirects } from "../src/refuseRedirects.js";

// unstorage-solid's old refusal includes nonstandard 3xx + Location responses.
// The shared wrapper must cover their union before the local wrapper is retired.
describe("legacy credentialed redirect refusal", () => {
  for (const location of ["", "https://evil.example/steal"]) {
    it.each([300, 305, 306, 309, 399])("refuses status %d with Location", async (status) => {
      const cancel = vi.fn();
      const inner = vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            status,
            headers: { location },
          }),
      );
      await expect(refuseRedirects(inner)("https://pod.example/alice/item")).rejects.toBeInstanceOf(
        RedirectRefusedError,
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(inner).toHaveBeenCalledOnce();
    });
  }

  it.each([300, 305, 306, 309, 399])("passes status %d without Location", async (status) => {
    const response = new Response(null, { status });
    expect(await refuseRedirects(async () => response)("https://pod.example/alice/item")).toBe(
      response,
    );
  });

  it("passes 304 even with Location", async () => {
    const response = new Response(null, { status: 304, headers: { location: "/other" } });
    expect(await refuseRedirects(async () => response)("https://pod.example/alice/item")).toBe(
      response,
    );
  });
});
