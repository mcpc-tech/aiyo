# @yaonyan/acp2openai-ptc

Programmatic Tool Calling (PTC) package for `@yaonyan/acp2openai-compatible`.

This package contains the JavaScript code-execution plugin, the lower-level programmatic tool loop helper, and the Deno-backed runtime factory used to keep execution state across multiple tool calls.

## Install

```bash
pnpm add @yaonyan/acp2openai-ptc
```

## Quick start

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { createACP2OpenAI } from "@yaonyan/acp2openai-compatible";
import { createJavaScriptCodeExecutionPlugin } from "@yaonyan/acp2openai-ptc";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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

## Main exports

- `createJavaScriptCodeExecutionPlugin`
- `createProgrammaticToolLoopPlugin`
- `createJavaScriptProgrammaticToolLoopPlugin`
- `buildCodeExecutionSystemPrompt`
- `createDenoCodeExecutionRuntimeFactory`

## When to use which export

- `createJavaScriptCodeExecutionPlugin`: the main high-level PTC entry point
- `createProgrammaticToolLoopPlugin`: lower-level generic helper for custom tool-loop behavior
- `createDenoCodeExecutionRuntimeFactory`: custom runtime wiring when you need to control the execution backend directly

## Architecture

PTC keeps a sandbox session alive across multiple HTTP request / response turns:

1. the model emits a wrapper tool call containing JavaScript
2. the sandbox starts executing that JavaScript
3. each `await tools.some_tool(args)` suspends execution
4. the adapter returns a real tool call to the client
5. the next request with the tool result resumes the same sandbox session

For the full design, see [`../../docs/ptc-architecture.md`](../../docs/ptc-architecture.md).
