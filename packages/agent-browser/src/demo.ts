// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { InMemorySessions } from "@jeswr/site-executor";
import { readSiteModel, SCHEMA, type SiteModel, writeSiteModel } from "@jeswr/site-model";
import { profileSite } from "@jeswr/site-profiler";
import type { RunningShop } from "@jeswr/test-shop";
import { LiteralAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { scriptedPlanner } from "./planner.js";
import { PREFIXES, readQuads, writeQuads } from "./rdf.js";
import { createExecutorFetch, createTaskExecutor, loginWithPassword } from "./session.js";
import type { Planner, PlannerInput, TaskExecutor } from "./types.js";

export const SHOP_LOGIN = { username: "alex@example.test", password: "correct-horse" };
export const SHOP_GOAL = "Buy the Trail Runner sneakers if they cost no more than GBP 20";

/** The same search -> view -> add -> checkout demonstration used by the profiler's e2e test. */
export async function learnShop(shop: RunningShop): Promise<SiteModel> {
  const result = await profileSite({
    startUrl: shop.url,
    login: SHOP_LOGIN,
    demonstrations: [
      {
        name: "buy-product",
        description: "Search, view a product, add it to the basket and check out.",
        async run(page) {
          await page.goto(`${shop.url}/`);
          await page.fill("#q", "trail");
          await Promise.all([page.waitForURL(/\/search\?/), page.press("#q", "Enter")]);
          await Promise.all([
            page.waitForURL(/\/product\/104$/),
            page.click("text=Trail Runner sneakers"),
          ]);
          await page.waitForFunction(
            () => (document.querySelector("#stock")?.textContent ?? "") !== "",
          );
          await Promise.all([
            page.waitForResponse(
              (r) => r.url().endsWith("/api/cart/items") && r.request().method() === "POST",
            ),
            page.click("#add-to-cart"),
          ]);
          await page.goto(`${shop.url}/checkout`);
          await page.selectOption("#delivery", "standard");
          await page.waitForFunction(
            () => document.querySelector(".total")?.textContent === "Total GBP 20.00",
          );
          await Promise.all([page.waitForURL(/\/orders\/\d+$/), page.click("#place-order")]);
        },
      },
    ],
  });
  // Fail on a missing demonstration rather than passing with an empty/hand-built flow.
  if (!result.model.flows.some((f) => f.actionType === `${SCHEMA}BuyAction`)) {
    throw new Error("Profiling did not learn the purchase flow.");
  }
  // The contract has no target selector, so equivalent HTML/API searches tie in the executor.
  // Keep the demonstrated search surface; flow operation references remain unchanged.
  const flowOperations = new Set(
    result.model.flows.flatMap((f) => f.steps.map((s) => s.operation)),
  );
  result.model.operations = result.model.operations.filter(
    (o) => o.actionType !== `${SCHEMA}SearchAction` || flowOperations.has(o.id),
  );
  return readSiteModel(await writeSiteModel(result.model));
}

export async function shopExecutor(
  model: SiteModel,
  persona?: string,
): Promise<{
  executor: TaskExecutor;
  sessions: InMemorySessions;
}> {
  const sessions = new InMemorySessions();
  await loginWithPassword(model, createExecutorFetch({ model, sessions, persona }), SHOP_LOGIN);
  const writeResponses = Object.fromEntries(
    model.operations
      .filter((op) => op.effect === "payment")
      .map((op) => [op.id, { createdLocationPattern: "/orders/{id}" }]),
  );
  return { executor: createTaskExecutor({ model, sessions, persona, writeResponses }), sessions };
}

/** Construct requests through n3.Writer; the product IRI comes exclusively from observed RDF. */
export function shopPlanner(onInput?: (input: PlannerInput) => void): Planner {
  const { blankNode, namedNode, literal, quad } = DataFactory;
  const s = (name: string) => namedNode(SCHEMA + name);
  const type = namedNode(`${PREFIXES.rdf}type`);
  const action = blankNode("action");
  const scripted = scriptedPlanner([
    {
      kind: "act",
      turtle: writeQuads([
        quad(action, type, s("SearchAction")),
        quad(action, s("query"), literal("trail", namedNode(`${PREFIXES.xsd}string`))),
      ]),
    },
    (input) => {
      const previous = input.history.at(-1);
      if (previous?.status !== "done") return { kind: "ask", question: "Search did not complete." };
      const quads = readQuads(previous.observations);
      const dataset = new Store(quads);
      const subjects = new Map(quads.map((q) => [q.subject.value, q.subject]));
      const product = [...subjects.values()]
        .map((term) => new TermWrapper(term, dataset, DataFactory))
        .find(
          (node) =>
            node.termType === "NamedNode" &&
            OptionalFrom.subjectPredicate(node, `${SCHEMA}name`, LiteralAs.string) ===
              "Trail Runner sneakers",
        );
      if (!product) return { kind: "ask", question: "Product not found." };
      const price = OptionalFrom.subjectPredicate(product, `${SCHEMA}price`, (term) => term.value);
      const currency = OptionalFrom.subjectPredicate(
        product,
        `${SCHEMA}priceCurrency`,
        LiteralAs.string,
      );
      const productNode = namedNode(product.value);
      if (
        price === undefined ||
        !Number.isFinite(Number(price)) ||
        Number(price) > 20 ||
        currency !== "GBP"
      ) {
        return { kind: "answer", text: "The observed price does not satisfy the GBP 20 limit." };
      }
      return {
        kind: "act",
        turtle: writeQuads([
          quad(action, type, s("BuyAction")),
          quad(action, s("object"), productNode),
          quad(
            productNode,
            s("name"),
            literal("Trail Runner sneakers", namedNode(`${PREFIXES.xsd}string`)),
          ),
          quad(action, s("price"), literal("20.00", namedNode(`${PREFIXES.xsd}decimal`))),
          quad(action, s("priceCurrency"), literal("GBP", namedNode(`${PREFIXES.xsd}string`))),
        ]),
      };
    },
    (input) => ({
      kind: "answer",
      text:
        input.history.at(-1)?.status === "done"
          ? "Bought one pair of Trail Runner sneakers for GBP 20.00."
          : "The purchase did not complete.",
    }),
  ]);
  return {
    async next(input) {
      onInput?.(structuredClone(input));
      return scripted.next(input);
    },
  };
}
