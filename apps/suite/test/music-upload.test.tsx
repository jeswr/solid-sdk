// AUTHORED-BY Codex GPT-6
// biome-ignore-all assist/source/organizeImports: Establish the DOM before Radix imports.
import { act, click, h, mount } from "./drive-ui-dom";
import { expect, it, vi } from "vitest";
import { AddMusicFiles } from "../src/apps/music/components/add-files";
const music = vi.hoisted(() => ({ importFile: vi.fn() }));
vi.mock("../src/apps/music/state/music-context", () => ({ useMusic: () => music }));
it("reports already-owned uploads without an error and gives truthful failure guidance", async () => {
  music.importFile
    .mockResolvedValueOnce({ id: "track", status: "already-owned" })
    .mockResolvedValueOnce(false);
  const view = await mount(h(AddMusicFiles));
  const trigger = [...view.host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Add music files"),
  ) as HTMLButtonElement;
  await click(trigger);
  const input = document.querySelector("#mus-audio-files") as HTMLInputElement;
  const bytes = new Uint8Array([1, 2]).buffer;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [{ name: "song.wav", type: "audio/wav", arrayBuffer: async () => bytes }],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Added 0 songs. Already in your library: 1.",
  );
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(music.importFile).toHaveBeenCalledWith({ name: "song.wav", type: "audio/wav", bytes });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Couldn't add this file. Check the save message for details, then retry.",
  );
});

it("includes added and already-owned counts when a later file fails", async () => {
  music.importFile
    .mockResolvedValueOnce({ id: "new", status: "added" })
    .mockResolvedValueOnce({ id: "existing", status: "already-owned" })
    .mockResolvedValueOnce(false);
  const view = await mount(h(AddMusicFiles));
  await click(view.host.querySelector("button") as HTMLButtonElement);
  const input = document.querySelector("#mus-audio-files") as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: ["new.wav", "existing.wav", "failed.wav"].map((name) => ({
      name,
      type: "audio/wav",
      arrayBuffer: async () => new ArrayBuffer(1),
    })),
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Added 1 of 3 songs. Already in your library: 1.",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't add");
});
