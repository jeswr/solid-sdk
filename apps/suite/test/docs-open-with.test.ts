// AUTHORED-BY Codex
import { describe, expect, it, vi } from "vitest";
import { importDocument } from "../src/apps/docs/editor/import-document";
import { openWithDocs } from "../src/apps/docs/hooks/open-with-docs";
import type { PodSession } from "../src/lib/session/pod-session";

vi.mock("../src/apps/docs/editor/import-document", async (original) => {
  // Keep the file validation real; only persistence/DOM are outside this hook's contract.
  const actual = await original<typeof import("../src/apps/docs/editor/import-document")>();
  return {
    ...actual,
    importDocument: vi.fn(async () => ({ url: "https://pod.test/docs/plan.ttl", skipped: [] })),
  };
});
const session = (fetchImpl: typeof fetch) =>
  ({ storageUrl: "https://pod.test/", fetch: fetchImpl }) as PodSession;
describe("Drive's exported Open with Docs hook", () => {
  it("fetches a selected pod file without redirects and hands it to the shared importer", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("# Plan", { headers: { "content-type": "text/markdown" } }),
    );
    const progress = vi.fn();
    const result = await openWithDocs(
      { url: "https://pod.test/drive/plan.md", name: "plan.md" },
      session(fetchImpl),
      progress,
    );
    expect(result.url).toBe("https://pod.test/docs/plan.ttl");
    expect(fetchImpl).toHaveBeenCalledWith("https://pod.test/drive/plan.md", { redirect: "error" });
    const file = vi.mocked(importDocument).mock.calls[0]?.[0];
    expect(file?.name).toBe("plan.md");
    expect(await file?.text()).toBe("# Plan");
    expect(importDocument).toHaveBeenCalledWith(file, session(fetchImpl), progress);
  });
  it("rejects other origins, credentials, unsupported files and failed reads", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }));
    for (const url of [
      "https://evil.test/file.docx",
      "https://u:p@pod.test/file.docx",
      "file:///file.docx",
    ]) {
      await expect(
        openWithDocs({ url, name: "file.docx" }, session(fetchImpl), vi.fn()),
      ).rejects.toThrow("pod");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      openWithDocs(
        { url: "https://pod.test/file.exe", name: "file.exe" },
        session(fetchImpl),
        vi.fn(),
      ),
    ).rejects.toThrow("DOCX or Markdown");
    await expect(
      openWithDocs(
        { url: "https://pod.test/file.docx", name: "file.docx" },
        session(fetchImpl),
        vi.fn(),
      ),
    ).rejects.toThrow("couldn't open");
  });
});
