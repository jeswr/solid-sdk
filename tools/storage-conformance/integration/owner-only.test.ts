// AUTHORED-BY Claude Sonnet 5.5
import { checkOwnerOnly, checkOwnerOnlyAuto } from "@jeswr/pod-access";
import { addGrant } from "@jeswr/pod-access/roles";
import { expect, test } from "vitest";
import { container, text } from "../src/case-helpers.js";
import { cssTarget } from "../src/targets/css.js";

// Opt-in, socket-based: runs a real Community Solid Server 7.2.0 on a loopback port. It proves
// that an ordinary, discovered pod (whose capabilities carry no access-control model) answers
// "private or exposed" without the caller knowing server internals or wrapping `features`.
test("checkOwnerOnlyAuto answers private, then exposed once public read is granted", async () => {
  const running = await cssTarget.start();
  try {
    const folder = await container(running, `owner-only-${Date.now()}`);
    const note = await text(running.storage, folder);
    const options = { storage: running.storage, url: note.url, ownerWebId: running.webId };

    // The problem being fixed: discovery alone carries no model, so the plain check refuses.
    expect(running.storage.features.accessControl.state).not.toBe("available");
    expect(await checkOwnerOnly(options)).toMatchObject({
      private: false,
      reasons: [{ reason: "unsupported-model" }],
    });

    const before = await checkOwnerOnlyAuto(options);
    expect(before).toMatchObject({ private: true, detected: { model: "wac" } });
    // No own ACL yet: the root's default ACL decides.
    expect(before.decidedBy).toBe(before.detected.model === "wac" ? before.detected.decidedBy : "");
    expect(before.evaluated.length).toBeGreaterThan(0);

    const granted = await addGrant(
      [note.url],
      { agent: { type: "public" }, role: "viewer", inherited: false, source: note.url },
      { fetch: running.fetch, root: running.root, webId: running.webId },
    );
    expect(granted.failed).toEqual([]);

    const after = await checkOwnerOnlyAuto(options);
    expect(after).toMatchObject({
      private: false,
      reasons: [{ subject: "public", modes: ["read"], reason: "non-owner" }],
      detected: { model: "wac" },
    });
    // The resource now has its own ACL, and that document decided.
    expect(after.decidedBy).toMatch(/\.acl$/);
    expect(after.decidedBy).not.toBe(before.decidedBy);

    // The explicit-option route agrees, and a wrong explicit model is a typed error.
    expect(await checkOwnerOnly({ ...options, accessModel: "wac" })).toMatchObject({
      private: false,
    });
    await expect(
      checkOwnerOnly({ ...options, accessModel: "acp", acpDialect: "css" }),
    ).rejects.toMatchObject({ name: "OwnerOnlyConflictError", aspect: "model" });
  } finally {
    await running.stop();
  }
}, 120_000);
