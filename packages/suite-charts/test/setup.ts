// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
