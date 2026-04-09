# @yaonyan/acp2openai-compatible

OpenAI- and Anthropic-compatible HTTP adapter for ACP (Agent Client Protocol) providers, built on top of the AI SDK.

This package lets you expose an ACP-backed agent or model through familiar OpenAI- or Anthropic-style endpoints, so existing SDK clients and tools can talk to it with minimal changes.

## What it supports

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- Streaming responses over SSE
- OpenAI function calling / tool calling
- Request-level ACP configuration via `extra_body.acpConfig`
- Framework adapters for standard Web `Request`, Express, and Hono

## What it does not try to be

This package is **not** a full OpenAI server replacement. Today it focuses on chat-style flows and tool calls. Endpoints such as embeddings, images, audio, files, batches, and assistants are out of scope.

## Installation

```bash
npm install @yaonyan/acp2openai-compatible
```

## Requirements

- Node.js `>= 18`
- An ACP-compatible command or runtime

## Quick start

### Library usage with default ACP config

Use `defaultACPConfig` when you want the adapter instance itself to know how to start the ACP provider.

```ts
import { Hono } from "hono";
import { createACP2OpenAI } from "@yaonyan/acp2openai-compatible";

const adapter = createACP2OpenAI({
  defaultModel: "default",
  defaultACPConfig: {
    command: "claude-agent-acp",
    args: [],
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

### Request-level ACP config via `extra_body`

Use request-level config when the caller should decide which ACP provider/session to use.

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "dummy",
});

const response = await client.chat.completions.create({
  model: "default",
  messages: [{ role: "user", content: "Hello!" }],
  extra_body: {
    acpConfig: {
      command: "claude-agent-acp",
      args: [],
      session: {
        cwd: process.cwd(),
        mcpServers: [],
      },
    },
  },
});

console.log(response.choices[0].message.content);
```

### Important config rule

You must provide ACP config in **one** of these two places:

- `createACP2OpenAI({ defaultACPConfig })`, or
- request-level `extra_body.acpConfig`

Without one of those, chat and responses requests will fail because the adapter has no ACP runtime to call.

## Included examples

This repo includes two runnable example servers:

- `examples/hono-server/server.ts`
- `examples/express/server.ts`

From the repo root:

```bash
pnpm run example:hono
pnpm run example:express
```

For the shortest Hono startup guide, see `examples/hono-server/README.md`.

## CLI launcher

This repo now includes a small workspace CLI in `packages/cli`.

From the repo root:

```bash
pnpm install
pnpm run launch opencode
pnpm run launch claude
```

The launcher starts a local OpenAI-compatible proxy backed by your ACP runtime. For `opencode`, it rewrites the local provider config before opening the client. For `claude`, it launches Claude Code with session-level Anthropic settings that point it at the same local proxy.

### Local config file for the Hono example

The Hono example includes file/env loading for local development. That config loading is implemented in the example app, **not** in the core library.

Example local config:

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

You can point the example server at a different config file with:

```bash
export ACP2OPENAI_CONFIG=/path/to/config.json
```

The example Hono server uses `examples/hono-server/acp2openai.config.json` by default. You can still override it with `ACP2OPENAI_CONFIG` when needed.

## API surface

### `createACP2OpenAI(config?)`

Creates an `ACP2OpenAI` adapter instance.

#### Config

- `defaultACPConfig?: ACPProviderSettings`
- `defaultModel?: string`
- `middleware?: ACP2OpenAIMiddleware | ACP2OpenAIMiddleware[]`
- `plugins?: ACP2OpenAIPlugin | ACP2OpenAIPlugin[]`

### `middleware`

Use `middleware` when you want to rewrite the normalized OpenAI request or the final AI SDK call params before `generateText` / `streamText` runs.

The middleware receives a mutable context with:

- `phase`: `"request"`, `"params"`, or `"result"`
- `endpoint`: `"chat.completions"`, `"responses"`, or `"messages"`
- `callType`: `"generateText"` or `"streamText"`
- `request`: the normalized chat-completions request
- `params`: the final AI SDK call params in the `"params"` / `"result"` phases
- `result`: the mutable stream result in the `"result"` phase

```ts
const adapter = createACP2OpenAI({
  defaultModel: "default",
  defaultACPConfig,
  middleware: (ctx) => {
    if (ctx.phase === "request") {
      ctx.request.temperature ??= 0.2;
      ctx.request.messages = [
        { role: "system", content: "Always be concise." },
        ...ctx.request.messages,
      ];
    }

    if (ctx.phase === "params" && ctx.callType === "streamText") {
      ctx.params!.topK = 20;
    }

    if (ctx.phase === "result" && ctx.result?.eventType === "text-delta") {
      ctx.result.textDelta = `[patched] ${ctx.result.textDelta ?? ""}`;
    }
  },
});
```

Use the `request` phase when you want to change OpenAI-facing fields such as `model`, `messages`, `tools`, `tool_choice`, `temperature`, or `extra_body`.
Use the `params` phase when you want to directly override the final params sent to `generateText` / `streamText`.
Use the `result` phase when you want to rewrite `streamText` output, including per-chunk text deltas, streamed tool calls, or the final finish reason.

### `plugins`

Use `plugins` when you want to work at the **unified final-result layer** instead of writing separate OpenAI / Responses / Anthropic adapters yourself.

A plugin can:

- add normal `middleware`
- inspect the normalized final result through `onResult`
- return `overrideResult` to short-circuit the default protocol mapping
- call `runModel(...)` to continue the conversation from plugin code

That makes plugins a good fit for **programmatic tool loops**, where the plugin:

1. collapses many tools into one wrapper tool
2. watches for that wrapper tool call in `onResult`
3. executes a hidden loop internally
4. returns a single final normalized result back to the core adapter

`createProgrammaticToolLoopPlugin(...)` is the low-level generic helper:

```ts
import {
  createACP2OpenAI,
  createProgrammaticToolLoopPlugin,
} from "@yaonyan/acp2openai-compatible";

const adapter = createACP2OpenAI({
  defaultModel: "default",
  defaultACPConfig,
  plugins: [
    createProgrammaticToolLoopPlugin({
      match: (toolCall) => toolCall.toolName === "tool_router",
      execute: async ({ toolCall }) => ({
        output: {
          selectedTool: "lookup_weather",
          args: toolCall.input,
        },
      }),
      prepareNextRequest: (request) => ({
        ...request,
        tools: [
          {
            type: "function",
            function: {
              name: "lookup_weather",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      }),
    }),
  ],
});
```

If you want something closer to Claude's **programmatic tool calling**, use `createJavaScriptCodeExecutionPlugin(...)`.

This implements a **cross-request tool bridge**:

1. The model sees ONE tool (e.g. `code_execution`) and writes JS code in the input
2. The plugin starts executing the JS in a `node:vm` sandbox
3. When the code calls `await tools.read_file(args)`, the sandbox **suspends**
4. The OpenAI layer **immediately responds** with `tool_calls: [{ name: "read_file", args }]`
5. The user/agent executes the real tool and sends a new request with the `tool_result`
6. The plugin **resumes** the sandbox — `tools.read_file()` returns the result
7. Repeat for each `tools.*` call in the JS code
8. When the JS finishes, the final value becomes the `tool_result` for the model

```ts
import {
  createACP2OpenAI,
  createJavaScriptCodeExecutionPlugin,
} from "@yaonyan/acp2openai-compatible";

const adapter = createACP2OpenAI({
  defaultModel: "default",
  defaultACPConfig,
  plugins: [
    createJavaScriptCodeExecutionPlugin({
      match: (toolCall) => toolCall.toolName === "code_execution",
      toolNames: ["read_file", "write_file", "list_dir"],
    }),
  ],
});
```

The model emits a tool call like:

```json
{
  "toolName": "code_execution",
  "input": {
    "code": "const data = await tools.read_file({ path: '/tmp/test.txt' });\nconst lines = data.split('\\n');\nawait tools.write_file({ path: '/tmp/out.txt', content: lines.join(',') });\nreturn { lineCount: lines.length };"
  }
}
```

The key difference from a normal tool loop: the JS sandbox **stays alive across multiple HTTP request/response cycles**. Each `tools.*` call suspends the sandbox and returns a real `tool_calls` response to the caller; the next request with `tool_result` resumes it.

This uses Node's `vm` module, so it is meant for **trusted or partially trusted** code.

### `adapter.handleRequest(request)`

Framework-agnostic Web API handler for environments that use standard `Request` / `Response` objects.

Works well with:

- Cloudflare Workers
- Bun
- Deno
- any Web-standard runtime

### `adapter.expressHandler()`

Returns Express-style middleware.

### `adapter.honoHandler()`

Returns Hono-style middleware.

### `adapter.handleChatCompletion(req)`

Low-level non-streaming handler that returns an OpenAI-compatible chat completion object.

### `adapter.handleChatCompletionStream(req)`

Low-level streaming handler that yields SSE-formatted chunks.

### `adapter.handleResponses(req)`

Low-level non-streaming handler for the OpenAI `responses` shape.

## Endpoint notes

### `GET /v1/models`

`GET /v1/models` needs `defaultACPConfig`, because the adapter must initialize an ACP session to discover available models.

### `POST /v1/chat/completions`

Accepts standard OpenAI chat-completions fields, plus `extra_body` for ACP / AI SDK extras.

### `POST /v1/responses`

Implemented by translating the request to chat-completions internally, then mapping the result back into the OpenAI responses shape.

## Extra parameters

ACP-specific and AI SDK-specific extras are passed through `extra_body`.

```ts
{
  extra_body: {
    acpConfig: {
      command: 'claude-agent-acp',
      args: [],
      session: {
        cwd: process.cwd(),
        mcpServers: [],
      },
      env: {
        MY_FLAG: '1'
      }
    },
    topK: 20,
    seed: 42
  }
}
```

## How it works

1. Receives an OpenAI- or Anthropic-compatible HTTP request.
2. Normalizes that request into the adapter's shared chat shape.
3. Resolves an execution runtime from `runtimeFactory`, or falls back to ACP config from `extra_body.acpConfig` / `defaultACPConfig`.
4. Uses the AI SDK to run generation or streaming.
5. Maps the result back into OpenAI- or Anthropic-compatible response shapes.

## Testing

### Main commands

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:all
npm run test:coverage
```

### Test layout

- `src/index.test.ts`: fast unit tests with mocks
- `src/index.integration.test.ts`: real ACP integration tests

Integration tests expect `claude-agent-acp` to be available in `PATH`. Tests that require it are skipped automatically when the command is missing.

For more detail, see [`TEST.md`](./TEST.md).

## Related packages and specs

- [ACP (Agent Client Protocol)](https://github.com/mcpc-tech/mcpc)
- [AI SDK](https://ai-sdk.dev/)
- [OpenAI API docs](https://platform.openai.com/docs/api-reference)

## License

MIT
