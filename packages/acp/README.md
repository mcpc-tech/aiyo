# @mcpc-tech/aiyo-acp

ACP integration package for `@mcpc-tech/aiyo`.

Use this package when you want the adapter to boot an **ACP provider runtime** from `defaultACPConfig` or from request-level `extra_body.acpConfig`.

## Install

```bash
pnpm add @mcpc-tech/aiyo-acp
```

## Quick start

```ts
import { Hono } from "hono";
import { createAiyo } from "@mcpc-tech/aiyo-acp";

const adapter = createAiyo({
  defaultModel: "default",
  defaultACPConfig: {
    command: "opencode",
    args: ["acp"],
    session: {
      cwd: process.cwd(),
      mcpServers: [],
    },
  },
});

const app = new Hono();
app.get("/v1/models", adapter.honoHandler());
app.post("/v1/chat/completions", adapter.honoHandler());
app.post("/v1/responses", adapter.honoHandler());
app.post("/v1/messages", adapter.honoHandler());
```

## What this package adds

Compared with the core package, this package wires in:

- ACP-backed `runtimeFactory`
- ACP-backed `listModels`
- ACP tool wrapping through `transformTools`
- ACP dynamic tool-call unwrapping through `normalizeToolCall`

## Request-level ACP config

You can still choose the ACP session per request:

```ts
extra_body: {
  acpConfig: {
    command: "opencode",
    args: ["acp"],
    session: {
      cwd: process.cwd(),
      mcpServers: [],
    },
  },
}
```

## Helper exports

This package also exports these helpers when you want lower-level control:

- `createACPRuntimeFactory`
- `createACPListModelsResolver`
- `createACPToolTransformer`
- `createACPToolCallNormalizer`

It re-exports the core adapter types and helpers from `@mcpc-tech/aiyo`.
