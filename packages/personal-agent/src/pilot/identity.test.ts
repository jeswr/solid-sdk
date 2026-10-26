/**
 * Phase-2 review item 5: identifiers are constructed as valid IRIs at their origin, the same
 * identity is used on the wire, in the ledger and in RDF, and signed claims minted by earlier
 * pilot versions are refused (explicit re-initialisation), never silently rewritten.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./cli.js";
import { isIri, scopedUrn } from "./core/canonical.js";
import { DEFAULT_LIMITS } from "./core/limits.js";
import { schedulingMandate } from "./mandates.js";
import { loadMandate, signMandate } from "./mechanisms/mandate.js";
import { TrustStore } from "./mechanisms/trust.js";
import { ledgerToRdf } from "./rdf/evidence.js";
import { BOB, fixedClock, personalPair, provisionPair } from "./scenarios/personal.js";
import { readAgent, readOwnerKey } from "./setup.js";

const WITH_FRAGMENT = "https://agents.alice.example/personal#agent";
const WITHOUT_FRAGMENT = "https://agents.alice.example/personal/agent";

describe("review item 5 — identifier construction and identity across views", () => {
  it("mints valid, distinct, deterministic ids for actors with and without fragments", () => {
    const a = scopedUrn("mandate", WITH_FRAGMENT, "scheduling");
    const b = scopedUrn("mandate", WITHOUT_FRAGMENT, "scheduling");
    expect(isIri(a) && isIri(b)).toBe(true);
    expect(a).not.toBe(b);
    expect(scopedUrn("mandate", WITH_FRAGMENT, "scheduling")).toBe(a);
    expect(a).toMatch(/^urn:awp:mandate:[0-9a-f]{32}:scheduling$/);
    for (const actor of [WITH_FRAGMENT, WITHOUT_FRAGMENT]) {
      const m = schedulingMandate([BOB.party])({
        owner: "https://alice.example/#me",
        actor,
        validFrom: "2026-10-19T00:00:00Z",
        validUntil: "2026-11-19T00:00:00Z",
      });
      const ids = [
        m.id,
        m.autonomous.id,
        m.withApproval.id,
        ...(m.autonomous.permissions ?? []).map((r) => r.id as string),
        ...(m.autonomous.prohibitions ?? []).map((r) => r.id as string),
      ];
      expect(ids.every(isIri), ids.join(" ")).toBe(true);
    }
    expect(isIri(`${WITH_FRAGMENT}#mandate-scheduling`)).toBe(false);
    expect(() => scopedUrn("mandate", WITH_FRAGMENT, "has space")).toThrow();
  });

  it("refuses a signed mandate carrying a legacy malformed id (re-initialise, never rewrite)", async () => {
    const clock = fixedClock();
    const { alice } = await provisionPair({ now: clock.now });
    const actor = alice.identity.actor;
    const good = schedulingMandate([])({
      owner: alice.identity.party,
      actor,
      validFrom: "2026-10-19T00:00:00Z",
      validUntil: "2026-11-19T00:00:00Z",
    });
    const opts = {
      trust: await TrustStore.load(alice.trust),
      actor,
      limits: DEFAULT_LIMITS,
      at: "2026-10-20T00:00:00Z",
    };
    const ok = await loadMandate(await signMandate(alice.ownerKey, good), opts);
    expect(ok.ok).toBe(true);
    const legacy = { ...good, id: `${actor}#mandate-scheduling` };
    const refused = await loadMandate(await signMandate(alice.ownerKey, legacy), opts);
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).toMatch(/not a valid IRI|invalid/i);
  });

  it("the CLI refuses a legacy agent directory with an explicit re-init instruction", async () => {
    const root = mkdtempSync(join(tmpdir(), "awp-legacy-"));
    try {
      const common = ["--dir", root, "--now", "2026-10-19T08:00:00Z"];
      await main(
        [
          "init",
          "--policy-engine=solid-odrl",
          "--name",
          "alice",
          "--party",
          "https://alice.example/#me",
          "--actor",
          WITH_FRAGMENT,
          ...common,
        ],
        { stdout: () => undefined },
      );
      const stored = await readAgent(root, "alice");
      const legacy = {
        ...schedulingMandate([])({
          owner: "https://alice.example/#me",
          actor: WITH_FRAGMENT,
          validFrom: "2026-10-19T00:00:00Z",
          validUntil: "2026-11-19T00:00:00Z",
        }),
        id: `${WITH_FRAGMENT}#mandate-scheduling`,
      };
      const owner = await readOwnerKey(root, "alice"); // colocated (compatibility layout)
      writeFileSync(join(stored.dir, "mandate.jws"), await signMandate(owner.key, legacy));
      await expect(
        main(["status", "--name", "alice", ...common], { stdout: () => undefined }),
      ).rejects.toThrow(/profile 0\.1\.0 .*re-run `init`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the same message and mandate identity appears on the wire, in the ledger and in RDF", async () => {
    const clock = fixedClock();
    const { alice } = await personalPair({ now: clock.now });
    const start = await alice.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: { id: "https://w3id.org/jeswr/awp#op/schedule-meeting", version: "0.1" },
      terms: {} as never,
      models: [],
    });
    const out = start.outbound[0];
    if (!out) throw new Error("no outbound");
    const ledger = alice.ledger.entries();
    const msgOut = ledger.find((e) => e.record.type === "message-out");
    expect(msgOut?.record.id).toBe(out.id);
    const { quads, report } = ledgerToRdf(ledger, "urn:awp:ledger:alice");
    expect(report.invalidIdentifiers).toEqual([]);
    expect(quads.some((q) => q.object.value === out.id)).toBe(true);
    const grant = ledger.find((e) => e.record.type === "grant");
    expect(quads.some((q) => q.subject.value === grant?.record.id)).toBe(true);
  });
});
