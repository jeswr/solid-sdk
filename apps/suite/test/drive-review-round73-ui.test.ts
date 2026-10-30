// AUTHORED-BY Codex
import "./drive-ui-dom";
import { expect, it, vi } from "vitest";

vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DrivePartialFailureError } from "../src/apps/drive/lib/client/client";
import { TrashTraversalChangedError } from "../src/apps/drive/lib/operations/operations";
import { errorMessage } from "../src/apps/drive/state/ui";

it("round 73: stale traversal reports renewed confirmation and retained recovery in the UI", () => {
  const retained = "https://pod.test/.drive-recovery-captured/0-file";
  const error = new TrashTraversalChangedError(
    new DrivePartialFailureError(
      "https://pod.test/tree/",
      [],
      [],
      [retained],
      new Error("missing descendant"),
    ),
  );
  expect(errorMessage(error, "Couldn't delete")).toBe(
    `The folder changed during deletion. Refresh Trash and confirm deletion again. Private recovery copies: ${retained}`,
  );
});
