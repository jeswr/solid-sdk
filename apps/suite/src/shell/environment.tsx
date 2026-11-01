// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createContext, useContext } from "react";
import { type SuiteEnv, suiteEnv } from "./lib/env";

// The server passes capability overrides explicitly: SUITE_TEST_CAPS is never a public env variable.
export const SuiteEnvironmentContext = createContext<SuiteEnv | null>(null);
export function useSuiteEnvironment(): SuiteEnv {
  return useContext(SuiteEnvironmentContext) ?? suiteEnv();
}
