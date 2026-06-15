import { describe, it, expect } from "vitest";
import { subscriptionRequest, changedResource } from "./notifications";
import { WEBSOCKET_CHANNEL_TYPE } from "./notification-discovery";

describe("notifications helpers", () => {
  it("builds a WebSocketChannel2023 subscription request", () => {
    const body = JSON.parse(subscriptionRequest("http://localhost:3000/alice/issue-tracker/issues/"));
    // The POST `type` MUST be the plural `notifications#` namespace — the same
    // channel-type IRI discovery matches on — or a conforming server rejects it.
    expect(body.type).toBe("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023");
    expect(body.topic).toBe("http://localhost:3000/alice/issue-tracker/issues/");
    expect(body["@context"]).toContain("notifications-context");
  });

  it("posts the SAME channel-type IRI that discovery matches on (no namespace drift)", () => {
    // Round-trip guard: the discovered/matched channel type and the subscription
    // POST body's `type` are one and the same exported constant, so they cannot
    // drift into the singular `notification#` vs plural `notifications#` mismatch.
    const body = JSON.parse(subscriptionRequest("http://x/c/"));
    expect(body.type).toBe(WEBSOCKET_CHANNEL_TYPE);
    expect(WEBSOCKET_CHANNEL_TYPE).toBe("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023");
  });

  it("extracts the changed resource from a notification (string or object)", () => {
    expect(changedResource({ type: "Update", object: "http://x/issues/1.ttl" })).toBe("http://x/issues/1.ttl");
    expect(changedResource({ type: "Add", object: { id: "http://x/issues/2.ttl" } })).toBe("http://x/issues/2.ttl");
    expect(changedResource({ type: "Delete" })).toBeUndefined();
  });
});
