// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  MAX_NOTIFICATION_BYTES,
  publicHttpsUrl,
  publicTransport,
  requireStrongEtag,
  roleFor,
} from "./index.js";

describe("public request helpers", () => {
  it.each([
    "http://public.example/profile",
    "https://localhost/profile",
    "https://app.local/profile",
    "https://192.168.1.1/profile",
    "https://127.0.0.1/profile",
    "https://[::1]/profile",
    "https://169.254.169.254/profile",
    "https://user:secret@public.example/profile",
    "file:///etc/passwd",
  ])("refuses non-public or insecure URL %s", (url) => {
    expect(() => publicHttpsUrl(url)).toThrow();
  });

  it("preserves a public WebID and bounds streamed public reads without Content-Length", async () => {
    const url = "https://public.example/profile#me";
    expect(publicHttpsUrl(url)).toBe(url);
    const cancel = vi.fn();
    const fetchFn = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_NOTIFICATION_BYTES));
              controller.enqueue(new Uint8Array(1));
            },
            cancel,
          }),
        ),
    );
    await expect(
      publicTransport(fetchFn)(url, { credentials: "include", redirect: "follow" }),
    ).rejects.toThrow("byte limit");
    expect(fetchFn).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
      }),
    );
    expect(cancel).toHaveBeenCalledOnce();
    await expect(
      publicTransport(async () => new Response(null, { status: 302 }))(url),
    ).rejects.toThrow("Redirect");
  });

  it("exports the same strong-validator and role rules used by decisions", () => {
    expect(() => requireStrongEtag('"v1"')).not.toThrow();
    for (const etag of [null, 'W/"v1"', "*", "v1", '"v1", "v2"', '"bad\r\nvalue"'])
      expect(() => requireStrongEtag(etag)).toThrow("strong ETag");
    expect(roleFor(["read"])).toBe("viewer");
    expect(roleFor(["append", "read"])).toBe("viewer");
    expect(roleFor(["write"])).toBe("editor");
    expect(roleFor(["read", "write", "append"])).toBe("editor");
    expect(() => roleFor(["append"])).toThrow("add data");
    expect(() => roleFor([])).toThrow();
  });
});
