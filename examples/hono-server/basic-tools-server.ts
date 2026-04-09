/**
 * Hono server with basic tool calling (no programmatic execution).
 *
 * This server passes tools directly to the ACP without any transformation.
 *
 * Usage:
 *   ACP2OPENAI_CONFIG=examples/hono-server/acp2openai.config.json \
 *     pnpm tsx examples/hono-server/basic-tools-server.ts
 *
 * Then test with:
 *   pnpm tsx examples/ai-sdk-client/client.ts
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createACP2OpenAI } from "../../src/index.js";

interface FileConfig {
  port?: number;
  defaultModel?: string;
  acp?: {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
}

function loadFileConfig(): FileConfig {
  const configPath = resolve(
    process.env.ACP2OPENAI_CONFIG || "acp2openai.config.json",
  );
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as FileConfig;
  } catch (e) {
    console.warn(`Failed to parse config file ${configPath}:`, e);
    return {};
  }
}

const file = loadFileConfig();
const port = Number(process.env.PORT || file.port || 3456);

const app = new Hono();

const acp2openai = createACP2OpenAI({
  defaultModel: process.env.ACP_MODEL || file.defaultModel,
  defaultACPConfig: {
    command: process.env.ACP_COMMAND || file.acp?.command || "claude-agent-acp",
    args: file.acp?.args ?? [],
    env: file.acp?.env,
    session: {
      cwd: process.env.ACP_CWD || file.acp?.cwd || process.cwd(),
      mcpServers: [],
    },
  },
});

// Health check
app.get("/health", (c) =>
  c.json({ status: "ok", service: "basic-tools-server" }),
);

// Use honoHandler which correctly dispatches stream vs non-stream
app.get("/v1/models", acp2openai.honoHandler());
app.post("/v1/chat/completions", acp2openai.honoHandler());

serve({ fetch: app.fetch, port });

console.log(`🚀 Basic Tools Server running on http://127.0.0.1:${port}`);
console.log("📋 Available endpoints:");
console.log(`   POST http://127.0.0.1:${port}/v1/chat/completions`);
console.log(`   GET  http://127.0.0.1:${port}/v1/models`);
console.log(`   GET  http://127.0.0.1:${port}/health`);
console.log();
console.log("Tools are passed directly to ACP (no programmatic execution).");
