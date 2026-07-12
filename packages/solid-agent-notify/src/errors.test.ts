// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import {
  AgentNotifyError,
  InboxScopeError,
  NoInboxError,
  NotificationSendError,
} from "./errors.js";

describe("domain errors", () => {
  it("AgentNotifyError carries a cause", () => {
    const cause = new Error("root");
    const e = new AgentNotifyError("boom", { cause });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AgentNotifyError");
    expect(e.cause).toBe(cause);
  });

  it("NoInboxError carries the webId and is an AgentNotifyError", () => {
    const e = new NoInboxError("https://alice.example/card#me");
    expect(e).toBeInstanceOf(AgentNotifyError);
    expect(e.name).toBe("NoInboxError");
    expect(e.webId).toBe("https://alice.example/card#me");
    expect(e.message).toContain("alice.example");
  });

  it("NotificationSendError carries inbox + status (+ optional cause)", () => {
    const cause = new Error("ssrf");
    const e = new NotificationSendError("https://bob.example/inbox/", 0, {
      cause,
    });
    expect(e).toBeInstanceOf(AgentNotifyError);
    expect(e.name).toBe("NotificationSendError");
    expect(e.inbox).toBe("https://bob.example/inbox/");
    expect(e.status).toBe(0);
    expect(e.cause).toBe(cause);

    const e2 = new NotificationSendError("https://bob.example/inbox/", 403);
    expect(e2.status).toBe(403);
    expect(e2.message).toContain("403");
  });

  it("InboxScopeError carries url + container", () => {
    const e = new InboxScopeError(
      "https://evil.example/x",
      "https://pod.example/inbox/"
    );
    expect(e).toBeInstanceOf(AgentNotifyError);
    expect(e.name).toBe("InboxScopeError");
    expect(e.url).toBe("https://evil.example/x");
    expect(e.container).toBe("https://pod.example/inbox/");
  });
});
