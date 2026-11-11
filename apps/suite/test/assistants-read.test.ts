// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { auditContainer, monthlyAuditSource } from "@jeswr/mcp-connections";
import { describe, expect, it, vi } from "vitest";
import { DEMO_ROOT } from "../src/lib/demo-pod/constants";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { seedAssistants } from "../src/lib/demo-pod/seed-assistants";
import type { PodSession } from "../src/lib/session/types";
import { auditRead } from "../src/shell/settings/assistants/read";

function session(fetch: typeof globalThis.fetch): PodSession {
  return {
    mode: "solid",
    fetch,
    publicFetch: fetch,
    webId: `${DEMO_ROOT}profile/card#me`,
    displayName: "Alice",
    storageUrl: DEMO_ROOT,
    subscribe: () => () => {},
  };
}
const signal = () => new AbortController().signal;
describe("assistant audit transport and demo fixture", () => {
  it("reads the real demo listing and projects only the fixture metadata", async () => {
    const now = Date.parse("2026-11-11T10:00:00Z");
    const seed = await seedAssistants(now);
    const pod = createDemoPod({ root: DEMO_ROOT, seed });
    const read = auditRead(session(pod.fetch), signal());
    const rows = await monthlyAuditSource.list(read, DEMO_ROOT, 100);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.client)).toEqual([
      "https://mcp.example/clients/demo",
      "https://assistant.example/app",
    ]);
    const fixture = await readFile(new URL("./fixtures/assistants.ttl", import.meta.url), "utf8");
    const projected = await monthlyAuditSource.list(
      (url) =>
        url === auditContainer(DEMO_ROOT)
          ? read(url)
          : Promise.resolve({ text: fixture, contentType: "text/turtle" }),
      DEMO_ROOT,
      100,
    );
    expect(rows).toEqual(projected);
    expect(JSON.stringify(projected)).not.toContain("value");
  });
  it("treats a missing demo container as empty", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    expect(
      await monthlyAuditSource.list(auditRead(session(pod.fetch), signal()), DEMO_ROOT, 100),
    ).toEqual([]);
  });
  it("bounds requests to the session and refuses redirects", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("", { headers: { "content-type": "text/turtle" } }),
    );
    const read = auditRead(session(fetch), signal());
    await expect(read("https://foreign.example/")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await read(auditContainer(DEMO_ROOT));
    expect(fetch).toHaveBeenCalledWith(
      auditContainer(DEMO_ROOT),
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    301, 302, 401, 403, 404, 410, 500,
  ])("preserves numeric status %s without backend details", async (status) => {
    const read = auditRead(
      session(async () => new Response("secret backend", { status })),
      signal(),
    );
    await expect(read(auditContainer(DEMO_ROOT))).rejects.toMatchObject({
      status,
      message: "Personal data reads unavailable",
    });
  });
  it.each(["redirected", "different final URL"])("rejects %s", async (kind) => {
    const response = new Response("secret");
    Object.defineProperty(response, kind === "redirected" ? "redirected" : "url", {
      value: kind === "redirected" ? true : "https://foreign.example/",
    });
    await expect(
      auditRead(
        session(async () => response),
        signal(),
      )(auditContainer(DEMO_ROOT)),
    ).rejects.toThrow("Personal data reads unavailable");
  });
  it("caps UTF-8 transport bytes and cancels oversized streams", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1));
      },
      cancel,
    });
    await expect(
      auditRead(
        session(async () => new Response(body)),
        signal(),
      )(auditContainer(DEMO_ROOT)),
    ).rejects.toThrow("Personal data reads unavailable");
    expect(cancel).toHaveBeenCalled();
    const exact = auditRead(
      session(async () => new Response("x".repeat(256 * 1024))),
      signal(),
    );
    expect((await exact(auditContainer(DEMO_ROOT))).text).toHaveLength(256 * 1024);
  });
  it("cancels a stalled body when the operation is aborted", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const read = auditRead(
      session(async () => new Response(body)),
      controller.signal,
    )(auditContainer(DEMO_ROOT));
    const rejected = expect(read).rejects.toThrow();
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalled();
  });
  it("handles null bodies and rejects invalid UTF-8 and an aborted read", async () => {
    expect(
      await auditRead(
        session(async () => new Response(null)),
        signal(),
      )(auditContainer(DEMO_ROOT)),
    ).toEqual({ text: "", contentType: "text/turtle" });
    await expect(
      auditRead(
        session(async () => new Response(new Uint8Array([255]))),
        signal(),
      )(auditContainer(DEMO_ROOT)),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      auditRead(
        session(async () => new Response("text")),
        controller.signal,
      )(auditContainer(DEMO_ROOT)),
    ).rejects.toThrow();
  });
});
