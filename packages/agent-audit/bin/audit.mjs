#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
import { runAuditCli } from "../dist/index.js";

process.exitCode = await runAuditCli(process.argv.slice(2), console.log);
