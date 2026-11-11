// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import type { DriveClient } from "../src/apps/drive/lib/client/client";
import { useUploadQueue } from "../src/apps/drive/state/uploads";
import { act, deferred, h, mount } from "./drive-ui-dom";

it("preserves the native MIME and reports successful queue completion after the screen unmounts", async () => {
  const pending = deferred<void>();
  const write = vi.fn(() => pending.promise);
  const client = { write } as unknown as DriveClient;
  let queue!: ReturnType<typeof useUploadQueue>;
  function Probe() {
    queue = useUploadQueue(client, () => {});
    return null;
  }
  const screen = await mount(h(Probe));
  const onChange = vi.fn();
  await act(() =>
    queue.enqueue(
      "https://pod.example/drive/",
      [new File(["<svg/>"], "incoming.svg", { type: "application/octet-stream" })],
      { onChange, preserveContentType: true },
    ),
  );
  expect(write).toHaveBeenCalledWith(
    "https://pod.example/drive/incoming.svg",
    expect.any(Blob),
    { contentType: "application/octet-stream", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  expect(onChange.mock.calls.map(([task]) => task.status)).toEqual(["queued", "uploading"]);
  await screen.unmount();
  await act(() => pending.resolve());
  expect(onChange.mock.lastCall?.[0].status).toBe("done");
});
