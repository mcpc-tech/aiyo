# @yaonyan/acp2openai-compatible

Provider-agnostic OpenAI- and Anthropic-compatible HTTP adapter built on top of the AI SDK.

This repo now has a **split package layout**:

- `@yaonyan/acp2openai-compatible`: generic core adapter
- `@yaonyan/acp2openai-acp`: ACP runtime integration for the core adapter
- `@yaonyan/acp2openai-ptc`: Programmatic Tool Calling (PTC) plugin and Deno-backed runtime helpers
- `@yaonyan/acp2openai-cli`: local launcher built on top of the ACP package

## Supported endpoints

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- SSE streaming for chat completions

## Package guide

### `@yaonyan/acp2openai-compatible`

Use the core package when you want to plug in **your own AI SDK runtime** via `runtimeFactory`.

Install:

```bash
pnpm add @yaonyan/acp2openai-compatible ai openai zod
```

Minimal example:

```ts
import { Hono } from "hono";
import { createOpenAI } from "@ai-sdk/openai";
import { createACP2OpenAI } from "@yaonyan/acp2openai-compatible";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const adapter = createACP2OpenAI({
  defaultModel: "gpt-4o-mini",
  runtimeFactory: ({ modelId }) => ({
    model: openai.chat(modelId || "gpt-4o-mini"),
    modelName: modelId || "gpt-4o-mini",
  }),
  listModels: ["gpt-4o-mini"],
});

const app = new Hono();
app.get("/v1/models", adapter.honoHandler());
app.post("/v1/chat/completions", adapter.honoHandler());
app.post("/v1/responses", adapter.honoHandler());
app.post("/v1/messages", adapter.honoHandler());
```

Core config highlights:

- `runtimeFactory`: required unless you use a provider integration package such as `@yaonyan/acp2openai-acp`
- `listModels`: optional model list resolver for `GET /v1/models`
- `middleware`: request / params / result rewrite hooks
- `plugins`: unified final-result plugins, including PTC
- `transformTools`: provider-specific tool wrapping hook
- `normalizeToolCall`: provider-specific tool-call normalization hook

### `@yaonyan/acp2openai-acp`

Use the ACP package when you want the old **ACP-backed experience**:

```bash
pnpm add @yaonyan/acp2openai-acp
```

```ts
import { Hono } from "hono";
import { createACP2OpenAI } from "@yaonyan/acp2openai-acp";

const adapter = createACP2OpenAI({
  defaultModel: "default",
  defaultACPConfig: {
    command: "codebuddy",
    args: ["--acp"],
    session: {
      cwd: process.cwd(),
      mcpServers: [],
    },
  },
});

const app = new Hono();
app.get("/v1/models", adapter.honoHandler());
app.post("/v1/chat/completions", adapter.honoHandler());
```

The ACP package injects:

- ACP runtime creation
- ACP tool wrapping
- ACP tool-call unwrapping
- ACP-backed model discovery for `GET /v1/models`

It also still supports request-level ACP config through `extra_body.acpConfig`.

### `@yaonyan/acp2openai-ptc`

Use the PTC package when you want **programmatic tool calling**:

```bash
pnpm add @yaonyan/acp2openai-ptc
```

```ts
import { createACP2OpenAI } from "@yaonyan/acp2openai-compatible";
import { createJavaScriptCodeExecutionPlugin } from "@yaonyan/acp2openai-ptc";

const adapter = createACP2OpenAI({
  defaultModel: "gpt-4o-mini",
  runtimeFactory: ({ modelId }) => ({
    model: openai.chat(modelId || "gpt-4o-mini"),
    modelName: modelId || "gpt-4o-mini",
  }),
  listModels: ["gpt-4o-mini"],
  plugins: [
    createJavaScriptCodeExecutionPlugin({
      name: "ptc",
      toolNames: ["read_file", "write_file", "list_dir"],
    }),
  ],
});
```

For architecture details, see [`docs/ptc-architecture.md`](./docs/ptc-architecture.md).

## Examples in this repo

### Hono examples

The Hono example directory now keeps only **two maintained servers**:

- `examples/hono-server/basic-server.ts`: ACP-backed server
- `examples/hono-server/ptc-server.ts`: direct OpenAI-compatible provider + PTC

From the repo root:

```bash
pnpm install
pnpm run example:hono
pnpm run example:hono:ptc
```

### Express example

```bash
pnpm run example:express
```

### AI SDK client example

```bash
pnpm run client:generate
pnpm run client:stream
```

## CLI launcher

The workspace also ships `@yaonyan/acp2openai-cli`.

From the repo root:

```bash
pnpm install
pnpm run launch opencode
pnpm run launch claude
```

## Local config for the ACP-backed Hono example

The basic Hono example reads `examples/hono-server/acp2openai.config.json` by default.
You can override that with:

```bash
export ACP2OPENAI_CONFIG=/path/to/config.json
```

Example config:

```json
{
  "port": 3456,
  "defaultModel": "default",
  "acp": {
    "command": "codebuddy",
    "args": ["--acp"],
    "cwd": "/path/to/workspace"
  }
}
```

## Testing

Main commands:

```bash
pnpm run typecheck
pnpm run typecheck:workspace
pnpm run build
pnpm run build:workspace
pnpm run test
pnpm run test:integration
```

For more detail, see [`TEST.md`](./TEST.md).

## Related packages and specs

- [ACP (Agent Client Protocol)](https://github.com/mcpc-tech/mcpc)
- [AI SDK](https://ai-sdk.dev/)
- [OpenAI API docs](https://platform.openai.com/docs/api-reference)

## License

MIT
