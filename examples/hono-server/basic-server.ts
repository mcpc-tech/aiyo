import { serve } from "@hono/node-server";
import { createOpenAI } from "@ai-sdk/openai";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAiyo } from "@mcpc-tech/aiyo";

for (const envPath of [
  resolve(import.meta.dirname, ".env"),
  resolve(import.meta.dirname, "../../.env"),
]) {
  if (!existsSync(envPath)) continue;

  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }

  console.log(`📄 Loaded env from ${envPath}`);
  break;
}

const port = Number(process.env.PORT || 3456);
const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const apiKey = process.env.OPENAI_API_KEY || "dummy";
const defaultModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

const openai = createOpenAI({ baseURL, apiKey });
const adapter = createAiyo({
  defaultModel,
  runtimeFactory: ({ modelId }) => ({
    model: openai.chat(modelId || defaultModel),
    modelName: modelId || defaultModel,
  }),
});

const app = new Hono();

app.get("/", (c) =>
  c.json({
    name: "aiyo-hono-basic",
    mode: "basic",
    provider: baseURL,
    model: defaultModel,
    endpoints: ["/health", "/v1/models", "/v1/chat/completions", "/v1/responses", "/v1/messages"],
  }),
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "basic-server",
    mode: "basic",
    provider: baseURL,
    model: defaultModel,
  }),
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
console.log(`🧠 Provider: ${baseURL}`);
console.log(`🤖 Model: ${defaultModel}`);
console.log("📋 Endpoints: /health, /v1/models, /v1/chat/completions, /v1/responses, /v1/messages");
