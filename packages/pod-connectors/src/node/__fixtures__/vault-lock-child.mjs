// AUTHORED-BY Codex GPT-6.1-Sol
import fs, { open, unlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { FileVaultStore } from "../../../dist/node/vault-store.js";

const [directory, id, marker] = process.argv.slice(2);
const originalOpen = fs.open;
let contended = false;
fs.open = async (...args) => {
  try {
    return await originalOpen(...args);
  } catch (error) {
    if (error.code === "EEXIST" && String(args[0]).endsWith(".lock") && !contended) {
      contended = true;
      process.send("contended");
    }
    throw error;
  }
};
syncBuiltinESMExports();
const store = new FileVaultStore(directory);
process.send("ready");
process.once("message", async () => {
  try {
    await store.withLock(id, async () => {
      // Independent OS-level exclusion detects any overlapping critical sections.
      const exclusive = await open(marker, "wx", 0o600);
      const release = new Promise((resolve) => process.once("message", resolve));
      process.send("entered");
      await release;
      await exclusive.close();
      await unlink(marker);
    });
    process.send("released");
    process.disconnect();
  } catch {
    process.send("failed");
    process.exitCode = 1;
    process.disconnect();
  }
});
