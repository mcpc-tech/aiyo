#!/usr/bin/env node

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const child = spawn(
  "pnpm",
  ["exec", "tsx", "packages/cli/src/index.ts", "launch", ...args],
  {
    stdio: "inherit",
    env: process.env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`[acp2openai] Failed to launch CLI: ${error.message}`);
  process.exit(1);
});
