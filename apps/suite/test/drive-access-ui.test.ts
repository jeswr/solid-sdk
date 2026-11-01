// AUTHORED-BY Codex
import "./drive-ui-dom";

import { expect, it } from "vitest";
import type { AccessChange, ConfirmAccess } from "../src/apps/drive/lib/client/access";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { useAccessConfirmation } from "../src/apps/drive/state/access-confirmation";
import { act, click, h, key, mount } from "./drive-ui-dom";
import { PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

function Harness({ ready }: { ready: (confirm: ConfirmAccess) => void }) {
  const { confirmAccess, dialog } = useAccessConfirmation();
  ready(confirmAccess);
  return dialog;
}
const change: AccessChange = {
  from: `${PRIVATE}secret`,
  to: `${PUBLIC}secret`,
  gains: ["Everyone (public)"],
  canKeep: true,
};
function button(text: string) {
  const found = [...document.querySelectorAll("button")].find((node) => node.textContent === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
it.each([
  "Cancel",
  "Move",
  "Move and keep current access",
])("WAC move dialog names access gains, focuses Cancel and supports %s", async (choice) => {
  const f = await wacPod();
  let confirm!: ConfirmAccess;
  await mount(
    h(Harness, {
      ready: (value) => {
        confirm = value;
      },
    }),
  );
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    confirmAccess: (c) => confirm(c),
  });
  let result!: Promise<unknown>;
  await act(async () => {
    result = client.move(change.from, change.to, { kind: "confirm-move" }).catch((error) => error);
  });
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog).not.toBeNull();
  expect(
    document.getElementById(dialog?.getAttribute("aria-labelledby") as string)?.textContent,
  ).toBe("Change who can access?");
  expect(
    document.getElementById(dialog?.getAttribute("aria-describedby") as string)?.textContent,
  ).toContain("Everyone (public)");
  expect(document.activeElement).toBe(button("Cancel"));
  await click(button(choice));
  await result;
  expect(f.pod.has(change.from)).toBe(choice === "Cancel");
  expect(f.pod.has(change.to)).toBe(choice !== "Cancel");
  if (choice !== "Cancel")
    expect((await f.anonymous(change.to)).status).toBe(choice === "Move" ? 200 : 403);
});
it("unknown access disables Keep; Escape and unmount cancel pending and queued moves", async () => {
  let confirm!: ConfirmAccess;
  const view = await mount(
    h(Harness, {
      ready: (value) => {
        confirm = value;
      },
    }),
  );
  let first!: ReturnType<ConfirmAccess>, second!: ReturnType<ConfirmAccess>;
  await act(async () => {
    first = confirm({ ...change, canKeep: false });
    second = confirm(change);
  });
  expect(button("Move and keep current access").disabled).toBe(true);
  await key(document.activeElement as Element, "Escape");
  expect(await first).toBe("cancel");
  await view.unmount();
  expect(await second).toBe("cancel");
});
