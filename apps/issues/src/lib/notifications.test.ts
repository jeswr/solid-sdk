import { describe, it, expect } from "vitest";
import { subscriptionRequest, changedResource } from "./notifications";

describe("notifications helpers", () => {
  it("builds a WebSocketChannel2023 subscription request", () => {
    const body = JSON.parse(subscriptionRequest("http://localhost:3000/alice/issue-tracker/issues/"));
    expect(body.type).toBe("http://www.w3.org/ns/solid/notification#WebSocketChannel2023");
    expect(body.topic).toBe("http://localhost:3000/alice/issue-tracker/issues/");
    expect(body["@context"]).toContain("notifications-context");
  });

  it("extracts the changed resource from a notification (string or object)", () => {
    expect(changedResource({ type: "Update", object: "http://x/issues/1.ttl" })).toBe("http://x/issues/1.ttl");
    expect(changedResource({ type: "Add", object: { id: "http://x/issues/2.ttl" } })).toBe("http://x/issues/2.ttl");
    expect(changedResource({ type: "Delete" })).toBeUndefined();
  });
});
