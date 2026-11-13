// AUTHORED-BY Claude Opus 5.5
/**
 * The suite registry: one interface per layer, and configurations that pick
 * exactly one suite per layer (the way a verifiable credential picks a cryptosuite).
 *
 * Layer and suite ids are the ids of record in the explorer model (model.json; a test keeps
 * them in step). Only the
 * suites this runtime actually runs are registered; a configuration naming any other suite is
 * invalid here, so no trace can claim a suite the agent did not run.
 *
 * The pilot rule is kept: a message declares exactly one configuration, and an agent that
 * advertises two configurations never implies their product (no layer-by-layer mixing).
 */
import type { KeyAlg } from "../mechanisms/jws.js";

export const LAYER_IDS = [
  "transport",
  "data-access",
  "identity",
  "meaning",
  "authority",
  "authenticity",
  "trust",
  "reliance",
  "usage-control",
  "commitments",
  "accountability",
] as const;
export type LayerId = (typeof LAYER_IDS)[number];
export type SuiteId = string;

interface SuiteBase<L extends LayerId> {
  readonly layer: L;
  readonly id: SuiteId;
  readonly name: string;
  /** One plain-English sentence on what the suite does in this runtime. */
  readonly summary: string;
}

/** How a message gets there. */
export interface TransportSuite extends SuiteBase<"transport"> {
  /** The binding id the runtime records for each hop. */
  readonly binding: string;
}
/** How the content gets there. */
export interface DataAccessSuite extends SuiteBase<"data-access"> {
  readonly mode: "by-value" | "by-reference" | "by-query";
}
/** How a party or agent is named and its keys found. */
export interface IdentitySuite extends SuiteBase<"identity"> {
  readonly resolution: "pinned" | "resolved";
}
/** Layer 1: do both sides read the terms the same way? */
export interface MeaningSuite extends SuiteBase<"meaning"> {
  /** The vocabulary or profile both sides must declare. */
  readonly vocabulary: string;
}
/** Layer 2: may this agent do this for this person? */
export interface AuthoritySuite extends SuiteBase<"authority"> {
  readonly mandateFormat: string;
  readonly approvalFormat: string;
}
/** Layer 3: is this statement really from its source? */
export interface AuthenticitySuite extends SuiteBase<"authenticity"> {
  readonly mechanism: string;
  readonly algs: readonly KeyAlg[];
}
/** Layer 4: why accept this party or source at all? */
export interface TrustSuite extends SuiteBase<"trust"> {
  readonly anchors: "pinned" | "register-chain" | "federation";
}
/** Layer 4b: when two sources disagree, which wins, and how old is too old? */
export interface RelianceSuite extends SuiteBase<"reliance"> {
  /** Whether the gate applies the rules (false: stated, not yet enforced at the gate). */
  readonly enforcedAtGate: boolean;
}
/** Layer 5: what may be done with the data, and who enforces it? */
export interface UsageControlSuite extends SuiteBase<"usage-control"> {
  readonly policyLanguage: string;
  /** Whether anything other than deterministic rules takes part in a decision. */
  readonly rulesOnly: boolean;
}
/** Layer 6: what was agreed, and is it binding? */
export interface CommitmentsSuite extends SuiteBase<"commitments"> {
  readonly agreement: "signed-offer-acceptance" | "agreement-credential";
}
/** Layer 7: what happens when something goes wrong? */
export interface AccountabilitySuite extends SuiteBase<"accountability"> {
  readonly record: "hash-chained-local" | "pod-mirror";
}

export interface SuiteByLayer {
  transport: TransportSuite;
  "data-access": DataAccessSuite;
  identity: IdentitySuite;
  meaning: MeaningSuite;
  authority: AuthoritySuite;
  authenticity: AuthenticitySuite;
  trust: TrustSuite;
  reliance: RelianceSuite;
  "usage-control": UsageControlSuite;
  commitments: CommitmentsSuite;
  accountability: AccountabilitySuite;
}
export type AnySuite = SuiteByLayer[LayerId];

/** One suite per layer. `pilotConfiguration` is the id messages declare on the wire. */
export interface Configuration {
  readonly id: string;
  readonly layers: Readonly<Record<LayerId, SuiteId>>;
  /** The pilot configuration identifier carried in each message's `configuration` field. */
  readonly pilotConfiguration: string;
}

export type ConfigurationProblem =
  | { readonly layer: LayerId; readonly problem: "missing" }
  | { readonly layer: LayerId; readonly problem: "unknown-suite"; readonly suite: SuiteId }
  | { readonly layer: LayerId; readonly problem: "wrong-layer"; readonly suite: SuiteId }
  | { readonly layer: string; readonly problem: "unknown-layer" }
  | { readonly layer: LayerId; readonly problem: "constraint"; readonly detail: string };

/** A rule that rules out a combination of suites (e.g. a proof suite needing a credential form). */
export interface SuiteConstraint {
  readonly id: string;
  readonly text: string;
  readonly violated: (layers: Readonly<Record<LayerId, SuiteId>>) => LayerId | undefined;
}

export class SuiteRegistry {
  private readonly suites = new Map<string, AnySuite>();
  private readonly configurations = new Map<string, Configuration>();

  constructor(private readonly constraints: readonly SuiteConstraint[] = []) {}

  register(suite: AnySuite): this {
    const key = `${suite.layer}/${suite.id}`;
    if (this.suites.has(key)) throw new Error(`suite ${key} is already registered`);
    this.suites.set(key, suite);
    return this;
  }

  suite<L extends LayerId>(layer: L, id: SuiteId): SuiteByLayer[L] | undefined {
    return this.suites.get(`${layer}/${id}`) as SuiteByLayer[L] | undefined;
  }

  suitesFor<L extends LayerId>(layer: L): SuiteByLayer[L][] {
    return [...this.suites.values()].filter((s) => s.layer === layer) as SuiteByLayer[L][];
  }

  /** Every problem with a configuration; empty means it is valid in this registry. */
  check(config: { readonly layers: Readonly<Record<string, SuiteId>> }): ConfigurationProblem[] {
    const problems: ConfigurationProblem[] = [];
    for (const key of Object.keys(config.layers)) {
      if (!(LAYER_IDS as readonly string[]).includes(key))
        problems.push({ layer: key, problem: "unknown-layer" });
    }
    for (const layer of LAYER_IDS) {
      const id = config.layers[layer];
      if (id === undefined) {
        problems.push({ layer, problem: "missing" });
        continue;
      }
      if (this.suites.has(`${layer}/${id}`)) continue;
      const elsewhere = [...this.suites.values()].some((s) => s.id === id);
      problems.push({ layer, problem: elsewhere ? "wrong-layer" : "unknown-suite", suite: id });
    }
    if (problems.length === 0) {
      const layers = config.layers as Readonly<Record<LayerId, SuiteId>>;
      for (const c of this.constraints) {
        const layer = c.violated(layers);
        if (layer) problems.push({ layer, problem: "constraint", detail: `${c.id}: ${c.text}` });
      }
    }
    return problems;
  }

  /** Register a configuration; refuses an invalid one and a second one with the same id. */
  configure(config: Configuration): Configuration {
    const problems = this.check(config);
    if (problems.length > 0)
      throw new Error(`configuration ${config.id} is invalid: ${JSON.stringify(problems)}`);
    if (this.configurations.has(config.id))
      throw new Error(`configuration ${config.id} is already registered`);
    const frozen = Object.freeze({ ...config, layers: Object.freeze({ ...config.layers }) });
    this.configurations.set(config.id, frozen);
    return frozen;
  }

  configuration(id: string): Configuration | undefined {
    return this.configurations.get(id);
  }

  /** The configuration a message declares, by its wire `configuration` id (exactly one). */
  configurationOfMessage(message: { readonly configuration: string }): Configuration | undefined {
    return [...this.configurations.values()].find(
      (c) => c.pilotConfiguration === message.configuration,
    );
  }

  /**
   * Settle on one configuration from two advertised lists: the first of `local` (in its
   * preference order) that `peer` advertises by the same id. Configurations are matched
   * whole; a suite from one and a suite from another are never combined.
   */
  settle(local: readonly string[], peer: readonly string[]): Configuration | undefined {
    for (const id of local) {
      if (peer.includes(id)) {
        const config = this.configurations.get(id);
        if (config) return config;
      }
    }
    return undefined;
  }

  /** The `{ layer, suite }` references for the given layers of a configuration. */
  refs(
    config: Configuration,
    layers: readonly LayerId[],
  ): { readonly layer: LayerId; readonly suite: SuiteId }[] {
    return layers.map((layer) => ({ layer, suite: config.layers[layer] }));
  }
}
