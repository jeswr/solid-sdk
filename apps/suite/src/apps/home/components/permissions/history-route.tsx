// AUTHORED-BY Claude Opus 5.5
"use client";
import { AccessRequestsGate } from "../requests/requests-route";
import { HistoryPage } from "./history-page";

/** Answered requests exist only where access requests do. */
export function HistoryRoute() {
  return (
    <AccessRequestsGate>
      <HistoryPage />
    </AccessRequestsGate>
  );
}
