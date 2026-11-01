// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  executeMigration,
  finalizePlan,
  MigrationAborted,
  planMigration,
} from "../../src/engine/index.js";
import { acl, grant, pods, policy, resolve, stranger } from "./helpers.js";

describe("migration with an independently enforcing LDP server", () => {
  for (const from of ["wac", "acp"] as const)
    for (const to of ["wac", "acp"] as const)
      it(`${from} to ${to}: every intermediate write is no wider`, async () => {
        const { source, target } = await pods(from, to);
        source.store(`${source.root}folder/`, "", "text/turtle");
        source.store(`${source.root}folder/public.txt`, "hello public");
        source.store(
          `${source.root}folder/private.bin`,
          new Uint8Array([0, 255, 13, 10]),
          "application/octet-stream",
        );
        source.setAcl(
          `${source.root}folder/public.txt`,
          await acl(source, `${source.root}folder/public.txt`, policy(grant())),
        );
        source.setAcl(
          `${source.root}folder/private.bin`,
          await acl(source, `${source.root}folder/private.bin`),
        );
        const sourceSide = source.side();
        const targetSide = target.side();
        const progress: string[] = [];
        const plan = await planMigration({
          source: sourceSide,
          target: targetSide,
          onProgress: (p) => progress.push(p.phase),
        });
        expect(plan.stats).toMatchObject({ containers: 2, resources: 2, bytes: 16 });
        expect(target.requests.every((r) => r.method === "HEAD" || r.method === "GET")).toBe(true);
        expect(() => finalizePlan(plan, {})).toThrow(TypeError);
        expect(() => finalizePlan(plan, { arbitrary: "abort" })).toThrow(MigrationAborted);
        const executable = finalizePlan(plan, resolve(plan));
        let snapshots = 0;
        target.afterWrite = async () => {
          snapshots++;
          for (const url of target.data.keys()) {
            if (url === target.root) continue;
            const original = source.root + url.slice(target.root.length);
            for (const identity of [{}, { agent: stranger }]) {
              const before = await source.permissions(original, identity);
              const after = await target.permissions(url, identity);
              for (const mode of after)
                expect(before.has(mode), `${url} ${mode} after write ${snapshots}`).toBe(true);
            }
            expect(await target.permissions(url, { agent: target.owner })).toEqual(
              new Set(["read", "append", "write", "control"]),
            );
          }
        };
        const result = await executeMigration(executable, {
          source: sourceSide,
          target: targetSide,
          onProgress: (p) => progress.push(p.phase),
        });
        expect(result.failed).toEqual([]);
        expect(result.verified).toBe(true);
        expect(result.copied).toHaveLength(2);
        expect(snapshots).toBeGreaterThan(8);
        expect(
          new TextDecoder().decode(target.data.get(`${target.root}folder/public.txt`)?.bytes),
        ).toBe("hello public");
        expect((await target.request(`${target.root}folder/private.bin`, {}, {})).status).toBe(401);
        expect((await target.request(`${target.root}folder/public.txt`, {}, {})).status).toBe(200);
        const writes = target.requests.filter((r) => r.method === "PUT");
        expect(writes[0]?.url).toBe(`${target.root}folder/`);
        const finalAcls = writes
          .filter((r) => r.url.endsWith(to === "wac" ? ".acl" : ".acr"))
          .slice(-3);
        expect(finalAcls.at(-1)?.url).toBe(target.acl(`${target.root}folder/`));
        expect(progress).toEqual(
          expect.arrayContaining([
            "crawl",
            "read-access",
            "plan",
            "lock",
            "copy",
            "grant",
            "verify",
          ]),
        );
        await expect(
          executeMigration(executable, { source: sourceSide, target: targetSide }),
        ).rejects.toThrow("finalized");
      });

  it("cancels after an in-flight write and locks placeholders before stopping", async () => {
    const { source, target } = await pods();
    source.store(`${source.root}private`, "secret");
    const sourceSide = source.side();
    const targetSide = target.side();
    const plan = await planMigration({ source: sourceSide, target: targetSide });
    const abort = new AbortController();
    target.afterWrite = (url) => {
      if (url === `${target.root}private`) abort.abort();
    };
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), {
      source: sourceSide,
      target: targetSide,
      signal: abort.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.failed).toEqual([]);
    expect((await target.permissions(`${target.root}private`)).size).toBe(0);
    expect(result.aclWritten).toContain(target.acl(`${target.root}private`));
    expect(result.skipped).toHaveLength(2); // protected root and the uncopied file
  });

  it("keeps target profile and existing content until explicitly resolved", async () => {
    const { source, target } = await pods("acp", "wac");
    source.store(`${source.root}profile/`, "", "text/turtle");
    source.store(`${source.root}profile/card`, "incoming profile");
    source.store(`${source.root}existing`, "new");
    target.store(`${target.root}profile/`, "", "text/turtle");
    target.store(`${target.root}profile/card`, "target profile");
    target.store(`${target.root}existing`, "old");
    const sourceSide = source.side();
    const targetSide = target.side();
    const plan = await planMigration({ source: sourceSide, target: targetSide });
    expect(plan.report.filter((i) => i.kind === "protected-target")).toHaveLength(2);
    const result = await executeMigration(
      finalizePlan(plan, resolve(plan, { "target-exists": "skip" })),
      { source: sourceSide, target: targetSide },
    );
    expect(result.verified).toBe(true);
    expect(new TextDecoder().decode(target.data.get(`${target.root}profile/card`)?.bytes)).toBe(
      "target profile",
    );
    expect(new TextDecoder().decode(target.data.get(`${target.root}existing`)?.bytes)).toBe("old");
    const next = await planMigration({ source: sourceSide, target: targetSide });
    const choices = {
      ...resolve(next),
      [next.report.find((i) => i.resourceUrl.endsWith("existing") && i.kind === "target-exists")
        ?.id as string]: "overwrite" as const,
    };
    const updated = await executeMigration(finalizePlan(next, choices), {
      source: sourceSide,
      target: targetSide,
    });
    expect(updated.failed).toEqual([]);
    expect(new TextDecoder().decode(target.data.get(`${target.root}existing`)?.bytes)).toBe("new");
  });

  it("refuses unsafe inherited target access before any write", async () => {
    const { source, target } = await pods();
    source.store(`${source.root}private`, "secret");
    target.setAcl(
      target.root,
      await acl(target, target.root, policy(grant(undefined, { appliesTo: "both" }))),
    );
    const plan = await planMigration({ source: source.side(), target: target.side() });
    expect(() => finalizePlan(plan, resolve(plan))).toThrow("widens");
    expect(target.requests.some((r) => r.method === "PUT")).toBe(false);
  });
});

it("preserves additive ACP member controls and denies for existing and future children", async () => {
  const { source, target } = await pods("acp", "acp");
  const folder = `${source.root}folder/`;
  source.store(folder, "", "text/turtle");
  source.store(`${folder}file`, "content");
  const memberPolicy = policy(grant(undefined, { appliesTo: "both" }));
  memberPolicy.denials.push(
    grant([[{ kind: "agent", webId: stranger }]], { appliesTo: "members" }),
  );
  source.setAcl(folder, await acl(source, folder, memberPolicy));
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  target.afterWrite = async () => {
    for (const url of target.data.keys())
      if (url !== target.root)
        for (const identity of [{}, { agent: stranger }]) {
          const original = source.root + url.slice(target.root.length);
          const allowed = await source.permissions(original, identity);
          for (const mode of await target.permissions(url, identity))
            expect(allowed.has(mode)).toBe(true);
        }
  };
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([]);
  expect(await target.permissions(`${target.root}folder/file`, { agent: stranger })).toEqual(
    new Set(),
  );
  expect(await target.permissions(`${target.root}folder/future`)).toEqual(new Set(["read"]));
});
