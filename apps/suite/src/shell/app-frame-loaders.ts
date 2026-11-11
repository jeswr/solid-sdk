// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";

export const loadShell = () => import("./suite-shell");
export const loadGuard = () => import("./session/session-guard");

/** Load authenticated chrome while signing in, without opening any pod data. */
export async function preloadAppFrame() {
  await Promise.all([loadShell(), loadGuard()]);
}
