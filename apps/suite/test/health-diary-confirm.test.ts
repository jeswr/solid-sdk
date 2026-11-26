// AUTHORED-BY Claude Sonnet 5.5
// AUTHORED-BY Codex GPT-6.2-Astra
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createPodClient: vi.fn() }));
vi.mock("@jeswr/storage-client", () => ({ createPodClient: mocks.createPodClient }));
vi.mock("@jeswr/pod-access", () => ({
  // Discovery failures surface exactly where the real helper opens storage.
  createOwnerOnlyDestinationChecks: (options: { openStorage: () => Promise<unknown> }) => ({
    confirmPrivateWrite: async () => {
      await options.openStorage();
      return true;
    },
  }),
}));
const { createPrivateWriteConfirmer, DiaryPrivacyError } = await import(
  "../src/apps/health/lib/data/diary-confirm"
);
const ROOT = "https://confirm.test/";
const written = () => new Response(null, { status: 201, headers: { etag: '"v1"' } });

beforeEach(() => mocks.createPodClient.mockReset());

it("leaves the new file unconfirmed when the write has no ETag and HEAD fails", async () => {
  const url = `${ROOT}health/diary/2026-11/a.ttl`;
  const fetch = vi.fn(
    async () => new Response(null, { status: 503, headers: { etag: '"error"' } }),
  );
  const confirm = createPrivateWriteConfirmer(fetch, ROOT, `${ROOT}profile#me`);

  await expect(confirm(url, new Response(null, { status: 201 }))).rejects.toMatchObject({
    name: "DiaryPrivacyError",
    removed: false,
  });
  expect(fetch.mock.calls).toEqual([[url, { method: "HEAD", redirect: "error" }]]);
  expect(mocks.createPodClient).not.toHaveBeenCalled();
});

it("does not cache a failed storage discovery, so the next write retries it", async () => {
  mocks.createPodClient
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValue({ storage: {} });
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const confirm = createPrivateWriteConfirmer(fetch, ROOT, `${ROOT}profile#me`);
  const url = `${ROOT}health/diary/2026-11/a.ttl`;
  await expect(confirm(url, written())).rejects.toBeInstanceOf(DiaryPrivacyError);
  await expect(confirm(url, written())).resolves.toBeUndefined();
  expect(mocks.createPodClient).toHaveBeenCalledTimes(2);
  // Successful discovery is then reused for the life of the store.
  await expect(confirm(url, written())).resolves.toBeUndefined();
  expect(mocks.createPodClient).toHaveBeenCalledTimes(2);
});
