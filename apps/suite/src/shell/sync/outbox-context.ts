// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import type { Outbox, QueueingStorageClient } from "@jeswr/suite-sdk/offline";
import { createContext, useContext } from "react";
import type { createRealOutbox } from "../lib/real-outbox";
import type { SuiteAccount } from "../session/types";

export interface OutboxSession {
  account: SuiteAccount;
  outbox: Outbox;
  adapter: ReturnType<typeof createRealOutbox>;
  storage: QueueingStorageClient | null;
  signal: AbortSignal;
}

// Keep consumers independent of provider setup and browser-only account backends.
export const OutboxSessionContext = createContext<OutboxSession | null>(null);

export function useOutboxSession() {
  return useContext(OutboxSessionContext);
}
