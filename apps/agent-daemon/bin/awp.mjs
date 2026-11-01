#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
import { runAwpCli } from "../dist/index.js";

process.exitCode = runAwpCli(process.argv.slice(2));
