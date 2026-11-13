// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { InMemorySessions } from "@jeswr/site-executor";
import { readSiteModel, writeSiteModel } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { shopPlanner } from "../src/demo.js";
import {
  createExecutorFetch,
  createTaskExecutor,
  loginWithPassword,
  type PlannerInput,
  promptFor,
  runTask,
  scriptedPlanner,
} from "../src/index.js";
import { readQuads } from "../src/rdf.js";
import { buy, injection, modelFixture, productIri } from "./fixtures.js";

/** Inject HTTP at the existing executor seam; use the real compiler, gate, cookies and extraction. */
function transport(longReviews = false) {
  const password = 'secret-$`"password';
  const sid = "fictional-session-value";
  const csrf = "fictional-csrf-value";
  let orders = 0;
  const fetcher = vi.fn<NonNullable<import("@jeswr/site-executor").ExecutorOptions["fetch"]>>(
    async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe("manual");
      if (url.pathname === "/login" && (init?.method ?? "GET") === "GET")
        return new Response(`<input name="csrf_token" value="${csrf}">`, {
          headers: { "Set-Cookie": `csrf=${csrf}; Path=/; Secure` },
        });
      if (url.pathname === "/login") {
        const fields = new URLSearchParams(String(init?.body));
        expect(fields.get("username")).toBe("alex@example.test");
        expect(fields.get("password")).toBe(password);
        expect(fields.get("csrf_token")).toBe(csrf);
        expect(headers.get("cookie")).toContain(csrf);
        return new Response(null, {
          status: 303,
          headers: { Location: "/account", "Set-Cookie": `sid=${sid}; Path=/; HttpOnly; Secure` },
        });
      }
      if (url.pathname === "/account")
        return new Response(null, { status: headers.get("cookie")?.includes(sid) ? 200 : 401 });
      if (url.pathname === "/api/search")
        return Response.json({
          items: [
            {
              url: productIri,
              name: "Trail Runner sneakers",
              price: "20.00",
              currency: "GBP",
              review: `${injection.repeat(longReviews ? 60 : 1)}. ${sid} ${password}`,
            },
          ],
        });
      if (url.pathname === "/checkout") {
        expect(headers.get("cookie")).toContain(sid);
        expect(JSON.parse(String(init?.body))).toEqual({ id: "104" });
        return Response.json({ order: ++orders });
      }
      throw new Error("Unexpected fixture route");
    },
  );
  return { fetch: fetcher, password, sid, csrf, orders: () => orders };
}

describe("host login and real executor composition (in-process transport)", () => {
  it.each([
    "approve",
    "deny",
  ] as const)("%s gates the write and isolates sessions, secrets and untrusted reviews", async (decision) => {
    const fixture = transport();
    const model = readSiteModel(await writeSiteModel(modelFixture()));
    const sessions = new InMemorySessions();
    expect((await fixture.fetch("https://shop.test/account", { redirect: "manual" })).status).toBe(
      401,
    );
    const executorFetch = createExecutorFetch({
      model,
      sessions,
      persona: "buyer",
      fetch: fixture.fetch,
    });
    await loginWithPassword(model, executorFetch, {
      username: "alex@example.test",
      password: fixture.password,
    });
    expect(await sessions.get(model.site)).toBeUndefined();
    expect(
      (await sessions.get(model.site, "buyer"))?.cookies.find((c) => c.name === "sid")?.value,
    ).toBe(fixture.sid);
    const executor = createTaskExecutor({
      model,
      sessions,
      persona: "buyer",
      fetch: fixture.fetch,
    });
    const inputs: PlannerInput[] = [];
    const approver = vi.fn((_approval: import("@jeswr/site-executor").ApprovalRequest) => decision);
    const trace = await runTask({
      goal: "Buy the Trail Runner sneakers if they cost no more than GBP 20",
      model,
      executor,
      planner: shopPlanner((input) => inputs.push(input)),
      approver,
      persona: "buyer",
    });
    expect(trace.steps.map((s) => s.status)).toEqual([
      "done",
      decision === "approve" ? "done" : "denied",
      "answer",
    ]);
    expect(fixture.orders()).toBe(decision === "approve" ? 1 : 0);
    expect(approver).toHaveBeenCalledTimes(1);
    expect(approver.mock.calls[0]?.[0]?.summary).toContain('"Trail Runner sneakers" for GBP 20.00');
    const text = JSON.stringify([inputs, trace]);
    for (const value of ["<html", "Set-Cookie", fixture.password, fixture.sid, fixture.csrf])
      expect(text).not.toContain(value);
    expect(inputs[1]?.history[0]?.observations).toContain("sab:UntrustedText");
    const quads = readQuads(inputs[1]?.history[0]?.observations ?? "");
    const textQuad = quads.find((q) => q.object.value.includes(injection));
    expect(textQuad?.predicate.value).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#value");
    expect(
      quads.some(
        (q) =>
          textQuad &&
          q.subject.equals(textQuad.subject) &&
          q.object.value.endsWith("#UntrustedText"),
      ),
    ).toBe(true);
    for (const input of inputs) {
      expect(promptFor(input)).not.toContain("/api/search");
      expect(promptFor(input)).not.toContain("/login");
    }
    expect(trace.steps[1]?.request).toContain(productIri);
  });

  it("refuses origin escapes without sending cookies, credentials or following redirects", async () => {
    const model = modelFixture();
    const sessions = new InMemorySessions();
    const fetcher = vi.fn<NonNullable<import("@jeswr/site-executor").ExecutorOptions["fetch"]>>();
    const executorFetch = createExecutorFetch({ model, sessions, fetch: fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    const login = model.operations[0];
    if (!login) throw new Error("Missing fixture login");
    login.request.urlTemplate = "https://attacker.test/login";
    await expect(
      loginWithPassword(model, executorFetch, {
        username: "alex@example.test",
        password: "secret",
      }),
    ).rejects.toThrow("Password login failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a scripted planner buying twice creates one order, with completion ahead of long reviews", async () => {
    const fixture = transport(true);
    const model = modelFixture();
    const sessions = new InMemorySessions();
    await loginWithPassword(model, createExecutorFetch({ model, sessions, fetch: fixture.fetch }), {
      username: "alex@example.test",
      password: fixture.password,
    });
    const executor = createTaskExecutor({ model, sessions, fetch: fixture.fetch });
    const approver = vi.fn(() => ({ limit: 20 }));
    const trace = await runTask({
      goal: "Buy once",
      model,
      executor,
      approver,
      observationBudget: 1200,
      planner: scriptedPlanner([
        { kind: "act", turtle: buy },
        (input) => {
          const turtle = input.history[0]?.observations ?? "";
          expect(readQuads(turtle)[0]?.object.value).toBe(
            "https://jeswr.org/ns/site-action#ActionOutcome",
          );
          expect(turtle).toContain("sab:Completed");
          expect(turtle).toContain("schema:orderNumber");
          expect(turtle.indexOf("schema:orderNumber")).toBeLessThan(turtle.indexOf("schema:name"));
          return { kind: "act", turtle: buy };
        },
        (input) => {
          expect(input.history[1]?.status).toBe("repeat-blocked");
          return { kind: "answer", text: "One order placed." };
        },
      ]),
    });
    expect(trace.steps.map((s) => s.status)).toEqual(["done", "repeat-blocked", "answer"]);
    expect(fixture.orders()).toBe(1);
    expect(approver).toHaveBeenCalledTimes(1);
    expect(trace.steps[0]?.observations.length).toBeGreaterThan(1200);
  });

  it("treats login failure as a host error with no response body or credentials", async () => {
    const model = modelFixture();
    const sessions = new InMemorySessions();
    const executorFetch = createExecutorFetch({
      model,
      sessions,
      fetch: vi.fn(async () => new Response("secret-password", { status: 403 })),
    });
    await expect(
      loginWithPassword(model, executorFetch, {
        username: "alex@example.test",
        password: "secret-password",
      }),
    ).rejects.toThrow("Password login failed; check credentials and the learned login route.");
    expect(await sessions.get(model.site)).toBeUndefined();
    model.login = [];
    await expect(
      loginWithPassword(model, executorFetch, {
        username: "alex@example.test",
        password: "secret-password",
      }),
    ).rejects.toThrow("no password login");
  });
});
