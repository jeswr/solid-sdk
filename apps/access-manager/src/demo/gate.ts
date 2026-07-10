// AUTHORED-BY Claude Fable 5
//
// The ?demo gate — the ONLY switch into demo mode. Pure over the URL search
// string so the decision is exhaustively unit-testable:
//   • no `demo` param        → null  (the real, authenticated app — unchanged)
//   • ?demo / ?demo=<empty>  → "dashboard" (the default demo view)
//   • ?demo=dashboard|inbox|history|dataclass → that view
//   • ?demo=<anything else>  → "dashboard" (lenient: demo was clearly asked for)

export type DemoView = "dashboard" | "inbox" | "history" | "dataclass";

export function demoViewFromSearch(search: string): DemoView | null {
  const params = new URLSearchParams(search);
  if (!params.has("demo")) return null;
  const value = params.get("demo");
  return value === "dashboard" || value === "inbox" || value === "history" || value === "dataclass"
    ? value
    : "dashboard";
}
