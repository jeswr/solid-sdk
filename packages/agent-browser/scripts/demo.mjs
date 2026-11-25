// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers

import { startShop } from "@jeswr/test-shop";
import { writeFile } from "fs/promises";
import { parseArgs } from "util";
import { learnShop, SHOP_GOAL, shopExecutor, shopPlanner } from "../dist/demo.js";
import { claudeCliPlanner, codexCliPlanner, runTask } from "../dist/index.js";

const { values } = parseArgs({
  options: {
    planner: { type: "string", default: "scripted" },
    model: { type: "string" },
    out: { type: "string", default: "agent-browser-trace.json" },
  },
});
if (!["scripted", "claude", "codex"].includes(values.planner)) {
  throw new Error("--planner must be scripted, claude or codex");
}
const shop = await startShop();
try {
  const { model, writeResponses } = await learnShop(shop);
  shop.state.reset(); // The learning demonstration's order is separate from the task.
  const { executor } = await shopExecutor(model, undefined, writeResponses);
  const planner =
    values.planner === "claude"
      ? claudeCliPlanner({ model: values.model ?? "sonnet" })
      : values.planner === "codex"
        ? codexCliPlanner({ model: values.model ?? "gpt-6.1-sol" })
        : shopPlanner();
  const trace = await runTask({
    goal: SHOP_GOAL,
    executor,
    model,
    planner,
    // Explicit consent for this disposable fictional shop, bounded to GBP 20 per action.
    approver: (request) => (request.currency === "GBP" ? { limit: 20 } : "deny"),
  });
  await writeFile(
    values.out,
    `${JSON.stringify({ "x-authored-by": "Codex GPT-6.1-Sol", ...trace }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(
    `${trace.format}: ${trace.outcome}, ${trace.steps.length} steps, ~${trace.promptTokensEstimate} prompt tokens`,
  );
  for (const step of trace.steps)
    console.log(
      `${step.index}. ${step.statuses.join(" -> ")} (~${step.promptTokensEstimate} tokens, ${step.elapsedMs} ms)`,
    );
  console.log(`Orders: ${shop.state.orders.length}; trace: ${values.out}`);
} finally {
  await shop.close();
}
