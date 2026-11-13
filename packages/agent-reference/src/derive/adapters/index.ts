// AUTHORED-BY Codex GPT-6
/**
 * Optional delivery                 | Purpose
 * @sparq/zk-result                  | Successful-result relation, including hidden date comparisons (sparq-zk-result/5).
 * @sparq/verifiable-aggregate       | Signed, verifiable joint count/sum/threshold sessions (sparq-aggregate/1).
 * ANSWERABLE_AUTHRDF_CLI (binary)   | Native authenticated RDF evaluator, verifier-agreed dataset (sparq-authrdf/1).
 *
 * These deliveries do not exist here. Loading an opaque module is discovery, never
 * registration as a real verifier. Each future adapter must implement verifiers.ts.
 */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { accessSync, constants, statSync } from "fs";
import { type Adapter, type VerifierRegistry, verifierRegistry } from "../verifiers.js";

export const adapters: readonly Adapter[] = [];
export async function availableAdapters(): Promise<
  VerifierRegistry & { loaded: readonly string[] }
> {
  const loaded: string[] = [];
  const probes = [
    {
      name: "@sparq/zk-result",
      load: () => {
        // @ts-expect-error Optional delivery is deliberately absent; no package API is assumed.
        return import("@sparq/zk-result");
      },
    },
    {
      name: "@sparq/verifiable-aggregate",
      load: () => {
        // @ts-expect-error Optional delivery is deliberately absent; no package API is assumed.
        return import("@sparq/verifiable-aggregate");
      },
    },
  ];
  for (const probe of probes) {
    try {
      await probe.load();
      loaded.push(probe.name);
    } catch (error) {
      if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw error;
    }
  }
  const cli = process.env.ANSWERABLE_AUTHRDF_CLI;
  if (cli) {
    try {
      accessSync(cli, constants.X_OK);
      if (statSync(cli).isFile()) loaded.push("ANSWERABLE_AUTHRDF_CLI");
    } catch (error) {
      if (!["ENOENT", "EACCES"].includes((error as { code?: string }).code ?? "")) throw error;
    }
  }
  return { ...verifierRegistry(adapters), loaded };
}
