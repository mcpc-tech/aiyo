import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACP2OpenAI,
  buildCodeExecutionSystemPrompt,
  createJavaScriptCodeExecutionPlugin,
  createProgrammaticToolLoopPlugin,
  type AnthropicMessagesRequest,
  type JavaScriptCodeExecutionPluginConfig,
  type OpenAIChatCompletionRequest,
  type OpenAIResponsesRequest,
} from "./index.js";

vi.mock("@mcpc-tech/acp-ai-provider", () => ({
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME: "acp.acp_provider_agent_dynamic_tool",
  acpTools: vi.fn((tools) => tools),
  createACPProvider: vi.fn(() => ({
    languageModel: vi.fn(() => "mocked-model"),
    initSession: vi.fn(async () => ({
      sessionId: "session_1",
      models: {
        availableModels: [
          { modelId: "default", name: "Default" },
          { modelId: "gpt-test", name: "GPT Test" },
        ],
        currentModelId: "default",
      },
    })),
    cleanup: vi.fn(),
    tools: undefined,
  })),
}));

vi.mock("ai", () => {
  const defaultUsage = {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  };

  const generateText = vi.fn(async (_params?: any) => ({
    text: "Mocked response text",
    finishReason: "stop",
    usage: defaultUsage,
    toolCalls: [],
  }));

  const streamText = vi.fn((params) => {
    const resultPromise = Promise.resolve(generateText(params)).then(
      (result) => ({
        text: result?.text ?? null,
        toolCalls: result?.toolCalls ?? [],
        finishReason: result?.finishReason ?? "stop",
        usage: result?.usage ?? defaultUsage,
      }),
    );

    return {
      textStream: (async function* () {
        const result = await resultPromise;
        if (typeof result.text === "string" && result.text.length > 0) {
          yield result.text;
        }
      })(),
      toolCalls: resultPromise.then((result) => result.toolCalls),
      finishReason: resultPromise.then((result) => result.finishReason),
      usage: resultPromise.then((result) => result.usage),
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) =>
        resultPromise.then(
          (result) =>
            resolve({
              toolCalls: Promise.resolve(result.toolCalls),
              finishReason: Promise.resolve(result.finishReason),
              usage: Promise.resolve(result.usage),
            }),
          reject,
        ),
    };
  });

  return {
    generateText,
    streamText,
    tool: vi.fn((def) => def),
    jsonSchema: vi.fn((schema) => schema),
    Output: {
      text: vi.fn(() => ({
        name: "text",
        responseFormat: Promise.resolve({ type: "text" }),
        parseCompleteOutput: vi.fn(async ({ text }: { text: string }) => text),
        parsePartialOutput: vi.fn(async ({ text }: { text: string }) => ({
          partial: text,
        })),
        createElementStreamTransform: vi.fn(() => undefined),
      })),
      json: vi.fn(() => ({
        name: "json",
        responseFormat: Promise.resolve({ type: "json" }),
        parseCompleteOutput: vi.fn(async ({ text }: { text: string }) =>
          JSON.parse(text),
        ),
        parsePartialOutput: vi.fn(async ({ text }: { text: string }) => {
          try {
            return { partial: JSON.parse(text) };
          } catch {
            return undefined;
          }
        }),
        createElementStreamTransform: vi.fn(() => undefined),
      })),
      object: vi.fn(({ schema, name, description }: any) => ({
        name: "object",
        responseFormat: Promise.resolve({
          type: "json",
          ...(schema != null && { schema }),
          ...(name != null && { name }),
          ...(description != null && { description }),
        }),
        parseCompleteOutput: vi.fn(async ({ text }: { text: string }) =>
          JSON.parse(text),
        ),
        parsePartialOutput: vi.fn(async ({ text }: { text: string }) => {
          try {
            return { partial: JSON.parse(text) };
          } catch {
            return undefined;
          }
        }),
        createElementStreamTransform: vi.fn(() => undefined),
      })),
    },
  };
});

describe("ACP2OpenAI (high-value unit tests)", () => {
  const defaultACPConfig = {
    command: "claude-agent-acp",
    args: [],
    session: {
      cwd: process.cwd(),
      mcpServers: [],
    },
  };

  let adapter: ACP2OpenAI;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ACP2OpenAI({
      defaultModel: "default",
      defaultACPConfig,
    });
  });

  it("maps core request params to AI SDK and returns OpenAI-compatible response", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7,
      max_tokens: 128,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      extra_body: { topK: 40, seed: 7 },
    };

    const res = await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
        maxOutputTokens: 128,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        topK: 40,
        seed: 7,
      }),
    );

    expect(res.object).toBe("chat.completion");
    expect(res.choices[0].message.role).toBe("assistant");
    expect(res.choices[0].message.refusal).toBeNull();
    expect(res.choices[0].logprobs).toBeNull();
  });

  it("converts function tool call + tool result message correctly", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [
        { role: "user", content: "What is weather?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"SF"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: '{"temp":72}',
        },
      ],
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "get_weather",
              }),
            ]),
          }),
          expect.objectContaining({
            role: "tool",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-result",
                toolCallId: "call_1",
                toolName: "tool",
                output: {
                  type: "json",
                  value: { temp: 72 },
                },
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("maps tool_choice=function to AI SDK toolChoice format", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "use tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "my_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "my_tool" },
      },
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: { type: "tool", toolName: "my_tool" },
      }),
    );
  });

  it("maps tool_choice=required to a forced tool when only one tool is available", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "use the only tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "only_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
      tool_choice: "required",
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: { type: "tool", toolName: "only_tool" },
      }),
    );
  });

  it("preserves tool_choice=required when multiple tools are available", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "use some tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "tool_a",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
        {
          type: "function",
          function: {
            name: "tool_b",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
      tool_choice: "required",
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: "required",
      }),
    );
  });

  it("wraps request tools with acpTools", async () => {
    const { generateText } = await import("ai");
    const { acpTools } = await import("@mcpc-tech/acp-ai-provider");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "use wrapped tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "my_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    };

    await adapter.handleChatCompletion(req);

    expect(acpTools).toHaveBeenCalledTimes(1);
    expect(acpTools).toHaveBeenCalledWith(
      expect.objectContaining({
        my_tool: expect.anything(),
      }),
    );

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          my_tool: expect.anything(),
        }),
      }),
    );
  });

  it("injects a system prompt that prioritizes request-scoped MCP tools", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "please use my_tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "my_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("## Request-scoped MCP tools"),
          }),
        ]),
      }),
    );

    const call = vi.mocked(generateText).mock.calls[0]?.[0];
    const systemMessage = call?.messages?.[0];
    expect(systemMessage).toMatchObject({ role: "system" });
    expect(String(systemMessage?.content)).toContain("`my_tool`");
    expect(String(systemMessage?.content)).toContain(
      "ALWAYS use tools from <available_tools> above when they can solve the task.",
    );
  });

  it("appends the MCP tool priority prompt only once when a system message already exists", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [
        { role: "system", content: "existing system guidance" },
        { role: "user", content: "please use my_tool" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "my_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    };

    await adapter.handleChatCompletion(req);
    await adapter.handleChatCompletion(req);

    const firstCall = vi.mocked(generateText).mock.calls[0]?.[0];
    const secondCall = vi.mocked(generateText).mock.calls[1]?.[0];
    const firstSystemContent = String(firstCall?.messages?.[0]?.content);
    const secondSystemContent = String(secondCall?.messages?.[0]?.content);

    expect(firstSystemContent).toContain("existing system guidance");
    expect(firstSystemContent).toContain("## Request-scoped MCP tools");
    expect(
      firstSystemContent.match(/## Request-scoped MCP tools/g)?.length,
    ).toBe(1);
    expect(
      secondSystemContent.match(/## Request-scoped MCP tools/g)?.length,
    ).toBe(1);
  });

  it("unwraps ACP dynamic wrapper tool call to real tool name and args", async () => {
    const { generateText } = await import("ai");

    vi.mocked(generateText).mockResolvedValueOnce({
      text: null,
      finishReason: "tool-calls",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      toolCalls: [
        {
          toolCallId: "outer_call",
          toolName: "acp.acp_provider_agent_dynamic_tool",
          input: {
            toolCallId: "inner_call",
            toolName: "my_tool",
            args: { x: 1 },
          },
        },
      ],
    } as any);

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "must call my_tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "my_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
      tool_choice: "auto",
    };

    const res = await adapter.handleChatCompletion(req);
    const firstCall = res.choices[0].message.tool_calls?.[0];

    expect(firstCall).toBeDefined();
    if (firstCall?.type === "function") {
      expect(firstCall.id).toBe("inner_call");
      expect(firstCall.function.name).toBe("my_tool");
      expect(firstCall.function.arguments).toBe('{"x":1}');
    } else {
      throw new Error("Expected function tool call");
    }
  });

  it("unwraps ACP wrapped assistant message tool_calls before forwarding", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [
        { role: "user", content: "continue" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "acp.acp_provider_agent_dynamic_tool",
                arguments: '{"toolName":"my_tool","args":{"city":"SF"}}',
              },
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "my_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "my_tool",
                args: { city: "SF" },
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("coerces unexpected tool name to forced tool_choice function name", async () => {
    const { generateText } = await import("ai");

    vi.mocked(generateText).mockResolvedValueOnce({
      text: null,
      finishReason: "tool-calls",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      toolCalls: [
        {
          toolCallId: "call_x",
          toolName: "Start agent loop",
          input: { foo: "bar" },
        },
      ],
    } as any);

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "must call my_tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "my_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "my_tool" },
      },
    };

    const res = await adapter.handleChatCompletion(req);

    const firstCall = res.choices[0].message.tool_calls?.[0];
    expect(firstCall).toBeDefined();
    if (firstCall?.type === "function") {
      expect(firstCall.function.name).toBe("my_tool");
    } else {
      throw new Error("Expected function tool call");
    }
    expect(res.choices[0].finish_reason).toBe("tool_calls");
  });

  it("prefers extra_body.acpConfig over defaultACPConfig", async () => {
    const { createACPProvider } = await import("@mcpc-tech/acp-ai-provider");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "test" }],
      extra_body: {
        acpConfig: {
          command: "custom-command",
          args: ["--x"],
          session: {
            cwd: process.cwd(),
            mcpServers: [],
          },
        },
      },
    };

    await adapter.handleChatCompletion(req);

    expect(createACPProvider).toHaveBeenCalledWith(req.extra_body!.acpConfig);
  });

  it("streams SSE chunks and ends with [DONE]", async () => {
    const req: OpenAIChatCompletionRequest = {
      model: "default",
      stream: true,
      messages: [{ role: "user", content: "stream please" }],
    };

    const chunks: string[] = [];
    for await (const chunk of adapter.handleChatCompletionStream(req)) {
      chunks.push(chunk);
    }

    expect(chunks[chunks.length - 1]).toBe("data: [DONE]\n\n");
    const first = JSON.parse(chunks[0].replace("data: ", ""));
    expect(first.choices[0].delta.role).toBe("assistant");
  });

  it("supports /v1/models in Web Request handler via ACP initSession", async () => {
    const { createACPProvider } = await import("@mcpc-tech/acp-ai-provider");

    const request = new Request("http://localhost/v1/models", {
      method: "GET",
    });

    const response = await adapter.handleRequest(request);
    const data = await response.json();

    expect(createACPProvider).toHaveBeenCalledWith(defaultACPConfig);
    expect(response.status).toBe(200);
    expect(data.object).toBe("list");
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "default", object: "model" }),
        expect.objectContaining({ id: "gpt-test", object: "model" }),
      ]),
    );
  });

  it("throws when defaultACPConfig is missing for /v1/models", async () => {
    const adapterWithoutConfig = new ACP2OpenAI();

    const request = new Request("http://localhost/v1/models", {
      method: "GET",
    });

    await expect(adapterWithoutConfig.handleRequest(request)).rejects.toThrow(
      "defaultACPConfig is required for GET /v1/models",
    );
  });

  it("throws when ACP config is missing", async () => {
    const adapterWithoutConfig = new ACP2OpenAI();

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "hello" }],
    };

    await expect(
      adapterWithoutConfig.handleChatCompletion(req),
    ).rejects.toThrow("ACP session config is required");
  });

  it("passes response_format json_object as output to generateText", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "return JSON" }],
      response_format: { type: "json_object" },
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          name: "json",
        }),
      }),
    );
  });

  it("passes response_format json_schema as output with schema to generateText", async () => {
    const { generateText } = await import("ai");

    const testSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    };

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "return structured data" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "person",
          description: "A person object",
          schema: testSchema,
          strict: true,
        },
      },
    };

    await adapter.handleChatCompletion(req);

    const callArgs = vi.mocked(generateText).mock.calls[0][0];
    expect(callArgs.output).toBeDefined();
    expect(callArgs.output!.name).toBe("object");

    // Verify the responseFormat resolves to the correct shape
    const resolvedFormat = await callArgs.output!.responseFormat;
    expect(resolvedFormat).toEqual({
      type: "json",
      schema: testSchema,
      name: "person",
      description: "A person object",
    });
  });

  it("does not pass output when response_format is text", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "plain text" }],
      response_format: { type: "text" },
    };

    await adapter.handleChatCompletion(req);

    const callArgs = vi.mocked(generateText).mock.calls[0][0];
    expect(callArgs.output).toBeUndefined();
  });

  it("does not pass output when response_format is omitted", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "no format" }],
    };

    await adapter.handleChatCompletion(req);

    const callArgs = vi.mocked(generateText).mock.calls[0][0];
    expect(callArgs.output).toBeUndefined();
  });

  it("passes response_format json_object to streamText as well", async () => {
    const { streamText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      stream: true,
      messages: [{ role: "user", content: "stream JSON" }],
      response_format: { type: "json_object" },
    };

    const chunks: string[] = [];
    for await (const chunk of adapter.handleChatCompletionStream(req)) {
      chunks.push(chunk);
    }

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          name: "json",
        }),
      }),
    );
  });

  it("applies request-phase middleware before building AI SDK params", async () => {
    const { generateText } = await import("ai");

    const req: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "hello" }],
    };

    const adapterWithMiddleware = new ACP2OpenAI({
      defaultModel: "default",
      defaultACPConfig,
      middleware: (ctx) => {
        if (ctx.phase !== "request") return;
        ctx.request.temperature = 0.25;
        ctx.request.extra_body = {
          ...ctx.request.extra_body,
          topK: 9,
        };
        ctx.request.messages = [
          { role: "system", content: "middleware system prompt" },
          ...ctx.request.messages,
        ];
      },
    });

    await adapterWithMiddleware.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.25,
        topK: 9,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: "middleware system prompt",
          }),
        ]),
      }),
    );
    expect(req.temperature).toBeUndefined();
    expect(req.extra_body).toBeUndefined();
  });

  it("applies params-phase middleware to final streamText call params", async () => {
    const { streamText } = await import("ai");

    const adapterWithMiddleware = new ACP2OpenAI({
      defaultModel: "default",
      defaultACPConfig,
      middleware: (ctx) => {
        if (ctx.phase !== "params" || ctx.callType !== "streamText") return;
        ctx.params!.temperature = 0.05;
        ctx.params!.topK = 3;
        ctx.params!.messages = [
          {
            role: "system",
            content: "params middleware prompt",
          },
        ];
      },
    });

    const chunks: string[] = [];
    for await (const chunk of adapterWithMiddleware.handleChatCompletionStream({
      model: "default",
      stream: true,
      messages: [{ role: "user", content: "hello stream" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks[chunks.length - 1]).toBe("data: [DONE]\n\n");
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.05,
        topK: 3,
        messages: [
          {
            role: "system",
            content: "params middleware prompt",
          },
        ],
      }),
    );
  });

  it("applies result-phase middleware to stream text deltas", async () => {
    const adapterWithMiddleware = new ACP2OpenAI({
      defaultModel: "default",
      defaultACPConfig,
      middleware: (ctx) => {
        if (ctx.phase !== "result") return;
        if (ctx.result?.eventType !== "text-delta") return;
        ctx.result.textDelta = ctx.result.textDelta?.toUpperCase();
      },
    });

    const chunks: string[] = [];
    for await (const chunk of adapterWithMiddleware.handleChatCompletionStream({
      model: "default",
      stream: true,
      messages: [{ role: "user", content: "hello stream" }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks
      .filter(
        (chunk) => chunk.startsWith("data: {") && chunk.includes("content"),
      )
      .map(
        (chunk) =>
          JSON.parse(chunk.replace("data: ", "")).choices[0].delta.content ||
          "",
      )
      .join("");

    expect(text).toBe("MOCKED RESPONSE TEXT");
  });

  it("applies result-phase middleware to streamed tool calls and finish reason", async () => {
    const { streamText } = await import("ai");

    vi.mocked(streamText).mockReturnValueOnce({
      textStream: (async function* () {})(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          toolCalls: Promise.resolve([
            {
              toolCallId: "call_1",
              toolName: "demo_tool",
              input: { city: "SF" },
            },
          ]),
          finishReason: Promise.resolve("length"),
        }).then(resolve),
    } as any);

    const adapterWithMiddleware = new ACP2OpenAI({
      defaultModel: "default",
      defaultACPConfig,
      middleware: (ctx) => {
        if (ctx.phase !== "result") return;
        if (ctx.result?.eventType === "tool-calls") {
          ctx.result.toolCalls = [];
        }
        if (ctx.result?.eventType === "finish") {
          ctx.result.finishReason = "stop";
        }
      },
    });

    const chunks: string[] = [];
    for await (const chunk of adapterWithMiddleware.handleChatCompletionStream({
      model: "default",
      stream: true,
      messages: [{ role: "user", content: "tool stream" }],
      tools: [
        {
          type: "function",
          function: {
            name: "demo_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.includes("tool_calls"))).toBe(false);
    const finalChunk = JSON.parse(
      chunks[chunks.length - 2].replace("data: ", ""),
    );
    expect(finalChunk.choices[0].finish_reason).toBe("stop");
  });

  it("emits tool_calls finish_reason for streamed tool calls even if upstream says stop", async () => {
    const { streamText } = await import("ai");

    const streamedToolCalls = Promise.resolve([
      {
        toolCallId: "call_stream_stop_with_tool",
        toolName: "demo_tool",
        input: { city: "SF" },
      },
    ]);
    const streamedFinishReason = Promise.resolve("stop");

    vi.mocked(streamText).mockReturnValueOnce({
      textStream: (async function* () {})(),
      toolCalls: streamedToolCalls,
      finishReason: streamedFinishReason,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          toolCalls: streamedToolCalls,
          finishReason: streamedFinishReason,
        }).then(resolve),
    } as any);

    const chunks: string[] = [];
    for await (const chunk of adapter.handleChatCompletionStream({
      model: "default",
      stream: true,
      messages: [{ role: "user", content: "tool stream" }],
      tools: [
        {
          type: "function",
          function: {
            name: "demo_tool",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(
      chunks.some((chunk) => {
        if (!chunk.startsWith("data: {")) return false;
        const parsed = JSON.parse(chunk.replace("data: ", ""));
        return Boolean(parsed.choices?.[0]?.delta?.tool_calls?.length);
      }),
    ).toBe(true);
    const finalChunk = JSON.parse(
      chunks[chunks.length - 2].replace("data: ", ""),
    );
    expect(finalChunk.choices[0].finish_reason).toBe("tool_calls");
  });

  it("lets plugins override final non-stream results before protocol mapping", async () => {
    const { generateText } = await import("ai");

    vi.mocked(generateText).mockResolvedValueOnce({
      text: null,
      finishReason: "tool-calls",
      usage: {
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
      },
      toolCalls: [
        {
          toolCallId: "wrapper_1",
          toolName: "tool_router",
          input: { city: "SF" },
        },
      ],
    } as any);

    const adapterWithPlugin = new ACP2OpenAI({
      defaultModel: "default",
      defaultACPConfig,
      plugins: [
        {
          onResult: (ctx) => {
            if (ctx.result.toolCalls?.[0]?.toolName !== "tool_router") return;
            ctx.overrideResult = {
              text: null,
              finishReason: "tool-calls",
              usage: ctx.result.usage,
              toolCalls: [
                {
                  toolCallId: "real_1",
                  toolName: "lookup_weather",
                  input: { city: "San Francisco" },
                },
              ],
            };
          },
        },
      ],
    });

    const res = await adapterWithPlugin.handleChatCompletion({
      model: "default",
      messages: [{ role: "user", content: "route this" }],
      tools: [
        {
          type: "function",
          function: {
            name: "tool_router",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    });

    const firstCall = res.choices[0].message.tool_calls?.[0];
    expect(firstCall).toBeDefined();
    if (firstCall?.type === "function") {
      expect(firstCall.function.name).toBe("lookup_weather");
      expect(firstCall.function.arguments).toBe('{"city":"San Francisco"}');
    } else {
      throw new Error("Expected function tool call");
    }
  });

  it("lets plugins override final stream results before OpenAI SSE mapping", async () => {
    const { streamText } = await import("ai");

    const streamedToolCalls = Promise.resolve([
      {
        toolCallId: "wrapper_1",
        toolName: "tool_router",
        input: { city: "SF" },
      },
    ]);
    const streamedFinishReason = Promise.resolve("tool-calls");
    const streamedUsage = Promise.resolve({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });

    vi.mocked(streamText).mockReturnValueOnce({
      textStream: (async function* () {})(),
      toolCalls: streamedToolCalls,
      finishReason: streamedFinishReason,
      usage: streamedUsage,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          toolCalls: streamedToolCalls,
          finishReason: streamedFinishReason,
          usage: streamedUsage,
        }).then(resolve),
    } as any);

    const adapterWithPlugin = new ACP2OpenAI({
      defaultModel: "default",
      defaultACPConfig,
      plugins: [
        {
          onResult: (ctx) => {
            if (ctx.result.toolCalls?.[0]?.toolName !== "tool_router") return;
            ctx.overrideResult = {
              text: null,
              finishReason: "tool-calls",
              usage: ctx.result.usage,
              toolCalls: [
                {
                  toolCallId: "real_stream_1",
                  toolName: "lookup_weather",
                  input: { city: "San Francisco" },
                },
              ],
            };
          },
        },
      ],
    });

    const chunks: string[] = [];
    for await (const chunk of adapterWithPlugin.handleChatCompletionStream({
      model: "default",
      stream: true,
      messages: [{ role: "user", content: "route the stream" }],
      tools: [
        {
          type: "function",
          function: {
            name: "tool_router",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.includes('"name":"tool_router"'))).toBe(
      false,
    );
    expect(
      chunks.some((chunk) => chunk.includes('"name":"lookup_weather"')),
    ).toBe(true);
    expect(chunks[chunks.length - 1]).toBe("data: [DONE]\n\n");
  });

  describe("programmatic tool loop plugins", () => {
    it("runs a programmatic tool loop plugin and feeds tool results back through the model", async () => {
      const { generateText } = await import("ai");

      vi.mocked(generateText)
        .mockResolvedValueOnce({
          text: null,
          finishReason: "tool-calls",
          usage: {
            inputTokens: 8,
            outputTokens: 3,
            totalTokens: 11,
          },
          toolCalls: [
            {
              toolCallId: "wrapper_1",
              toolName: "tool_router",
              input: { city: "SF" },
            },
          ],
        } as any)
        .mockResolvedValueOnce({
          text: null,
          finishReason: "tool-calls",
          usage: {
            inputTokens: 12,
            outputTokens: 4,
            totalTokens: 16,
          },
          toolCalls: [
            {
              toolCallId: "real_1",
              toolName: "lookup_weather",
              input: { city: "San Francisco" },
            },
          ],
        } as any);

      const adapterWithLoopPlugin = new ACP2OpenAI({
        defaultModel: "default",
        defaultACPConfig,
        plugins: [
          createProgrammaticToolLoopPlugin({
            match: (toolCall) => toolCall.toolName === "tool_router",
            execute: async ({ toolCall }) => ({
              output: {
                selectedTool: "lookup_weather",
                city: toolCall.input.city,
              },
            }),
            prepareNextRequest: (request) => ({
              ...request,
              tools: [
                {
                  type: "function",
                  function: {
                    name: "lookup_weather",
                    parameters: {
                      type: "object",
                      properties: {},
                    },
                  },
                },
              ],
            }),
          }),
        ],
      });

      const res = await adapterWithLoopPlugin.handleChatCompletion({
        model: "default",
        messages: [{ role: "user", content: "route and continue" }],
        tools: [
          {
            type: "function",
            function: {
              name: "tool_router",
              parameters: {
                type: "object",
                properties: {},
              },
            },
          },
        ],
      });

      expect(generateText).toHaveBeenCalledTimes(2);

      const secondCall = vi.mocked(generateText).mock.calls[1][0];
      expect(secondCall.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-call",
                toolCallId: "wrapper_1",
                toolName: "tool_router",
                args: { city: "SF" },
              }),
            ]),
          }),
          expect.objectContaining({
            role: "tool",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-result",
                toolCallId: "wrapper_1",
                output: {
                  type: "json",
                  value: {
                    selectedTool: "lookup_weather",
                    city: "SF",
                  },
                },
              }),
            ]),
          }),
        ]),
      );

      const firstCall = res.choices[0].message.tool_calls?.[0];
      expect(firstCall).toBeDefined();
      if (firstCall?.type === "function") {
        expect(firstCall.function.name).toBe("lookup_weather");
        expect(firstCall.function.arguments).toBe('{"city":"San Francisco"}');
      } else {
        throw new Error("Expected function tool call");
      }
    });
  });

  describe("JavaScript code execution plugin", () => {
    function createCodeExecutionAdapter(
      toolNames: string[],
      overrides: Partial<JavaScriptCodeExecutionPluginConfig> = {},
    ) {
      const plugin = createJavaScriptCodeExecutionPlugin({
        ...overrides,
        match: (tc) => tc.toolName === "code_execution",
        toolNames,
      });

      return new ACP2OpenAI({
        defaultModel: "default",
        defaultACPConfig,
        plugins: [plugin],
      });
    }

    function codeExecutionTools() {
      return [
        {
          type: "function" as const,
          function: {
            name: "code_execution",
            parameters: { type: "object", properties: {} },
          },
        },
      ];
    }

    function createExecutionRequest(
      prompt: string,
    ): OpenAIChatCompletionRequest {
      return {
        model: "default",
        messages: [{ role: "user", content: prompt }],
        tools: codeExecutionTools(),
      };
    }

    function createResumeRequest(
      prompt: string,
      bridgedCall: any,
      toolResultContent: string,
    ): OpenAIChatCompletionRequest {
      return {
        model: "default",
        messages: [
          { role: "user", content: prompt },
          {
            role: "assistant",
            content: null,
            tool_calls: [bridgedCall],
          },
          {
            role: "tool",
            tool_call_id: bridgedCall.id,
            content: toolResultContent,
          },
        ],
        tools: codeExecutionTools(),
      };
    }

    function makeStopResult(text: string) {
      return {
        text,
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        toolCalls: [],
      } as any;
    }

    function makeCodeExecutionResult(toolCallId: string, code: string) {
      return {
        text: null,
        finishReason: "tool-calls",
        usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
        toolCalls: [
          {
            toolCallId,
            toolName: "code_execution",
            input: { code },
          },
        ],
      } as any;
    }

    function createDeferred<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("includes declared output schemas in the PTC system prompt", () => {
      const prompt = buildCodeExecutionSystemPrompt([
        {
          type: "function",
          function: {
            name: "get_current_time",
            description: "Get the current date and time.",
            parameters: {
              type: "object",
              properties: {
                timezone: { type: "string" },
              },
            },
            outputSchema: {
              type: "object",
              properties: {
                iso: { type: "string" },
                local: { type: "string" },
                timezone: { type: "string" },
                unix_timestamp: { type: "number" },
              },
              required: ["iso", "local", "timezone", "unix_timestamp"],
            },
          },
        },
      ] as any);

      expect(prompt).toContain("<output_schema>");
      expect(prompt).toContain('"unix_timestamp"');
      expect(prompt).toContain("Do not guess alternate result field names");
    });

    it("suspends on the first sandbox tool call and exposes the bridge tool call", async () => {
      const { generateText } = await import("ai");

      vi.mocked(generateText).mockResolvedValueOnce(
        makeCodeExecutionResult(
          "code_exec_1",
          [
            'const data = await tools.read_file({ path: "/tmp/test.txt" });',
            "return data;",
          ].join("\n"),
        ),
      );

      const adapterWithPlugin = createCodeExecutionAdapter([
        "read_file",
        "write_file",
        "list_dir",
      ]);

      const res = await adapterWithPlugin.handleChatCompletion(
        createExecutionRequest("read a file"),
      );

      expect(res.choices[0].finish_reason).toBe("tool_calls");
      const bridgedCall = res.choices[0].message.tool_calls?.[0] as any;
      expect(bridgedCall).toBeDefined();
      expect(bridgedCall?.type).toBe("function");
      expect(bridgedCall?.function.name).toBe("read_file");
      expect(JSON.parse(bridgedCall.function.arguments)).toEqual({
        path: "/tmp/test.txt",
      });
      expect(generateText).toHaveBeenCalledTimes(1);
    });

    it("resumes sandbox completion and feeds the final result back through the original conversation", async () => {
      const { generateText } = await import("ai");

      vi.mocked(generateText)
        .mockResolvedValueOnce(
          makeCodeExecutionResult(
            "code_exec_2",
            [
              'const data = await tools.read_file({ path: "/tmp/test.txt" });',
              "return { content: data };",
            ].join("\n"),
          ),
        )
        .mockResolvedValueOnce(makeStopResult("dummy"))
        .mockResolvedValueOnce({
          text: "The file contains hello world",
          finishReason: "stop",
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          toolCalls: [],
        } as any);

      const adapterWithPlugin = createCodeExecutionAdapter(["read_file"]);

      const res1 = await adapterWithPlugin.handleChatCompletion(
        createExecutionRequest("read a file"),
      );
      const bridgedCall = res1.choices[0].message.tool_calls![0];

      const res2 = await adapterWithPlugin.handleChatCompletion(
        createResumeRequest("read a file", bridgedCall, '"hello world"'),
      );

      expect(res2.choices[0].message.content).toBe(
        "The file contains hello world",
      );
      expect(res2.choices[0].finish_reason).toBe("stop");
      expect(generateText).toHaveBeenCalledTimes(3);

      const finalModelCall = vi.mocked(generateText).mock.calls[2][0];
      expect(finalModelCall.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "read a file",
          }),
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-call",
                toolCallId: "code_exec_2",
                toolName: "code_execution",
              }),
            ]),
          }),
          expect.objectContaining({
            role: "tool",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-result",
                toolCallId: "code_exec_2",
                output: {
                  type: "json",
                  value: { content: "hello world" },
                },
              }),
            ]),
          }),
        ]),
      );
    });

    it("can suspend more than once and return the next bridge tool call on each resume", async () => {
      const { generateText } = await import("ai");

      vi.mocked(generateText)
        .mockResolvedValueOnce(
          makeCodeExecutionResult(
            "code_exec_multi",
            [
              'const meta = await tools.read_file({ path: "/tmp/meta.json" });',
              "const listing = await tools.list_dir({ path: meta.dir });",
              "return listing;",
            ].join("\n"),
          ),
        )
        .mockResolvedValueOnce(makeStopResult("dummy after first resume"))
        .mockResolvedValueOnce(makeStopResult("dummy after second resume"))
        .mockResolvedValueOnce({
          text: "Listed files",
          finishReason: "stop",
          usage: { inputTokens: 18, outputTokens: 6, totalTokens: 24 },
          toolCalls: [],
        } as any);

      const adapterWithPlugin = createCodeExecutionAdapter([
        "read_file",
        "list_dir",
      ]);

      const firstResponse = await adapterWithPlugin.handleChatCompletion(
        createExecutionRequest("inspect the project"),
      );
      const firstBridgedCall = firstResponse.choices[0].message
        .tool_calls?.[0] as any;
      expect(firstBridgedCall?.function.name).toBe("read_file");
      expect(JSON.parse(firstBridgedCall.function.arguments)).toEqual({
        path: "/tmp/meta.json",
      });

      const secondResponse = await adapterWithPlugin.handleChatCompletion(
        createResumeRequest(
          "inspect the project",
          firstBridgedCall,
          '{"dir":"/tmp/project"}',
        ),
      );
      expect(secondResponse.choices[0].finish_reason).toBe("tool_calls");
      const secondBridgedCall = secondResponse.choices[0].message
        .tool_calls?.[0] as any;
      expect(secondBridgedCall?.function.name).toBe("list_dir");
      expect(JSON.parse(secondBridgedCall.function.arguments)).toEqual({
        path: "/tmp/project",
      });

      const finalResponse = await adapterWithPlugin.handleChatCompletion(
        createResumeRequest(
          "inspect the project",
          secondBridgedCall,
          '["a.txt","b.txt"]',
        ),
      );
      expect(finalResponse.choices[0].message.content).toBe("Listed files");
      expect(finalResponse.choices[0].finish_reason).toBe("stop");
      expect(generateText).toHaveBeenCalledTimes(4);
    });

    it("keeps concurrent resume requests isolated by execution session", async () => {
      const { generateText } = await import("ai");
      const resumeADummy = createDeferred<any>();

      vi.mocked(generateText)
        .mockResolvedValueOnce(
          makeCodeExecutionResult(
            "code_exec_a",
            [
              'const data = await tools.read_file({ path: "/tmp/a.txt" });',
              "return { content: data };",
            ].join("\n"),
          ),
        )
        .mockResolvedValueOnce(
          makeCodeExecutionResult(
            "code_exec_b",
            [
              'const data = await tools.read_file({ path: "/tmp/b.txt" });',
              "return { content: data };",
            ].join("\n"),
          ),
        )
        .mockImplementationOnce(() => resumeADummy.promise)
        .mockResolvedValueOnce(makeStopResult("dummy B"))
        .mockResolvedValueOnce({
          text: "final B",
          finishReason: "stop",
          usage: { inputTokens: 11, outputTokens: 5, totalTokens: 16 },
          toolCalls: [],
        } as any)
        .mockResolvedValueOnce({
          text: "final A",
          finishReason: "stop",
          usage: { inputTokens: 11, outputTokens: 5, totalTokens: 16 },
          toolCalls: [],
        } as any);

      const adapterWithPlugin = createCodeExecutionAdapter(["read_file"]);

      const firstStart = await adapterWithPlugin.handleChatCompletion(
        createExecutionRequest("read file A"),
      );
      const secondStart = await adapterWithPlugin.handleChatCompletion(
        createExecutionRequest("read file B"),
      );
      const firstBridgedCall = firstStart.choices[0].message
        .tool_calls?.[0] as any;
      const secondBridgedCall = secondStart.choices[0].message
        .tool_calls?.[0] as any;

      const firstResumePromise = adapterWithPlugin.handleChatCompletion(
        createResumeRequest("read file A", firstBridgedCall, '"alpha"'),
      );

      for (let attempt = 0; attempt < 20; attempt++) {
        if (vi.mocked(generateText).mock.calls.length >= 3) break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(generateText).toHaveBeenCalledTimes(3);

      const secondResume = await adapterWithPlugin.handleChatCompletion(
        createResumeRequest("read file B", secondBridgedCall, '"beta"'),
      );
      expect(secondResume.choices[0].message.content).toBe("final B");

      resumeADummy.resolve(makeStopResult("dummy A"));
      const firstResume = await firstResumePromise;
      expect(firstResume.choices[0].message.content).toBe("final A");
      expect(generateText).toHaveBeenCalledTimes(6);
    });

    it("supports injected sandbox helper functions with the Deno runtime", async () => {
      const { generateText } = await import("ai");

      vi.mocked(generateText)
        .mockResolvedValueOnce(
          makeCodeExecutionResult(
            "code_exec_helper",
            [
              'const day = formatDate(new Date("2025-01-02T03:04:05.000Z"));',
              "return { day };",
            ].join("\n"),
          ),
        )
        .mockResolvedValueOnce({
          text: "Formatted date ready",
          finishReason: "stop",
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
          toolCalls: [],
        } as any);

      const adapterWithPlugin = createCodeExecutionAdapter([], {
        sandbox: () => ({
          formatDate: (date: Date) => date.toISOString().split("T")[0],
        }),
      });

      const response = await adapterWithPlugin.handleChatCompletion(
        createExecutionRequest("format the date"),
      );

      expect(response.choices[0].message.content).toBe("Formatted date ready");
      expect(generateText).toHaveBeenCalledTimes(2);

      const finalModelCall = vi.mocked(generateText).mock.calls[1][0];
      expect(finalModelCall.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-result",
                toolCallId: "code_exec_helper",
                output: {
                  type: "json",
                  value: { day: "2025-01-02" },
                },
              }),
            ]),
          }),
        ]),
      );
    });
  });

  it("runs middleware for responses requests and preserves endpoint context", async () => {
    const { generateText } = await import("ai");
    const seen: Array<{ phase: string; endpoint: string; callType: string }> =
      [];

    const adapterWithMiddleware = new ACP2OpenAI({
      defaultModel: "default",
      runtimeFactory: ({ request }) => ({
        model: "mocked-model",
        modelName: request.model ?? "default",
      }),
      middleware: (ctx) => {
        seen.push({
          phase: ctx.phase,
          endpoint: ctx.endpoint,
          callType: ctx.callType,
        });

        if (ctx.phase !== "request" || ctx.endpoint !== "responses") return;
        ctx.request.model = "gpt-test";
        ctx.request.temperature = 0.33;
      },
    });

    const req: OpenAIResponsesRequest = {
      model: "default",
      input: "hello responses",
    };

    const res = await adapterWithMiddleware.handleResponses(req);

    expect(res.model).toBe("gpt-test");
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.33,
      }),
    );
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "request",
          endpoint: "responses",
          callType: "generateText",
        }),
        expect.objectContaining({
          phase: "params",
          endpoint: "responses",
          callType: "generateText",
        }),
      ]),
    );
  });

  it("converts responses function_call and function_call_output items into chat tool loop messages", async () => {
    const { generateText } = await import("ai");
    const responsesAdapter = new ACP2OpenAI({
      defaultModel: "default",
      runtimeFactory: ({ request }) => ({
        model: "mocked-model",
        modelName: request.model ?? "default",
      }),
    });

    const req: OpenAIResponsesRequest = {
      model: "default",
      input: [
        {
          type: "function_call",
          call_id: "call_weather_1",
          name: "lookup_weather",
          arguments: '{"city":"Paris"}',
        },
        {
          type: "function_call_output",
          call_id: "call_weather_1",
          output: '{"temperature":18}',
        },
      ],
    };

    await responsesAdapter.handleResponses(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-call",
                toolCallId: "call_weather_1",
                toolName: "lookup_weather",
                args: { city: "Paris" },
              }),
            ]),
          }),
          expect.objectContaining({
            role: "tool",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-result",
                toolCallId: "call_weather_1",
                toolName: "tool",
                output: {
                  type: "json",
                  value: { temperature: 18 },
                },
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("maps responses text.format and returns SDK-friendly response fields", async () => {
    const { generateText } = await import("ai");
    const responsesAdapter = new ACP2OpenAI({
      defaultModel: "default",
      runtimeFactory: ({ request }) => ({
        model: "mocked-model",
        modelName: request.model ?? "default",
      }),
    });

    const req: OpenAIResponsesRequest = {
      model: "default",
      input: "Return JSON please",
      text: {
        format: {
          type: "json_schema",
          name: "weather_summary",
          schema: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
          },
        },
      },
    };

    const res = await responsesAdapter.handleResponses(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.any(Object),
      }),
    );
    expect(res.object).toBe("response");
    expect(res.output_text).toBe("Mocked response text");
    expect(res.error).toBeNull();
    expect(res.incomplete_details).toBeNull();
    expect(res.usage.input_tokens_details.cached_tokens).toBe(0);
    expect(res.usage.output_tokens_details.reasoning_tokens).toBe(0);
  });

  it("streams responses events in OpenAI SDK compatible order", async () => {
    const responsesAdapter = new ACP2OpenAI({
      defaultModel: "default",
      runtimeFactory: ({ request }) => ({
        model: "mocked-model",
        modelName: request.model ?? "default",
      }),
    });

    const req: OpenAIResponsesRequest = {
      model: "default",
      input: "stream hello",
      stream: true,
    };

    const chunks: string[] = [];
    for await (const chunk of responsesAdapter.handleResponsesStream(req)) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toContain("event: response.created");
    expect(
      chunks.some((chunk) =>
        chunk.includes("event: response.output_item.added"),
      ),
    ).toBe(true);
    expect(
      chunks.some((chunk) =>
        chunk.includes("event: response.content_part.added"),
      ),
    ).toBe(true);
    expect(
      chunks.some((chunk) =>
        chunk.includes("event: response.output_text.delta"),
      ),
    ).toBe(true);
    expect(
      chunks.some((chunk) =>
        chunk.includes("event: response.output_text.done"),
      ),
    ).toBe(true);
    expect(
      chunks.some((chunk) =>
        chunk.includes("event: response.output_item.done"),
      ),
    ).toBe(true);
    expect(
      chunks.some((chunk) => chunk.includes("event: response.completed")),
    ).toBe(true);
    expect(chunks[chunks.length - 1]).toBe("data: [DONE]\n\n");
  });

  it("maps tool-call responses into response.output function_call items", async () => {
    const { generateText } = await import("ai");
    const responsesAdapter = new ACP2OpenAI({
      defaultModel: "default",
      runtimeFactory: ({ request }) => ({
        model: "mocked-model",
        modelName: request.model ?? "default",
      }),
    });

    vi.mocked(generateText).mockResolvedValueOnce({
      text: null,
      finishReason: "tool-calls",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      toolCalls: [
        {
          toolCallId: "call_lookup_1",
          toolName: "lookup_weather",
          input: { city: "Paris" },
        },
      ],
    } as any);

    const res = await responsesAdapter.handleResponses({
      model: "default",
      input: "Use the weather tool.",
      tools: [
        {
          type: "function",
          name: "lookup_weather",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
          },
        },
      ],
    });

    expect(res.output_text).toBe("");
    expect(res.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call",
          id: "call_lookup_1",
          call_id: "call_lookup_1",
          name: "lookup_weather",
          arguments: JSON.stringify({ city: "Paris" }),
        }),
      ]),
    );
  });

  it("supports custom runtimeFactory for arbitrary AI SDK providers", async () => {
    const { generateText } = await import("ai");
    const { createACPProvider } = await import("@mcpc-tech/acp-ai-provider");

    const adapterWithRuntimeFactory = new ACP2OpenAI({
      defaultModel: "custom-default",
      runtimeFactory: ({ request }) => ({
        model: "custom-runtime-model",
        modelName: `${request.model ?? "default"}-via-runtime`,
        toolChoice: "none",
      }),
      listModels: ["custom-default", "custom-secondary"],
    });

    const response = await adapterWithRuntimeFactory.handleChatCompletion({
      model: "custom-default",
      messages: [{ role: "user", content: "hello custom runtime" }],
    });

    expect(createACPProvider).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "custom-runtime-model",
        toolChoice: "none",
      }),
    );
    expect(response.model).toBe("custom-default-via-runtime");

    const modelsResponse = await adapterWithRuntimeFactory.handleRequest(
      new Request("http://localhost/v1/models", { method: "GET" }),
    );
    const models = await modelsResponse.json();
    expect(models.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "custom-default" }),
        expect.objectContaining({ id: "custom-secondary" }),
      ]),
    );
  });

  it("converts Anthropic messages requests into AI SDK params", async () => {
    const { generateText } = await import("ai");

    const req: AnthropicMessagesRequest = {
      model: "default",
      system: [{ type: "text", text: "system prompt" }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello from Anthropic" }],
        },
      ],
      max_tokens: 256,
      top_k: 11,
      stop_sequences: ["DONE"],
      tool_choice: { type: "any" },
      tools: [
        {
          name: "lookup_weather",
          input_schema: { type: "object", properties: {} },
        },
      ],
      extra_body: { seed: 3, acpConfig: defaultACPConfig },
    };

    const res = await adapter.handleAnthropicMessages(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 256,
        topK: 11,
        stopSequences: ["DONE"],
        toolChoice: { type: "tool", toolName: "lookup_weather" },
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("system prompt"),
          }),
          expect.objectContaining({
            role: "user",
            content: "Hello from Anthropic",
          }),
        ]),
      }),
    );
    expect(res.type).toBe("message");
    expect(res.role).toBe("assistant");
    expect(res.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: "Mocked response text",
        }),
      ]),
    );
  });

  it("maps tool calls back into Anthropic tool_use blocks", async () => {
    const { generateText } = await import("ai");

    vi.mocked(generateText).mockResolvedValueOnce({
      text: null,
      finishReason: "tool-calls",
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      },
      toolCalls: [
        {
          toolCallId: "call_lookup",
          toolName: "lookup_weather",
          input: { city: "San Francisco" },
        },
      ],
    } as any);

    const res = await adapter.handleAnthropicMessages({
      model: "default",
      max_tokens: 128,
      messages: [{ role: "user", content: "Use the weather tool." }],
      tools: [
        {
          name: "lookup_weather",
          input_schema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    });

    expect(res.stop_reason).toBe("tool_use");
    expect(res.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_use",
          name: "lookup_weather",
          input: { city: "San Francisco" },
        }),
      ]),
    );
  });

  it("streams Anthropic SSE events for messages", async () => {
    const req: AnthropicMessagesRequest = {
      model: "default",
      stream: true,
      max_tokens: 64,
      messages: [{ role: "user", content: "stream please" }],
    };

    const chunks: string[] = [];
    for await (const chunk of adapter.handleAnthropicMessagesStream(req)) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toContain("event: message_start");
    expect(
      chunks.some((chunk) => chunk.includes("event: content_block_start")),
    ).toBe(true);
    expect(chunks.some((chunk) => chunk.includes('"type":"text_delta"'))).toBe(
      true,
    );
    expect(chunks.some((chunk) => chunk.includes("event: message_delta"))).toBe(
      true,
    );
    expect(chunks[chunks.length - 1]).toContain("event: message_stop");
  });
});
