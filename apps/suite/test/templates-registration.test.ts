// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";

const fixtures = vi.hoisted(() => ({
  options: undefined as undefined | { onRegistrationError?: (reason: string) => void },
  warning: vi.fn(),
}));
vi.mock("@jeswr/storage-client", () => ({
  createPodClient: vi.fn(async () => ({ storage: {} })),
}));
vi.mock("@jeswr/suite-templates", () => ({
  createTemplateStore: vi.fn((options: typeof fixtures.options) => {
    fixtures.options = options;
    return {};
  }),
}));
vi.mock("@jeswr/suite-ui", () => ({ toast: { warning: fixtures.warning } }));

import { templatesForSession } from "../src/lib/templates/store";

describe("templates Type Index registration", () => {
  it("tells the user, without blocking, when registration fails", async () => {
    const session = {
      webId: "https://pod.example/profile#me",
      storageUrl: "https://pod.example/",
      fetch: vi.fn(),
    } as unknown as PodSession;
    await templatesForSession(session);
    fixtures.options?.onRegistrationError?.("forbidden");
    expect(fixtures.warning).toHaveBeenCalledOnce();
    expect(String(fixtures.warning.mock.calls[0]?.[0])).toMatch(/Type Index/);
  });
});
