// AUTHORED-BY Codex GPT-6
import assert from "node:assert/strict";
import { parseRdf } from "@jeswr/fetch-rdf";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  executeMigration,
  finalizePlan,
  MigrationAborted,
  type MigrationPlan,
  type Mode,
  type OptionId,
  type Progress,
  planMigration,
  type ReportKind,
} from "../../src/engine/index.js";
import { type CssAccount, createAccount } from "./account.js";
import { boundedFetch } from "./auth.js";
import { ownerRule, putFixture, type SourceFixture, seedSource, setAccess } from "./fixtures.js";
import { accessLink, appendProbeBody, assertSubset, observeWrites, probeAccess } from "./probe.js";
import { type CssServer, type System, startServer } from "./server.js";

interface Scenario {
  name: string;
  from: System;
  to: System;
  group?: "skip" | "expand";
  conflict?: "skip" | "overwrite";
  root?: "skip" | "merge";
  unreadable?: "skip" | "owner-only";
}
const scenarios: Scenario[] = [
  {
    name: "WAC → ACP / omit unsupported grants",
    from: "wac",
    to: "acp",
    group: "skip",
    conflict: "skip",
    root: "skip",
    unreadable: "skip",
  },
  {
    name: "WAC → ACP / expand group, overwrite, merge, owner-only",
    from: "wac",
    to: "acp",
    group: "expand",
    conflict: "overwrite",
    root: "merge",
    unreadable: "owner-only",
  },
  {
    name: "ACP → WAC / deny, exclusion and client narrowing",
    from: "acp",
    to: "wac",
    conflict: "overwrite",
    root: "merge",
  },
  {
    name: "WAC → WAC / preserve groups and child override",
    from: "wac",
    to: "wac",
    conflict: "overwrite",
    root: "merge",
    unreadable: "owner-only",
  },
  {
    name: "ACP → ACP / preserve denies, clients and member controls",
    from: "acp",
    to: "acp",
    conflict: "overwrite",
    root: "merge",
  },
];

const narrowingKinds = new Set<ReportKind>([
  "group-unsupported",
  "origin-unsupported",
  "condition-unsupported",
  "exclusion-unsupported",
  "deny-unsupported",
  "acl-unreadable",
  "acl-system-unknown",
  "too-complex",
]);
const allOptions: OptionId[] = [
  "skip",
  "expand",
  "owner-only",
  "per-resource",
  "overwrite",
  "merge",
  "drop-overlapping",
  "abort",
  "acknowledge",
];

describe.sequential("real CSS 7.2 migration security", () => {
  const servers = new Map<System, CssServer>();
  const sources = new Map<System, SourceFixture>();
  const strangers = new Map<System, CssAccount>();
  const covered = new Set<OptionId>();
  const sourceAccess = new Map<System, Map<string, Set<Mode>[]>>();
  let patch = "";

  beforeAll(async () => {
    // One instance per authorization system for the entire suite.
    for (const system of ["wac", "acp"] as const) servers.set(system, await startServer(system));
    const origins = [...servers.values()].map((server) => server.base);
    patch = await appendProbeBody();
    for (const system of ["wac", "acp"] as const) {
      const server = servers.get(system) as CssServer;
      strangers.set(system, await createAccount(server.base, origins));
    }
    for (const system of ["wac", "acp"] as const) {
      const server = servers.get(system) as CssServer;
      const account = await createAccount(server.base, origins);
      const reader = system === "wac" ? await createAccount(server.base, origins) : undefined;
      const fixture = await seedSource(
        account,
        strangers.get(system) as CssAccount,
        system,
        reader,
      );
      sources.set(system, fixture);
      const baseline = new Map<string, Set<Mode>[]>();
      for (const path of fixture.paths) {
        const url = fixture.side.root + path;
        const head = await fixture.side.http.head(url);
        assert.equal(head.status, 200);
        const acl = accessLink(head, url);
        baseline.set(
          path,
          await Promise.all(actors().map((actor) => probeAccess(actor, url, acl, patch))),
        );
      }
      sourceAccess.set(system, baseline);
      const namedIndex = system === "wac" ? 1 : 2;
      assert.deepEqual(baseline.get("shared.ttl")?.[namedIndex], new Set(["read", "append"]));
      assert.deepEqual(baseline.get("private/bytes.bin")?.[0], new Set());
      assert.deepEqual(baseline.get("public/nested/note.ttl")?.[0], new Set(["read"]));
      assert.deepEqual(baseline.get("authenticated/info.json")?.[0], new Set());
      assert.ok(baseline.get("authenticated/info.json")?.[1]?.has("read"));
      assert.ok(baseline.get("authenticated/info.json")?.[2]?.has("read"));
      if (system === "wac") {
        assert.deepEqual(baseline.get("public/narrow.txt")?.[0], new Set());
        assert.deepEqual(baseline.get("group-only.txt")?.[namedIndex], new Set(["read"]));
        const unreadableUrl = `${fixture.side.root}unreadable.txt`;
        const unreadableAcl = accessLink(
          await fixture.side.http.head(unreadableUrl),
          unreadableUrl,
        );
        assert.equal((await fixture.side.http.get(unreadableAcl)).status, 403);
      } else {
        assert.deepEqual(baseline.get("deny.ttl")?.[namedIndex], new Set(["append"]));
        assert.deepEqual(baseline.get("client.ttl")?.[namedIndex], new Set(["read"]));
        assert.deepEqual(baseline.get("exclusion.ttl")?.[namedIndex], new Set());
      }
      console.log(
        `[SOURCE ${system.toUpperCase()}] ${fixture.paths.length} resources; private, public, authenticated and named grants proved`,
      );
    }
  });

  afterAll(async () => {
    const stopped = await Promise.allSettled([...servers.values()].map((server) => server.stop()));
    for (const result of stopped) if (result.status === "rejected") throw result.reason;
  });

  function actors(): (typeof fetch)[] {
    return [
      boundedFetch,
      (strangers.get("wac") as CssAccount).fetch,
      (strangers.get("acp") as CssAccount).fetch,
    ];
  }

  async function target(system: System) {
    const account = await createAccount((servers.get(system) as CssServer).base);
    // CSS's stock root has public Read. Lock it before review so creation is
    // safe even before a new child's own access document can be installed.
    await setAccess(account.side, system, account.podRoot, [ownerRule(account.webId, true)]);
    await putFixture(account.side, "conflict.json", '{"version":"target"}\n', "application/json");
    await setAccess(account.side, system, `${account.podRoot}conflict.json`, [
      ownerRule(account.webId),
    ]);
    return account;
  }

  function resolutions(plan: MigrationPlan, scenario: Scenario): Record<string, OptionId> {
    const choices: Record<string, OptionId> = {};
    for (const item of plan.report) {
      const selected =
        item.kind === "group-unsupported"
          ? (scenario.group ?? "skip")
          : item.kind === "target-exists"
            ? (scenario.conflict ?? "skip")
            : item.kind === "protected-target"
              ? (scenario.root ?? "skip")
              : item.kind === "acl-unreadable"
                ? (scenario.unreadable ?? "owner-only")
                : item.recommended;
      assert.ok(
        item.options.some((option) => option.id === selected),
        `${item.kind} must offer ${selected}`,
      );
      choices[item.id] = selected;
    }
    return choices;
  }

  for (const scenario of scenarios)
    it(scenario.name, async () => {
      console.log(`[SCENARIO] ${scenario.name}`);
      const source = sources.get(scenario.from) as SourceFixture;
      const destination = await target(scenario.to);
      const baseline = sourceAccess.get(scenario.from) as Map<string, Set<Mode>[]>;
      let auditEnabled = false;
      let comparisons = 0;
      let auditedWrites = 0;
      let auditFailure: unknown;
      const progressEvents: Progress[] = [];
      const aclUrls = new Map<string, string>();
      const existing = new Set<string>([
        destination.podRoot,
        `${destination.podRoot}conflict.json`,
      ]);
      const onProgress = async () => {
        if (!auditEnabled) return;
        auditedWrites++;
        try {
          // Check EVERY existing migrated resource after EVERY write. Parent
          // changes can widen descendants other than the resource just written.
          for (const path of source.paths) {
            const url = destination.podRoot + path;
            if (!existing.has(url)) continue;
            let acl = aclUrls.get(url);
            if (!acl) {
              const head = await destination.side.http.head(url);
              assert.equal(head.status, 200);
              acl = accessLink(head, url);
              aclUrls.set(url, acl);
            }
            const access = await Promise.all(
              actors().map((actor) => probeAccess(actor, url, acl, patch)),
            );
            for (const [index, modes] of access.entries()) {
              assertSubset(
                baseline.get(path)?.[index] as Set<Mode>,
                modes,
                `${scenario.name} intermediate ${path} actor ${index}`,
              );
              comparisons++;
            }
          }
        } catch (error) {
          auditFailure = error;
          throw error;
        }
      };
      const observed = observeWrites(destination.side.http, async (event) => {
        if (event.status >= 200 && event.status < 300 && event.current) existing.add(event.current);
        await onProgress();
      });
      const targetSide = { ...destination.side, http: observed.http };
      const options = {
        source: source.side,
        target: targetSide,
        onProgress: (event: Progress) => progressEvents.push(event),
      };
      const plan = await planMigration(options);
      expect(plan.sourceSystem).toBe(scenario.from);
      expect(plan.targetSystem).toBe(scenario.to);
      // A crawl that silently misses data cannot make the permission checks pass.
      expect(new Set(plan.resources.map((entry) => entry.sourceUrl))).toEqual(
        new Set(source.paths.map((path) => source.side.root + path)),
      );
      const kinds = new Set(plan.report.map((item) => item.kind));
      expect(kinds.has("protected-target")).toBe(true);
      expect(kinds.has("target-exists")).toBe(true);
      if (scenario.from === "wac") expect(kinds.has("acl-unreadable")).toBe(true);
      if (scenario.from === "wac" && scenario.to === "acp")
        for (const kind of [
          "group-unsupported",
          "origin-unsupported",
          "inheritance-narrowed",
        ] as const)
          expect(kinds.has(kind)).toBe(true);
      if (scenario.from === "acp" && scenario.to === "wac")
        for (const kind of [
          "deny-unsupported",
          "condition-unsupported",
          "exclusion-unsupported",
        ] as const)
          expect(kinds.has(kind)).toBe(true);
      const choices = resolutions(plan, scenario);
      const executable = finalizePlan(plan, choices);
      expect(observed.writes).toHaveLength(0);
      for (const choice of Object.values(choices)) covered.add(choice);
      console.log(
        `[DECISIONS] ${JSON.stringify(plan.report.map((item) => ({ kind: item.kind, choice: choices[item.id] })))}`,
      );
      auditEnabled = true;
      const result = await executeMigration(executable, options);
      if (auditFailure) throw auditFailure;
      expect(result.failed, JSON.stringify(result.log)).toEqual([]);
      expect(result.verified).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(observed.writes.length).toBeGreaterThan(source.files.size * 2);
      expect(auditedWrites).toBe(observed.writes.length);
      expect(comparisons).toBeGreaterThan(observed.writes.length);
      for (const phase of ["lock", "copy", "grant", "verify"] as const)
        expect(progressEvents.some((event) => event.phase === phase)).toBe(true);

      const intentionallySkipped = new Set<string>();
      if (scenario.conflict === "skip") intentionallySkipped.add("conflict.json");
      if (scenario.unreadable === "skip") intentionallySkipped.add("unreadable.txt");
      expect(new Set(result.copied)).toEqual(
        new Set(
          [...source.files.keys()]
            .filter((path) => !intentionallySkipped.has(path))
            .map((path) => destination.podRoot + path),
        ),
      );
      for (const path of intentionallySkipped) {
        const response = await destination.side.http.get(destination.podRoot + path);
        if (path === "conflict.json") expect(await response.text()).toBe('{"version":"target"}\n');
        else expect(response.status).toBe(404);
      }
      for (const path of source.paths) {
        if (intentionallySkipped.has(path)) continue;
        const url = destination.podRoot + path;
        const head = await destination.side.http.head(url);
        expect(head.status).toBe(200);
        const acl = accessLink(head, url);
        const ownerModes = await probeAccess(destination.fetch, url, acl, patch);
        for (const mode of ["read", "write", "append", "control"] as const)
          expect(ownerModes.has(mode), `owner retains ${mode} on ${path}`).toBe(true);
        // Actually read the ACL and conditionally attempt its replacement, proving
        // ACR/ACL management independently of the resource's advertised Control.
        const aclResponse = await destination.fetch(acl, { headers: { accept: "text/turtle" } });
        expect(aclResponse.status).toBe(200);
        await aclResponse.arrayBuffer();
        const control = await destination.fetch(acl, {
          method: "PUT",
          headers: {
            "if-match": '"css-test-owner-control-never-match"',
            "content-type": "text/turtle",
          },
          body: "",
        });
        expect(control.status).toBe(412);
        await control.arrayBuffer();
        const data = await destination.fetch(url);
        expect(data.status).toBe(200);
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (source.files.has(path)) expect(bytes, `${path} bytes`).toEqual(source.files.get(path));
        else {
          const dataset = await parseRdf(
            new TextDecoder().decode(bytes),
            data.headers.get("content-type"),
            { baseIRI: url },
          );
          const children = new Set(
            [...new Container(url, dataset, DataFactory).contains].map((child) => child.id),
          );
          for (const childPath of source.paths.filter(
            (child) =>
              child !== path &&
              new URL(
                ".",
                child.endsWith("/")
                  ? (source.side.root + child).slice(0, -1)
                  : source.side.root + child,
              ).href ===
                source.side.root + path,
          ))
            if (!intentionallySkipped.has(childPath))
              expect(children.has(destination.podRoot + childPath)).toBe(true);
        }
        const lossy = plan.report.some(
          (item) =>
            item.resourceUrl === source.side.root + path &&
            narrowingKinds.has(item.kind) &&
            !(item.kind === "group-unsupported" && choices[item.id] === "expand"),
        );
        const faithful = source.faithful.has(path) || (!lossy && path !== "conflict.json");
        for (const [index, actor] of actors().entries()) {
          const modes = await probeAccess(actor, url, acl, patch);
          const original = baseline.get(path)?.[index] as Set<Mode>;
          assertSubset(original, modes, `${scenario.name} final ${path} actor ${index}`);
          if (faithful && !(path === "" && scenario.root === "skip"))
            expect(modes, `faithful ${path} actor ${index}`).toEqual(original);
          const read = await actor(url, { redirect: "manual" });
          expect(
            modes.has("read") ? read.status === 200 : [401, 403].includes(read.status),
            `GET agrees with effective Read on ${path} actor ${index}`,
          ).toBe(true);
          await read.arrayBuffer();
        }
      }
      const named = scenario.from === "wac" ? 1 : 2;
      const shared = `${destination.podRoot}shared.ttl`;
      const grants = await probeAccess(
        actors()[named] as typeof fetch,
        shared,
        accessLink(await destination.side.http.head(shared), shared),
        patch,
      );
      expect(grants).toEqual(new Set(["read", "append"]));
      // Also exercise a successful append, rather than relying only on a 412
      // authorization probe. Restore the bytes as owner after this positive test.
      const stranger = actors()[named] as typeof fetch;
      const append = await stranger(shared, {
        method: "PATCH",
        headers: { "content-type": "application/sparql-update" },
        body: patch,
      });
      expect(append.ok, "The stranger's translated Append grant must permit a real PATCH").toBe(
        true,
      );
      await append.arrayBuffer();
      const changed = await destination.fetch(shared);
      const etag = changed.headers.get("etag");
      const graph = await parseRdf(await changed.text(), changed.headers.get("content-type"), {
        baseIRI: shared,
      });
      expect(
        graph.match(
          DataFactory.namedNode("urn:css-test:probe"),
          DataFactory.namedNode("urn:css-test:predicate"),
          DataFactory.namedNode("urn:css-test:value"),
        ).size,
      ).toBe(1);
      assert.ok(etag, "Restoring the append test requires the current content ETag");
      const restore = await destination.fetch(shared, {
        method: "PUT",
        headers: { "content-type": "text/turtle", "if-match": etag },
        body: new Uint8Array(source.files.get("shared.ttl") as Uint8Array),
      });
      expect(restore.ok).toBe(true);
      await restore.arrayBuffer();
      const restored = await destination.fetch(shared);
      expect(new Uint8Array(await restored.arrayBuffer())).toEqual(source.files.get("shared.ttl"));
      const sharedAcl = accessLink(await destination.side.http.head(shared), shared);
      const forbiddenControl = await stranger(sharedAcl, {
        method: "PUT",
        headers: { "content-type": "text/turtle", "if-match": '"css-test-stranger-no-control"' },
        body: "",
      });
      expect(forbiddenControl.status, "Append must not permit ACL/ACR edits").toBe(403);
      await forbiddenControl.arrayBuffer();
      // All original bytes still match after the non-mutating permission probes.
      for (const [path, bytes] of source.files) {
        const response = await source.side.http.get(source.side.root + path);
        expect(
          new Uint8Array(await response.arrayBuffer()),
          `probe changed source ${path}`,
        ).toEqual(bytes);
      }
      console.log(
        `[PASS] ${scenario.name}: ${result.copied.length} files; ${observed.writes.length} writes; ${comparisons} intermediate permission comparisons`,
      );
    });

  for (const [from, to] of [
    ["wac", "acp"],
    ["acp", "wac"],
  ] as const)
    it(`${from.toUpperCase()} → ${to.toUpperCase()} / abort every offered decision without writes`, async () => {
      const fixture = sources.get(from) as SourceFixture;
      const destination = await target(to);
      const observed = observeWrites(destination.side.http, async () => {});
      const targetSide = { ...destination.side, http: observed.http };
      const snapshot = async () => {
        const urls = [
          destination.podRoot,
          accessLink(await destination.side.http.head(destination.podRoot), destination.podRoot),
          `${destination.podRoot}conflict.json`,
          destination.webId.split("#")[0] as string,
        ];
        return Promise.all(
          urls.map(async (url) => {
            const response = await destination.side.http.get(url);
            return {
              url,
              status: response.status,
              etag: response.headers.get("etag"),
              bytes: [...new Uint8Array(await response.arrayBuffer())],
            };
          }),
        );
      };
      const before = await snapshot();
      const plan = await planMigration({ source: fixture.side, target: targetSide });
      const defaults = resolutions(plan, { name: "abort", from, to });
      const abortable = plan.report.filter((item) =>
        item.options.some((option) => option.id === "abort"),
      );
      expect(abortable.length).toBeGreaterThan(3);
      for (const item of abortable)
        expect(() => finalizePlan(plan, { ...defaults, [item.id]: "abort" })).toThrow(
          MigrationAborted,
        );
      covered.add("abort");
      expect(observed.writes).toHaveLength(0);
      expect(await snapshot()).toEqual(before);
      for (const path of fixture.paths.filter((path) => path && path !== "conflict.json"))
        expect((await destination.side.http.head(destination.podRoot + path)).status).toBe(404);
      console.log(
        `[PASS] ${from.toUpperCase()} → ${to.toUpperCase()} abort: ${abortable.length} decisions; zero writes; target snapshot unchanged`,
      );
    });

  it("exercises every decision option type", () => {
    expect([...covered].sort()).toEqual([...allOptions].sort());
  });
});
