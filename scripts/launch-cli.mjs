#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = resolve(rootDir, "examples/hono-server/aiyo.config.json");
const child = spawn("pnpm", ["exec", "tsx", "packages/cli/src/bin.ts", "launch", ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    AIYO_CONFIG: process.env.AIYO_CONFIG || defaultConfigPath,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`[aiyo] Failed to launch CLI: ${error.message}`);
  process.exit(1);
});
