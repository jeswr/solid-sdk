// AUTHORED-BY Codex GPT-6.1-Sol
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createReactiveAuthController } from "@jeswr/solid-elements/auth";
import { flushOutbox } from "@/lib/diary/sync";
import { ensureDiaryReady } from "@/lib/pod/pod-fs";
import { createSessionStorage } from "@/lib/pod/client";
import { resolveStorageRoot } from "@/lib/pod/storage";
import { registerDiaryTypes } from "@/lib/pod/type-index";
import { SessionProvider } from "./session-provider";

vi.mock("@jeswr/solid-elements/auth", () => ({ createReactiveAuthController: vi.fn() }));
vi.mock("@solid/reactive-authentication/registerElements", () => ({}));
vi.mock("@/lib/pod/client", () => ({ createSessionStorage: vi.fn() }));
vi.mock("@/lib/pod/storage", () => ({ resolveStorageRoot: vi.fn() }));
vi.mock("@/lib/pod/pod-fs", async (original) => ({
  ...await original<typeof import("@/lib/pod/pod-fs")>(), ensureDiaryReady: vi.fn(),
}));
vi.mock("@/lib/pod/type-index", () => ({ registerDiaryTypes: vi.fn() }));
vi.mock("@/lib/diary/sync", () => ({ flushOutbox: vi.fn() }));
vi.mock("./login-area", () => ({ LoginArea: () => <div>Sign in</div> }));

beforeEach(() => vi.clearAllMocks());

it("shows registration failure while keeping logging and outbox flush available", async () => {
  const fetch = vi.fn();
  const storage = vi.fn();
  vi.mocked(createReactiveAuthController).mockReturnValue({
    webId: "https://id.inrupt.com/alice#me",
    authenticatedFetch: fetch, publicFetch: vi.fn(),
    restore: vi.fn(async () => ({ outcome: "restored" })),
  } as unknown as ReturnType<typeof createReactiveAuthController>);
  vi.mocked(resolveStorageRoot).mockResolvedValue("https://storage.inrupt.com/alice/");
  vi.mocked(createSessionStorage).mockReturnValue(storage);
  vi.mocked(ensureDiaryReady).mockResolvedValue();
  vi.mocked(registerDiaryTypes).mockRejectedValue(new Error("Permission denied"));
  vi.mocked(flushOutbox).mockResolvedValue({ synced: 0, failed: 0 });
  render(<SessionProvider><div>Meal logging</div></SessionProvider>);
  expect(await screen.findByText("Meal logging")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't register.*diary/i);
  await waitFor(() => expect(flushOutbox).toHaveBeenCalled());
  expect(registerDiaryTypes).toHaveBeenCalledWith(storage, expect.objectContaining({ fetch }));
});
