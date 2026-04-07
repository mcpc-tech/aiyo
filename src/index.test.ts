import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACP2OpenAI, type OpenAIChatCompletionRequest } from "./index.js";

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

vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({
    text: "Mocked response text",
    finishReason: "stop",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    toolCalls: [],
  })),
  streamText: vi.fn(() => ({
    textStream: (async function* () {
      yield "Hello ";
      yield "World";
    })(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        toolCalls: Promise.resolve([]),
        finishReason: Promise.resolve("stop"),
      }).then(resolve),
  })),
  tool: vi.fn((def) => def),
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
}));

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
    adapter = new ACP2OpenAI({
      defaultModel: "default",
      defaultACPConfig,
    });
    vi.clearAllMocks();
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
                output: '{"temp":72}',
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
});
