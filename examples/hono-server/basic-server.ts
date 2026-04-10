import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createACP2OpenAI } from "@yaonyan/acp2openai-acp";

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
  } catch (error) {
    console.warn(`[basic-server] Failed to parse ${configPath}:`, error);
    return {};
  }
}

function parseACPArgs(fallback?: string[]): string[] {
  const raw = process.env.ACP_ARGS;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return raw
        .split(" ")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }

  return fallback ?? [];
}

const file = loadFileConfig();
const port = Number(process.env.PORT || file.port || 3456);
const acpCommand = process.env.ACP_COMMAND || file.acp?.command || "codebuddy";
const acpArgs = parseACPArgs(file.acp?.args);
const acpCwd = process.env.ACP_CWD || file.acp?.cwd || process.cwd();

const adapter = createACP2OpenAI({
  defaultModel: process.env.ACP_MODEL || file.defaultModel,
  defaultACPConfig: {
    command: acpCommand,
    args: acpArgs,
    env: file.acp?.env,
    session: {
      cwd: acpCwd,
      mcpServers: [],
    },
  },
});

const app = new Hono();

app.get("/", (c) =>
  c.json({
    name: "acp2openai-hono-basic",
    mode: "basic",
    endpoints: [
      "/health",
      "/v1/models",
      "/v1/chat/completions",
      "/v1/responses",
      "/v1/messages",
    ],
  }),
);

app.get("/health", (c) =>
  c.json({ status: "ok", service: "basic-server", mode: "basic" }),
);

app.get("/v1/models", adapter.honoHandler());
app.post("/v1/chat/completions", adapter.honoHandler());
app.post("/v1/responses", adapter.honoHandler());
app.post("/v1/messages", adapter.honoHandler());

app.onError((error, c) => {
  console.error("[basic-server] Unhandled error:", error);
  return c.json({ error: String(error) }, 500);
});

serve({
  fetch: app.fetch,
  port,
});

console.log(`🚀 Basic server running on http://127.0.0.1:${port}`);
console.log(`🤖 ACP command: ${acpCommand} ${acpArgs.join(" ")}`.trim());
console.log(`📁 ACP cwd: ${acpCwd}`);
console.log(
  "📋 Endpoints: /health, /v1/models, /v1/chat/completions, /v1/responses, /v1/messages",
);
