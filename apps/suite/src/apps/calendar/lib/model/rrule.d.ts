// AUTHORED-BY Codex GPT-6.1-Sol
// Use the same CJS entry in browser bundles and native ESM (including Playwright).
// rrule's root main/module entries expose different export shapes in those runtimes.
declare module "rrule/dist/es5/rrule.js" {
  const library: typeof import("rrule");
  export default library;
}
