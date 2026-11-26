// AUTHORED-BY Claude Sonnet 5.5
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { ResourceAccess } from "@/lib/resource-acl";
import { SharingPanel } from "./sharing-panel";

const OWNER = "https://alice.example/profile/card#me";
const URL_ = "https://alice.example/inbox/";
const { state } = vi.hoisted(() => ({ state: { access: undefined as unknown } }));
vi.mock("@/components/use-resource-sharing", () => ({
  useResourceSharing: () => ({
    access: state.access,
    loading: false,
    ownerWebId: OWNER,
    backend: {},
    reload: vi.fn(),
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("public Read+Append is shown as Custom access, never as off", async () => {
  state.access = {
    resourceUrl: URL_,
    inherited: false,
    entries: [],
    custom: [{ subject: { kind: "public", id: "" }, modes: ["read", "append"], source: "direct" }],
    snapshot: {},
  } satisfies Omit<ResourceAccess, "snapshot"> & { snapshot: unknown };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<SharingPanel resourceUrl={URL_} />));
    await act(async () => {
      container.querySelector("button")?.click();
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Custom access");
    expect(text).toContain("Can view and add");
    expect(document.body.querySelector('[aria-label="Turn off Anyone on the web"]')).not.toBeNull();
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});
