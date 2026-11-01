// AUTHORED-BY Codex
import "./drive-ui-dom";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import type { ConfirmAccess } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { useAccessConfirmation } from "../src/apps/drive/state/access-confirmation";
import { rdfPod } from "./drive-rdf-pod";
import { act, click, h, mount } from "./drive-ui-dom";
import { OWNER, PRIVATE, PUBLIC, ROOT } from "./drive-wac-pod";

function Harness({ ready }: { ready: (confirm: ConfirmAccess) => void }) {
  const { confirmAccess, dialog } = useAccessConfirmation();
  ready(confirmAccess);
  return dialog;
}

it.each([
  "before queue",
  "queued",
])("round 72: unmount %s cancels Move and releases source reservations for retry", async (timing) => {
  const f = await rdfPod();
  const from = `${PRIVATE}late-${timing.replaceAll(" ", "-")}`;
  const to = `${PUBLIC}late-${timing.replaceAll(" ", "-")}`;
  await f.pod.fetch(from, { method: "PUT", body: "private contents" });
  let confirm!: ConfirmAccess;
  const view = await mount(
    h(Harness, {
      ready: (value) => {
        confirm = value;
      },
    }),
  );
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached = false;
  let gated = true;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === from && !init?.method && gated) {
      gated = false;
      reached = true;
      await blocked;
    }
    return f.fetch(input, init);
  };
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch,
    webId: OWNER,
    confirmAccess: (change) => confirm(change),
  });
  let outcome: unknown;
  const moving = client.move(from, to, { kind: "confirm-move" }).then(
    (value) => {
      outcome = value;
    },
    (error: unknown) => {
      outcome = error;
    },
  );
  await vi.waitFor(() => expect(reached).toBe(true));
  if (timing === "queued") {
    release();
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector('[role="alertdialog"]'), String(outcome)).not.toBeNull();
    });
  }
  await view.unmount();
  release();
  await vi.waitFor(() => expect(outcome).toBeInstanceOf(Error));
  await moving;
  expect((outcome as Error).message).toBe("Move cancelled");
  expect(f.calls.some(({ method }) => ["PUT", "DELETE"].includes(method))).toBe(false);
  expect(f.pod.has(from)).toBe(true);
  expect(f.pod.has(to)).toBe(false);
  await mount(
    h(
      StrictMode,
      null,
      h(Harness, {
        ready: (value) => {
          confirm = value;
        },
      }),
    ),
  );
  const retry = client.move(from, to, { kind: "confirm-move" }).catch((error: unknown) => error);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="alertdialog"]'), String(outcome)).not.toBeNull();
  });
  const cancel = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel",
  );
  if (!cancel) throw new Error("Missing cancellation");
  await click(cancel);
  expect(((await retry) as Error).message).toBe("Move cancelled");
});
