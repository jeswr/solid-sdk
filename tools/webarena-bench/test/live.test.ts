// AUTHORED-BY Codex GPT-6
// Opt-in, read-only acceptance against the public disposable benchmark fixture. No planner runs.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createExecutorFetch, loginWithPassword } from "@jeswr/agent-browser";
import { createExecutor, InMemorySessions } from "@jeswr/site-executor";
import {
  type Operation,
  parseActionRequest,
  readSiteModel,
  writeSiteModel,
} from "@jeswr/site-model";
import { profileSite } from "@jeswr/site-profiler";
import { DataFactory, Parser, Writer } from "n3";
import { expect, it } from "vitest";

const s = "https://schema.org/";
const sab = "https://jeswr.org/ns/site-action#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const { namedNode, blankNode, literal, quad } = DataFactory;
async function action(op: Operation, values: Record<string, string> = {}) {
  const node = blankNode();
  const writer = new Writer();
  writer.addQuad(quad(node, namedNode(`${rdf}type`), namedNode(op.actionType)));
  writer.addQuad(quad(node, namedNode(`${sab}operation`), literal(op.id)));
  for (const [property, value] of Object.entries(values))
    writer.addQuad(quad(node, namedNode(property), literal(value)));
  return parseActionRequest(
    await new Promise<string>((resolve, reject) =>
      writer.end((err, text) => (err ? reject(err) : resolve(text))),
    ),
  );
}
it.skipIf(!process.env.SAB_LIVE_SITE_URL)(
  "profiles and executes real admin reads with a fresh learned login session",
  async () => {
    const startUrl = requireValue(process.env.SAB_LIVE_SITE_URL);
    const credentials = {
      username: process.env.SAB_LIVE_USERNAME ?? "admin",
      password: process.env.SAB_LIVE_PASSWORD ?? "admin1234",
    };
    const result = await profileSite({
      startUrl,
      login: credentials,
      maxPages: 16,
      maxProfileMs: 180000,
    });
    const model = readSiteModel(await writeSiteModel(result.model));
    const route = model.login?.find((r) => r.method === "password");
    expect(route?.sessionCookies?.length).toBeGreaterThan(0);
    expect(route?.probeUrl).toBeTruthy();
    const artifactDir = process.env.SAB_LIVE_OUTPUT_DIR;
    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true, mode: 0o700 });
      await writeFile(join(artifactDir, "model.ttl"), await writeSiteModel(model), { mode: 0o600 });
      await writeFile(
        join(artifactDir, "profile.json"),
        JSON.stringify(
          { operations: model.operations, login: model.login, warnings: result.warnings },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    const operations = model.operations;
    const find = (resource: string, type: string) => {
      const op = operations.find(
        (o) => o.request.urlTemplate.includes(`namespace=${resource}`) && o.actionType === s + type,
      );
      expect(op, `${type} ${resource}`).toBeDefined();
      expect(op?.session).toBe("signed-in");
      expect(op?.provenance.successes).toBeGreaterThan(0);
      return requireValue(op);
    };
    const needed = ["sales_order_grid", "customer_listing", "product_listing"].flatMap((resource) =>
      ["SearchAction", "ViewAction"].map((type) => find(resource, type)),
    );
    console.log(
      "LEARNED OPERATIONS",
      operations.map((o) => ({
        method: o.request.method,
        urlTemplate: o.request.urlTemplate,
        parameters: o.inputs.map((p) => ({ name: p.name, default: p.default })),
        session: o.session,
      })),
    );
    console.log("PROFILE WARNINGS", result.warnings);
    for (const op of needed) {
      const anonymous = await createExecutor({ model, sessions: new InMemorySessions() }).execute(
        await action(op, { [`${s}query`]: "Example" }),
      );
      expect(anonymous).toMatchObject({ status: "error", errorKind: "no-session", requests: 0 });
      expect(
        result.trace.some(
          (r) =>
            r.resourceType === "replay-anonymous" &&
            r.url.includes(new URL(op.request.urlTemplate.replace(/\{[^}]*\}/g, "")).search),
        ),
      ).toBe(true);
    }
    const sessions = new InMemorySessions();
    await loginWithPassword(model, createExecutorFetch({ model, sessions }), credentials);
    const executor = createExecutor({ model, sessions, writeResponses: result.writeResponses });
    const person = find("customer_listing", "SearchAction");
    const order = find("sales_order_grid", "ViewAction");
    const product = find("product_listing", "SearchAction");
    const size = requireValue(
      order.inputs.find((p) => /page.?size/i.test(decodeURIComponent(p.name))),
    );
    const sort = requireValue(
      order.inputs.find((p) => /sort.*field/i.test(decodeURIComponent(p.name))),
    );
    const direction = requireValue(
      order.inputs.find((p) => /sort.*direction/i.test(decodeURIComponent(p.name))),
    );
    const examples = [
      { label: "Customers containing Emma", op: person, values: { [`${s}query`]: "Emma" } },
      {
        label: "Five newest orders",
        op: order,
        values: {
          [requireValue(size.path[0])]: "5",
          [requireValue(sort.path[0])]: "created_at",
          [requireValue(direction.path[0])]: "desc",
        },
      },
      { label: "Product name search", op: product, values: { [`${s}query`]: "Geo" } },
    ];
    for (const example of examples) {
      const executed = await executor.execute(await action(example.op, example.values));
      expect(executed.status, JSON.stringify(executed)).toBe("done");
      expect(executed.observations[0]?.itemCount).toBeGreaterThan(0);
      const turtle = executed.observations.map((o) => o.turtle).join("\n");
      process.stdout.write(`${example.label}\n${turtle}\n`);
      if (artifactDir)
        await writeFile(
          join(artifactDir, `${example.op.extraction?.itemType.split("/").at(-1)}.ttl`),
          turtle,
          { mode: 0o600 },
        );
      const facts = new Parser().parse(turtle);
      for (const fact of facts)
        if (
          fact.object.termType === "Literal" &&
          fact.object.datatype.value === "http://www.w3.org/2001/XMLSchema#integer"
        )
          expect(fact.object.value).toMatch(/^[+-]?\d+$/);
      const names = facts
        .filter((q) => q.predicate.value === `${s}name`)
        .map((q) => q.object.value);
      if (example.op === person) expect(names.every((name) => name.includes("Emma"))).toBe(true);
      if (example.op === product)
        expect(names.every((name) => name.toLowerCase().includes("geo"))).toBe(true);
      if (example.op === order) {
        expect(executed.observations[0]?.itemCount).toBe(5);
        for (const property of ["totalPrice", "orderStatus", "dateCreated"])
          expect(facts.filter((q) => q.predicate.value === s + property)).toHaveLength(5);
        const dates = facts
          .filter((q) => q.predicate.value === `${s}dateCreated`)
          .map((q) => q.object.value);
        expect(dates).toEqual([...dates].sort().reverse());
      }
    }
    const loginId = requireValue(route).operation;
    expect(model.operations.filter((o) => o.request.method !== "GET").map((o) => o.id)).toEqual([
      loginId,
    ]);
  },
  240000,
);

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing required fixture value");
  return value;
}
