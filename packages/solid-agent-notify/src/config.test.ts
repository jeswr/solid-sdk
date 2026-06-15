// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * config.ts env-override branches. The constants are module-level (read once at
 * import), so we set the env and re-import a fresh module copy per assertion.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("config env overrides", () => {
  it("envInt honours a numeric override", async () => {
    vi.stubEnv("AGENT_NOTIFY_FETCH_TIMEOUT_MS", "1234");
    vi.resetModules();
    const m = await import("./config.js");
    expect(m.FETCH_TIMEOUT_MS).toBe(1234);
  });

  it("envInt falls back on a non-numeric override", async () => {
    vi.stubEnv("AGENT_NOTIFY_MAX_REDIRECTS", "not-a-number");
    vi.resetModules();
    const m = await import("./config.js");
    expect(m.MAX_REDIRECTS).toBe(3); // coded default
  });

  it("envInt falls back on an empty override", async () => {
    vi.stubEnv("AGENT_NOTIFY_MAX_BYTES_INBOX", "");
    vi.resetModules();
    const m = await import("./config.js");
    expect(m.MAX_BYTES_INBOX).toBe(64 * 1024);
  });

  it("envStr honours a user-agent override", async () => {
    vi.stubEnv("AGENT_NOTIFY_USER_AGENT", "custom-ua/9");
    vi.resetModules();
    const m = await import("./config.js");
    expect(m.FETCH_USER_AGENT).toBe("custom-ua/9");
  });

  it("the denylist override is parsed/trimmed/lowercased", async () => {
    vi.stubEnv(
      "AGENT_NOTIFY_HOSTNAME_DENYLIST",
      " Foo.Internal , bar.test ,, "
    );
    vi.resetModules();
    const m = await import("./config.js");
    expect(m.FETCH_HOSTNAME_DENYLIST).toEqual(["foo.internal", "bar.test"]);
  });

  it("exposes the coded defaults when no env is set", async () => {
    vi.resetModules();
    const m = await import("./config.js");
    expect(m.FETCH_TIMEOUT_MS).toBe(8000);
    expect(m.MAX_BYTES_PROFILE).toBe(256 * 1024);
    expect(m.MAX_BYTES_RESPONSE).toBe(16 * 1024);
    expect(m.AS).toBe("https://www.w3.org/ns/activitystreams#");
    expect(m.LDP_INBOX).toBe("http://www.w3.org/ns/ldp#inbox");
  });
});
