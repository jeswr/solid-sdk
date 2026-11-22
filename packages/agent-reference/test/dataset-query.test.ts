// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { type DatasetRow, LocalDatasetHolder } from "../src/mechanisms/dataset-query.js";
import { representationSchema, signStatement, TYP } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { FileStateStore, MemoryStateStore, type StateStore } from "../src/store/state.js";

async function fixture(store: StateStore = new MemoryStateStore(), rows?: DatasetRow[]) {
  const { scenario } = loadCase(join(import.meta.dirname, ".."), "research-data-access");
  const holder = await testKey("query/holder"),
    owner = await testKey("query/owner"),
    actor = await testKey("query/actor");
  const pin = (
    key: typeof holder,
    role: "party" | "actor" | "issuer",
    subject: string,
    party?: string,
  ) => ({
    kid: key.kid,
    alg: key.alg,
    publicJwk: key.publicJwk,
    role,
    subject,
    ...(party ? { party } : {}),
  });
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:holder",
    sourceAuthority: [],
    keys: [
      pin(holder, "issuer", "urn:holder"),
      pin(owner, "party", "urn:reader"),
      pin(actor, "actor", "urn:reader:actor", "urn:reader"),
    ],
  });
  let at = "2026-11-13T09:00:00.000Z",
    n = 0;
  const protocol = structuredClone(required(required(scenario.queryGrants[0]).value.protocol[0]));
  protocol.rules.forEach((r) => {
    r.inputsFrom = ["urn:holder"];
  });
  const data = rows ?? structuredClone(required(scenario.datasets[0]).rows);
  const options = {
    identity: "urn:holder",
    key: holder,
    trust,
    store,
    ledger: new MemoryLedger(),
    dataset: "urn:dataset",
    rows: data,
    now: () => at,
  };
  const service = new LocalDatasetHolder(options);
  const rep = await signStatement(
    owner,
    TYP.representation,
    representationSchema.parse({
      type: "RepresentationStatement",
      id: "urn:rep",
      party: "urn:reader",
      actor: "urn:reader:actor",
      actorKid: actor.kid,
      operations: ["urn:op:dataset-query"],
      validFrom: "2026-11-13T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      issuedAt: at,
    }),
  );
  async function grant(patch: Record<string, unknown> = {}) {
    return signStatement(holder, "awp-query-grant+jws", {
      type: "QueryGrant",
      id: "urn:grant",
      issuer: "urn:holder",
      dataset: "urn:dataset",
      reader: { actor: "urn:reader:actor", party: "urn:reader" },
      purpose: "urn:purpose",
      protocol: [protocol],
      minimumPeople: 5,
      relatedQueryCap: 1,
      validUntil: "2026-12-01T00:00:00.000Z",
      ...patch,
    });
  }
  async function request(patch: Record<string, unknown> = {}) {
    return signStatement(actor, "awp-dataset-query+jws", {
      type: "DatasetQuery",
      id: `urn:request:${++n}`,
      actor: "urn:reader:actor",
      party: "urn:reader",
      representation: rep,
      at,
      purpose: "urn:purpose",
      protocol,
      grant: await grant(),
      ...patch,
    });
  }
  return {
    service,
    options,
    protocol,
    request,
    grant,
    advance: (v: string) => {
      at = v;
    },
  };
}
it("returns only a by-source answer, counts before release and rejects every requested reason", async () => {
  const f = await fixture();
  const answer = await f.service.query(await f.request());
  expect(answer).toMatchObject({ ok: true });
  expect(f.service.count("urn:grant")).toBe(1);
  if (!answer.ok) throw new Error("missing answer");
  const text = Buffer.from(required(answer.jws.split(".")[1]), "base64url").toString();
  const statement = JSON.parse(text);
  expect(statement).toMatchObject({
    value: 10,
    method: "derived",
    derivation: { assurance: "by-source", query: 1 },
  });
  expect(text).not.toContain("person-");
  expect(text).not.toContain('"labels"');
  expect(text).not.toContain('"rows"');
  expect(statement.derivation.inputs).toHaveLength(1);
  expect(await f.service.query(await f.request())).toMatchObject({ reason: "limit-exceeded" });
  const purpose = await fixture();
  expect(
    await purpose.service.query(await purpose.request({ purpose: "urn:other" })),
  ).toMatchObject({ reason: "purpose-not-permitted" });
  const outside = structuredClone(purpose.protocol);
  required(outside.rules[0]).output = "other.output";
  expect(await purpose.service.query(await purpose.request({ protocol: outside }))).toMatchObject({
    reason: "purpose-not-permitted",
  });
  expect(
    await purpose.service.query(
      await purpose.request({ protocol: { query: "SELECT private rows" } }),
    ),
  ).toMatchObject({ reason: "purpose-not-permitted" });
  const expired = await fixture();
  expect(
    await expired.service.query(
      await expired.request({
        grant: await expired.grant({ validUntil: "2026-11-13T08:59:59.000Z" }),
      }),
    ),
  ).toMatchObject({ reason: "expired" });
  const small = await fixture(f.options.store, f.options.rows.slice(0, 4));
  expect(
    await small.service.query(
      await small.request({ grant: await small.grant({ id: "urn:small" }) }),
    ),
  ).toMatchObject({ reason: "prohibited" });
});
it("caps differencing queries and counts distinct contributing people rather than unrelated rows", async () => {
  const f = await fixture();
  const almost = structuredClone(f.protocol);
  almost.cohort.equals = "almost";
  const data = f.options.rows.map((row, i) => ({
    ...row,
    labels: { ...row.labels, subset: i < 9 ? "almost" : "last" },
  }));
  const g = await fixture(new MemoryStateStore(), data);
  const all = structuredClone(g.protocol),
    minus = structuredClone(g.protocol);
  minus.cohort = { field: "subset", equals: "almost" };
  const grant = await g.grant({ protocol: [all, minus] });
  expect(await g.service.query(await g.request({ grant, protocol: all }))).toMatchObject({
    ok: true,
  });
  expect(await g.service.query(await g.request({ grant, protocol: minus }))).toMatchObject({
    reason: "limit-exceeded",
  });
  const duplicates = await fixture(
    new MemoryStateStore(),
    Array.from({ length: 10 }, () => required(f.options.rows[0])),
  );
  expect(await duplicates.service.query(await duplicates.request())).toMatchObject({
    reason: "prohibited",
  });
  const irrelevant = await fixture(
    new MemoryStateStore(),
    f.options.rows.map((row, i) => ({
      ...row,
      claims: row.claims.map((c) => ({ ...c, date: i ? "2025-01-01" : "2026-11-01" })),
    })),
  );
  expect(await irrelevant.service.query(await irrelevant.request())).toMatchObject({
    reason: "prohibited",
  });
});
it("persists the count across restart and cannot reset a grant by changing its body", async () => {
  const dir = mkdtempSync(join(tmpdir(), "query-"));
  try {
    const file = join(dir, "state.json"),
      store = new FileStateStore(file),
      f = await fixture(store);
    expect(await f.service.query(await f.request())).toMatchObject({ ok: true });
    store.close();
    const next = new FileStateStore(file),
      g = await fixture(next);
    expect(await g.service.query(await g.request())).toMatchObject({ reason: "limit-exceeded" });
    expect(
      await g.service.query(await g.request({ grant: await g.grant({ relatedQueryCap: 10 }) })),
    ).toMatchObject({ reason: "purpose-not-permitted" });
    next.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("atomically counts concurrent queries before releasing one answer", async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([f.request(), f.request()]);
  const results = await Promise.all([
    f.service.query(a),
    new LocalDatasetHolder(f.options).query(b),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.find((r) => !r.ok)).toMatchObject({ reason: "limit-exceeded" });
});
it("runs the research main and both catalogue branches through their real gates", async () => {
  const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), "research-data-access");
  const paths = await runScenario(profile, scenario);
  expect(paths.every((p) => p.trace && !p.disagrees)).toBe(true);
  expect(
    required(required(paths[0]).trace).events.some(
      (e) => e.agent === "reader-agent" && e.outcome === "admit",
    ),
  ).toBe(true);
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("required capability value is missing");
  return value;
}
