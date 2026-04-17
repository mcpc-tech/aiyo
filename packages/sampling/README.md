# @mcpc-tech/aiyo-sampling

MCP Sampling integration package for `@mcpc-tech/aiyo`.

Use this package when you want the adapter to route LLM calls through an **MCP Sampling** provider — i.e. the connected MCP client (such as VS Code Copilot) handles the actual model call.

## Install

```bash
pnpm add @mcpc-tech/aiyo-sampling
```

## Quick start

### As a library

```ts
import { Hono } from "hono";
import { createAiyo } from "@mcpc-tech/aiyo-sampling";

const adapter = createAiyo({
  defaultModel: "copilot/gpt-4o-mini",
  defaultSamplingConfig: { server },
});

const app = new Hono();
app.get("/v1/models", adapter.honoHandler());
app.post("/v1/chat/completions", adapter.honoHandler());
app.post("/v1/responses", adapter.honoHandler());
app.post("/v1/messages", adapter.honoHandler());
```

### As a stdio MCP server

```bash
npx aiyo-sampling
```

This starts:

1. An MCP server on **stdio** — exposes an `ask_ai` tool that the connected MCP client can invoke.
2. An HTTP server on **port 3456** (configurable via `PORT` env var) — exposes OpenAI-compatible endpoints.

#### MCP client config (e.g. VS Code `settings.json`)

```json
{
  "mcp.servers": {
    "sampling-aiyo": {
      "command": "npx",
      "args": ["@mcpc-tech/aiyo-sampling"]
    }
  }
}
```

## What this package adds

Compared with the core package, this package wires in:

- MCP Sampling-backed `runtimeFactory`
- MCP Sampling-backed `listModels`

## Helper exports

This package also exports these helpers when you want lower-level control:

- `createSamplingRuntimeFactory`
- `createSamplingListModelsResolver`

It re-exports the core adapter types and helpers from `@mcpc-tech/aiyo`.
