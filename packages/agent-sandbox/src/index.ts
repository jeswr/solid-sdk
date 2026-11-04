// AUTHORED-BY Claude Opus 5.5
/**
 * @jeswr/agent-sandbox: a fail-closed policy gate for AI agents. Global rules (an agent
 * mandate), the rules attached to each record (ODRL), and send/spend limits decide every tool
 * call an agent, its generated code, or an MCP client makes. The demo world lives at
 * `@jeswr/agent-sandbox/world`, the QuickJS code box at `./code` and the MCP adapter at `./mcp`.
 */
export {
  type Allowance,
  type Audience,
  type AutomationEvent,
  type AutomationRule,
  type AutomationRun,
  eventText,
  type RuleContext,
  type RulePolicy,
  type RunEnvironment,
  type Runner,
  ruleMandate,
  ruleTools,
  runAutomation,
  scriptedModel,
  senderOf,
  singleAddress,
  type Trigger,
  validateRule,
  wants,
} from "./automation.js";
export { type Directory, groupResolver, joinNames, nameOf, shortName } from "./directory.js";
export {
  actionCovers,
  type CallLock,
  type CatalogueEntry,
  createLock,
  createSandbox,
  effectiveMandate,
  type HeldCall,
  type Sandbox,
  type SandboxOptions,
} from "./gate.js";
export { standInJudge } from "./judges.js";
export { type Candidate, type Commitment, checkLimits, type LimitBreach } from "./limits.js";
export {
  actionWords,
  constraintWords,
  describeMandate,
  describePolicy,
  dutyWords,
  limitWords,
  ruleWords,
} from "./policy-text.js";
export { DecisionRecord, type RecordEntry } from "./record.js";
export {
  type AgentConversation,
  type AgentEvent,
  type AgentModel,
  agentSystemPrompt,
  type ModelToolCall,
  type ModelToolResult,
  type ModelTurn,
  resultText,
  runAgent,
} from "./runners/agent.js";
export {
  checkPaths,
  ENFORCEMENT_PATHS,
  type EnforcementPath,
  type PathCheck,
} from "./runners/paths.js";
export {
  compareModes,
  createWorldSandbox,
  DEMO_START,
  type DemoClock,
  outcomeOf,
  runStory,
  type Score,
  type StoryEvent,
  type StoryRun,
  type Verdict,
  verdict,
  type WorldSandboxOptions,
} from "./runners/story.js";
export type * from "./types.js";
