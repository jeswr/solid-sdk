import { describe, it, expect } from "vitest";
import { activityLabel, notificationTitle, hostOf, formatPublished } from "./inbox-display";
import type { InboxNotification } from "./inbox";

const AS = "https://www.w3.org/ns/activitystreams#";

describe("activityLabel", () => {
  it("maps known AS2 types to short labels", () => {
    expect(activityLabel([`${AS}Announce`])).toBe("announced");
    expect(activityLabel([`${AS}Add`])).toBe("added");
    expect(activityLabel([`${AS}Mention`])).toBe("mentioned you in");
  });

  it("lower-cases the local name of an unrecognised AS2 type", () => {
    expect(activityLabel([`${AS}Travel`])).toBe("travel");
  });

  it("falls back to 'notification' for a non-AS / empty type set", () => {
    expect(activityLabel([])).toBe("notification");
    expect(activityLabel(["http://example.org/Custom"])).toBe("notification");
  });
});

describe("notificationTitle", () => {
  const base: InboxNotification = { url: "https://pod.example/alice/inbox/n.ttl", types: [`${AS}Announce`] };

  it("uses the notification's own summary when present", () => {
    expect(notificationTitle({ ...base, summary: "Bob assigned you #42" })).toBe("Bob assigned you #42");
  });

  it("derives a sentence from actor + label + object when no summary", () => {
    const n = { ...base, actor: "https://bob.example/profile#me", object: "https://pod.example/alice/issues/42.ttl" };
    expect(notificationTitle(n)).toBe("bob.example announced pod.example");
  });

  it("never returns an empty string", () => {
    expect(notificationTitle({ url: "x", types: [] })).toBe("Someone notification");
  });
});

describe("hostOf / formatPublished", () => {
  it("returns the host of a URL, or the raw value when unparseable", () => {
    expect(hostOf("https://bob.example/profile#me")).toBe("bob.example");
    expect(hostOf("not a url")).toBe("not a url");
  });

  it("formats a valid ISO timestamp and returns undefined for an invalid/absent one", () => {
    expect(formatPublished("2026-06-15T00:00:00Z")).toBeTruthy();
    expect(formatPublished("nonsense")).toBeUndefined();
    expect(formatPublished(undefined)).toBeUndefined();
  });
});
