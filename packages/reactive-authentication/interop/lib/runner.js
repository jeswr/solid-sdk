// Orchestration of one run, with injectable setup/adapters so its failure semantics are testable without
// Docker or browsers (test/interop-harness.test.js). Every selected target is declared first; setup, adapter
// and teardown failures become report errors or FAIL/UNTESTED scenarios — never an empty green report.
import { existsSync } from "node:fs";
import { resolveTarget, scenarioIdsOf } from "./manifest.js";
import { describeError, safeDescription } from "./redact.js";
import { FAIL, UNTESTED } from "./report.js";

/** Cleanups run in reverse registration order; failures become report errors. Safe to call more than once. */
export class Cleanups {
  #items = [];

  constructor(report, log = console.log) {
    this.report = report;
    this.log = log;
  }

  register(label, fn) {
    this.#items.push([label, fn]);
  }

  async teardown() {
    while (this.#items.length > 0) {
      const [label, cleanup] = this.#items.pop();
      try {
        await cleanup();
      } catch (error) {
        this.report.error(`teardown (${label}) failed: ${describeError(error)}`);
        this.log(`[interop] teardown (${label}) failed: ${describeError(error)}`);
      }
    }
  }
}

/**
 * @param {object} options
 * @param {import("./report.js").Report} options.report
 * @param {object[]} options.targets selected manifest targets
 * @param {(name: string) => {run(report, target, config, env): Promise<void>}} options.adapterFor
 * @param {Cleanups} options.cleanups
 * @param {(register: (label: string, fn: () => Promise<void>) => void) => Promise<{browser: object}>} options.setup
 *   starts shared resources (stack, forwarders, browser), registering their cleanups as soon as they exist
 * @param {{headed?: boolean, runId: string, env?: Record<string, string>, log?: Function, interrupted?: () => boolean}} options.run
 */
export async function runSelection({ report, targets, adapterFor, setup, cleanups, run }) {
  const log = run.log ?? console.log;
  const register = (label, fn) => cleanups.register(label, fn);
  for (const target of targets) report.target(target);

  try {
    const { browser } = await setup(register);
    for (const target of targets) {
      if (run.interrupted?.()) break;
      log(`\n${target.id} — ${target.name}`);
      await runTarget(target);
    }

    async function runTarget(target) {
      const scenarios = scenarioIdsOf(target);
      const untested = (reason) => {
        report.fill(target.id, scenarios, UNTESTED, reason);
        log(`  - UNTESTED: ${reason}`);
      };
      const resolved = resolveTarget(target, run.env);
      const { configured, missing } = resolved;
      let config = resolved.config;
      if (target.blocked !== undefined) return untested(`blocked: ${target.blocked}`);
      if (!configured) return untested(`not configured: missing ${missing.join(", ")}`);
      // An explicitly configured session file that is missing is a configuration error, never silently ignored.
      const storageState = config.storageState;
      if (storageState !== undefined && !existsSync(storageState)) {
        const reason = "configuration error: the configured storageState file does not exist";
        report.error(`${target.id}: ${reason}`);
        report.fill(target.id, scenarios, FAIL, reason);
        return log(`  x ${reason}`);
      }
      // Login mode: a person in a headed browser ("manual"), or — without --headed — a dedicated test account's
      // saved IdP session ("session"): the provider must complete sign-in without interaction, or it fails closed.
      let loginMode = config.login?.recipe === "manual" ? "manual" : "recipe";
      if (loginMode === "manual" && !run.headed) {
        if (storageState === undefined)
          return untested(
            "manual sign-in needs --headed (or a dedicated session storageState for unattended runs)",
          );
        loginMode = "session";
        config = { ...config, login: { ...config.login, recipe: "session" } };
      }

      const live = target.category === "live";
      let context;
      const extraContexts = [];
      const env = {
        runId: run.runId,
        browser,
        live,
        loginMode,
        exerciseUnverified: run.exerciseUnverified === true,
        headed: run.headed === true,
        capabilities: target.capabilities,
        async context() {
          context ??= await browser.newContext({
            ...(storageState === undefined ? {} : { storageState }),
            ignoreHTTPSErrors: config.insecure === true,
          });
          return context;
        },
        /** Another browser (a fresh context with the same saved session, if any), closed with the target. */
        async freshContext() {
          const fresh = await browser.newContext({
            ...(storageState === undefined ? {} : { storageState }),
            ignoreHTTPSErrors: config.insecure === true,
          });
          extraContexts.push(fresh);
          return fresh;
        },
      };
      try {
        await adapterFor(target.adapter).run(report, target, config, env);
        report.fill(
          target.id,
          scenarios,
          FAIL,
          "the adapter returned without recording this scenario",
        );
      } catch (error) {
        // Also after every scenario passed (e.g. a failing adapter teardown): a run error fails the verdict.
        const reason = `adapter error: ${live ? safeDescription(error) : describeError(error)}`;
        report.error(`${target.id}: ${reason}`);
        report.fill(target.id, scenarios, FAIL, reason);
        log(`  x ${reason}`);
      } finally {
        for (const opened of [context, ...extraContexts].filter((c) => c !== undefined)) {
          try {
            await opened.close();
          } catch (error) {
            report.error(
              `${target.id}: closing the browser context failed: ${live ? safeDescription(error) : describeError(error)}`,
            );
          }
        }
      }
    }
  } catch (error) {
    report.error(`setup failed: ${describeError(error)}`);
    log(`[interop] setup failed: ${describeError(error)}`);
  } finally {
    await cleanups.teardown();
  }
  for (const target of targets)
    report.fill(
      target.id,
      scenarioIdsOf(target),
      UNTESTED,
      "not run: the run was aborted before this target",
    );
}
