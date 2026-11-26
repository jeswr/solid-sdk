// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import { CSS_ROOT } from "./fixtures/css.js";
import { LWS_CONTAINER, LWS_ROOT } from "./fixtures/lws.js";
import { createLwsBackend } from "./lws.js";
import { createMemoryStorage } from "./memory.js";
import { createSolidBackend } from "./solid.js";
import type { AuthFetch, StorageClient } from "./types.js";

async function expectAborted(promise: Promise<unknown>, reason: unknown) {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(StorageError);
  expect((error as StorageError).code).toBe("network");
  expect((error as StorageError).retryable).toBe(false);
  expect((error as StorageError).cause).toBe(reason);
}

const lwsTarget = `${LWS_CONTAINER}child/`;

describe("StorageClient.parentOf honours AbortSignal", () => {
  const cases: [
    string,
    () => { client: StorageClient; fetch?: ReturnType<typeof vi.fn> },
    string,
  ][] = [
    [
      "memory (solid)",
      () => ({ client: createMemoryStorage({ root: CSS_ROOT }) }),
      `${CSS_ROOT}a/b`,
    ],
    [
      "memory (lws)",
      () => ({ client: createMemoryStorage({ root: LWS_ROOT, protocol: "lws" }) }),
      `${LWS_ROOT}a/`,
    ],
    [
      "solid backend",
      () => {
        const fetch = vi.fn<AuthFetch>(async () => new Response(null, { status: 200 }));
        return { client: createSolidBackend({ root: CSS_ROOT, fetch }), fetch };
      },
      `${CSS_ROOT}a/b`,
    ],
    [
      "lws backend",
      () => {
        const fetch = vi.fn<AuthFetch>(async () => new Response(null, { status: 200 }));
        return { client: createLwsBackend({ root: LWS_ROOT, fetch }), fetch };
      },
      lwsTarget,
    ],
  ];

  test.each(cases)("%s rejects when aborted before the call", async (_name, make, url) => {
    const { client, fetch } = make();
    const reason = new Error("stop");
    await expectAborted(client.parentOf(url, { signal: AbortSignal.abort(reason) }), reason);
    if (fetch) expect(fetch).not.toHaveBeenCalled();
  });

  test("lws backend cancels an in-flight HEAD and hands the signal to fetch", async () => {
    const controller = new AbortController();
    const reason = new Error("mid-flight");
    const fetch = vi.fn<AuthFetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const client = createLwsBackend({ root: LWS_ROOT, fetch });
    const pending = client.parentOf(lwsTarget, { signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort(reason);
    await expectAborted(pending, reason);
  });
});
