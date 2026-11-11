// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import type { DriveClient } from "../src/apps/drive/lib/client/client";
import { useUploadQueue } from "../src/apps/drive/state/uploads";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

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

// AUTHORED-BY Claude Opus 5.5
it("retries an upload cut off by expiry with the reauthenticated session's client, not the retired one", async () => {
  const { createShareInbox } = await import("@jeswr/suite-native");
  const { ShareBatchView } = await import("../src/apps/drive/components/share-screen");
  const { createShareIntake } = await import("../src/shell/share/intake");
  const { DriveError } = await import("../src/apps/drive/lib/client/client");
  const batch = {
    id: "reauth-batch",
    receivedAt: "2026-11-11T12:00:00Z",
    items: [{ kind: "file" as const, name: "report.txt", mimeType: "text/plain", size: 5 }],
  };
  const acknowledge = vi.fn(async () => {});
  const intake = createShareIntake(async () =>
    createShareInbox({
      getPending: async () => ({ batches: [batch] }),
      acknowledge,
      readChunk: async () => ({ data: btoa("hello"), eof: true }),
      addListener: async () => ({ remove: async () => {} }),
    }),
  );
  await act(() => intake.refresh());
  // The expired session's client fails; reauthentication yields a new session and client while
  // DriveProvider keeps the same queue (same mode, WebID and storage).
  const retired = {
    write: vi.fn(async () => {
      throw new DriveError("unauthenticated", 401, "https://pod.example/drive/report.txt");
    }),
  } as unknown as DriveClient;
  // Retry re-reads the target before writing; nothing exists there yet.
  const renewed = {
    stat: vi.fn(async (url: string) => {
      throw new DriveError("not-found", 404, url);
    }),
    write: vi.fn(async () => ({ etag: '"1"' })),
  } as unknown as DriveClient;
  function Harness({ client }: { client: DriveClient }) {
    const uploads = useUploadQueue(client, () => {});
    return h(ShareBatchView, {
      intake,
      batch,
      uploads,
      folder: "https://pod.example/drive/",
      saveLink: vi.fn(),
      saveText: vi.fn(),
    });
  }
  const view = await mount(h(Harness, { client: retired }));
  const button = (label: RegExp) =>
    [...view.host.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""));
  await click(button(/^Save to Drive$/) as Element);
  await vi.waitFor(() => expect(button(/^Retry Save to Drive$/)).toBeDefined());
  expect(retired.write).toHaveBeenCalledTimes(1);

  await view.render(h(Harness, { client: renewed }));
  await click(button(/^Retry Save to Drive$/) as Element);
  await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
  expect(retired.write).toHaveBeenCalledTimes(1);
  expect(renewed.write).toHaveBeenCalledTimes(1);
  await view.unmount();
});

// AUTHORED-BY Claude Opus 5.5
it("starts a retry that waited for a slot with the current client when an older upload finishes", async () => {
  const { DriveError } = await import("../src/apps/drive/lib/client/client");
  const folder = "https://pod.example/drive/";
  const pending = [deferred<void>(), deferred<void>(), deferred<void>()];
  let started = 0;
  const retired = {
    write: vi.fn(async (url: string) => {
      if (url.endsWith("/expired.txt")) throw new DriveError("unauthenticated", 401, url);
      await pending[started++]?.promise;
    }),
  } as unknown as DriveClient;
  const renewed = {
    stat: vi.fn(async (url: string) => {
      throw new DriveError("not-found", 404, url);
    }),
    write: vi.fn(async () => {}),
  } as unknown as DriveClient;
  let queue!: ReturnType<typeof useUploadQueue>;
  function Probe({ client }: { client: DriveClient }) {
    queue = useUploadQueue(client, () => {});
    return null;
  }
  const view = await mount(h(Probe, { client: retired }));
  await act(() => queue.enqueue(folder, [new File(["x"], "expired.txt")]));
  const expired = queue.tasks.find((task) => task.name === "expired.txt");
  expect(expired?.status).toBe("failed");
  // Three older uploads hold every slot while the session is renewed.
  await act(() =>
    queue.enqueue(
      folder,
      ["a.txt", "b.txt", "c.txt"].map((name) => new File(["x"], name)),
    ),
  );
  expect(queue.tasks.filter((task) => task.status === "uploading")).toHaveLength(3);

  await view.render(h(Probe, { client: renewed }));
  await act(() => queue.retry(expired?.id as string));
  expect(queue.tasks.find((task) => task.id === expired?.id)?.status).toBe("queued");

  // An older attempt's completion frees a slot and must start the retry with the renewed client.
  await act(() => pending[0]?.resolve());
  await vi.waitFor(() =>
    expect(queue.tasks.find((task) => task.id === expired?.id)?.status).toBe("done"),
  );
  expect(renewed.write).toHaveBeenCalledWith(
    `${folder}expired.txt`,
    expect.any(Blob),
    expect.anything(),
    expect.anything(),
  );
  expect(retired.write).toHaveBeenCalledTimes(4);
  await act(() => {
    pending[1]?.resolve();
    pending[2]?.resolve();
  });
  await view.unmount();
});
