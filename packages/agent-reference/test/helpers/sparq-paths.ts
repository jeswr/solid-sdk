// AUTHORED-BY Codex GPT-6

// These five baseline paths lose their manifest traces without the result adapter.
export const resultProofPaths = [
  "age-check/main",
  "introduction/main",
  "right-to-work/hidden-validity-proof",
  "tenancy-application/main",
  "visa-application/main",
] as const;

// These live paths are blocked without the aggregate adapter, but the runner retains
// their SHA-256-verified recordings in the manifest.
export const aggregatePaths = [
  "cohort-count/main",
  "cohort-count/branch-1",
  "cohort-count/branch-2",
  "platform-income/main",
  "salary-benchmark/main",
  "salary-benchmark/branch-1",
] as const;

export const missingResultProof =
  "needs a proof system: needs the sparq-zk-result/5 package, which is not installed";
export const missingAggregate =
  "needs joint computation: needs the sparq-aggregate/1 package, which is not installed";
