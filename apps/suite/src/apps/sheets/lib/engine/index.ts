// AUTHORED-BY Codex GPT-6.1-Sol
import type { MountEngine } from "../contract";

export async function loadEngine(): Promise<MountEngine> {
  return (await import("./univer")).mountUniver;
}
