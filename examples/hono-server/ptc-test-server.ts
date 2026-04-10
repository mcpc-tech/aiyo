/**
 * Test server for programmatic tool calling (PTC) using a plain OpenAI-compatible provider.
 * Bypasses ACP entirely — connects directly to any OpenAI-compatible API.
 *
 * Usage:
 *   # OpenRouter
 *   OPENAI_BASE_URL=https://openrouter.ai/api/v1 OPENAI_API_KEY=sk-xxx \
 *     pnpm tsx examples/hono-server/ptc-test-server.ts
 *
 *   # OpenAI
 *   OPENAI_API_KEY=sk-xxx pnpm tsx examples/hono-server/ptc-test-server.ts
 *
 *   # Local (Ollama, LMStudio, etc.)
 *   OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen3:8b \
 *     pnpm tsx examples/hono-server/ptc-test-server.ts
 *
 * Then test with:
 *   pnpm tsx examples/ai-sdk-client/client.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createOpenAI } from "@ai-sdk/openai";
import { createACP2OpenAI } from "../../src/index.js";
import { createJavaScriptCodeExecutionPlugin } from "../../src/programmatic-tool-loop-plugin.js";

// Load .env from project root or examples/hono-server/
for (const envPath of [
  resolve(import.meta.dirname, ".env"),
  resolve(import.meta.dirname, "../../.env"),
]) {
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
    console.log(`📄 Loaded env from ${envPath}`);
    break;
  }
}

const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const apiKey = process.env.OPENAI_API_KEY || "dummy";
const defaultModel = process.env.OPENAI_MODEL || "claude-sonnet-4-20250514";

const openai = createOpenAI({ baseURL, apiKey });

const app = new Hono();

const acp2openai = createACP2OpenAI({
  defaultModel,
  runtimeFactory: ({ modelId }) => ({
    model: openai.chat(modelId || defaultModel),
    modelName: modelId || defaultModel,
  }),
  plugins: [
    createJavaScriptCodeExecutionPlugin({
      name: "ptc",
      toolNames: [
        "get_launch_count",
        "get_weather",
        "calculate",
        "get_current_time",
        "search_knowledge",
      ],
      mapExecutionResult: async (result) => {
        console.log("[PTC] Generated code:\n" + result.source);
        console.log("[PTC] Done:", {
          value: result.value,
          logs: result.logs,
          tools: result.toolHistory.map(
            (t) => `${t.toolName}(${JSON.stringify(t.args)})`,
          ),
        });
        return result.value;
      },
    }),
  ],
});

app.get("/health", (c) => c.json({ status: "ok", service: "ptc-test-server" }));
app.get("/v1/models", acp2openai.honoHandler());
app.post("/v1/chat/completions", acp2openai.honoHandler());

const port = parseInt(process.env.PORT || "3456", 10);
serve({ fetch: app.fetch, port });

console.log(`🚀 PTC Test Server on http://127.0.0.1:${port}`);
console.log(`   Provider: ${baseURL}`);
console.log(`   Model:    ${defaultModel}`);
console.log(
  `   Tools:    get_launch_count, get_weather, calculate, get_current_time, search_knowledge`,
);
