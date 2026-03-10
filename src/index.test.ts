import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACP2OpenAI, type OpenAIChatCompletionRequest } from './index.js';

vi.mock('@mcpc-tech/acp-ai-provider', () => ({
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME: 'acp.acp_provider_agent_dynamic_tool',
  acpTools: vi.fn((tools) => tools),
  createACPProvider: vi.fn(() => ({
    languageModel: vi.fn(() => 'mocked-model'),
  })),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({
    text: 'Mocked response text',
    finishReason: 'stop',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
    toolCalls: [],
  })),
  streamText: vi.fn(() => ({
    textStream: (async function* () {
      yield 'Hello ';
      yield 'World';
    })(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        toolCalls: Promise.resolve([]),
        finishReason: Promise.resolve('stop'),
      }).then(resolve),
  })),
  tool: vi.fn((def) => def),
}));

describe('ACP2OpenAI (high-value unit tests)', () => {
  const defaultACPConfig = {
    command: 'claude-agent-acp',
    args: [],
    session: {
      cwd: process.cwd(),
      mcpServers: [],
    },
  };

  let adapter: ACP2OpenAI;

  beforeEach(() => {
    adapter = new ACP2OpenAI({
      defaultModel: 'default',
      defaultACPConfig,
    });
    vi.clearAllMocks();
  });

  it('maps core request params to AI SDK and returns OpenAI-compatible response', async () => {
    const { generateText } = await import('ai');

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [{ role: 'user', content: 'Hello' }],
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

    expect(res.object).toBe('chat.completion');
    expect(res.choices[0].message.role).toBe('assistant');
    expect(res.choices[0].message.refusal).toBeNull();
    expect(res.choices[0].logprobs).toBeNull();
  });

  it('converts function tool call + tool result message correctly', async () => {
    const { generateText } = await import('ai');

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [
        { role: 'user', content: 'What is weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"SF"}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"temp":72}',
        },
      ],
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'tool-call',
                toolCallId: 'call_1',
                toolName: 'get_weather',
              }),
            ]),
          }),
          expect.objectContaining({
            role: 'tool',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'tool-result',
                toolCallId: 'call_1',
                toolName: 'tool',
                output: '{"temp":72}',
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it('maps tool_choice=function to AI SDK toolChoice format', async () => {
    const { generateText } = await import('ai');

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [{ role: 'user', content: 'use tool' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'my_tool',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: 'my_tool' },
      },
    };

    await adapter.handleChatCompletion(req);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        toolChoice: { type: 'tool', toolName: 'my_tool' },
      }),
    );
  });

  it('wraps request tools with acpTools', async () => {
    const { generateText } = await import('ai');
    const { acpTools } = await import('@mcpc-tech/acp-ai-provider');

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [{ role: 'user', content: 'use wrapped tool' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'my_tool',
            parameters: {
              type: 'object',
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

  it('unwraps ACP dynamic wrapper tool call to real tool name and args', async () => {
    const { generateText } = await import('ai');

    vi.mocked(generateText).mockResolvedValueOnce({
      text: null,
      finishReason: 'tool-calls',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      toolCalls: [
        {
          toolCallId: 'outer_call',
          toolName: 'acp.acp_provider_agent_dynamic_tool',
          input: {
            toolCallId: 'inner_call',
            toolName: 'my_tool',
            args: { x: 1 },
          },
        },
      ],
    } as any);

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [{ role: 'user', content: 'must call my_tool' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'my_tool',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
      ],
      tool_choice: 'auto',
    };

    const res = await adapter.handleChatCompletion(req);
    const firstCall = res.choices[0].message.tool_calls?.[0];

    expect(firstCall).toBeDefined();
    if (firstCall?.type === 'function') {
      expect(firstCall.id).toBe('inner_call');
      expect(firstCall.function.name).toBe('my_tool');
      expect(firstCall.function.arguments).toBe('{"x":1}');
    } else {
      throw new Error('Expected function tool call');
    }
  });

  it('unwraps ACP wrapped assistant message tool_calls before forwarding', async () => {
    const { generateText } = await import('ai');

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [
        { role: 'user', content: 'continue' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'acp.acp_provider_agent_dynamic_tool',
                arguments: '{"toolName":"my_tool","args":{"city":"SF"}}',
              },
            },
          ],
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'my_tool',
            parameters: {
              type: 'object',
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
            role: 'assistant',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'tool-call',
                toolCallId: 'call_1',
                toolName: 'my_tool',
                args: { city: 'SF' },
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it('coerces unexpected tool name to forced tool_choice function name', async () => {
    const { generateText } = await import('ai');

    vi.mocked(generateText).mockResolvedValueOnce({
      text: null,
      finishReason: 'tool-calls',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      toolCalls: [
        {
          toolCallId: 'call_x',
          toolName: 'Start agent loop',
          input: { foo: 'bar' },
        },
      ],
    } as any);

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [{ role: 'user', content: 'must call my_tool' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'my_tool',
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: 'my_tool' },
      },
    };

    const res = await adapter.handleChatCompletion(req);

    const firstCall = res.choices[0].message.tool_calls?.[0];
    expect(firstCall).toBeDefined();
    if (firstCall?.type === 'function') {
      expect(firstCall.function.name).toBe('my_tool');
    } else {
      throw new Error('Expected function tool call');
    }
    expect(res.choices[0].finish_reason).toBe('tool_calls');
  });

  it('prefers extra_body.acpConfig over defaultACPConfig', async () => {
    const { createACPProvider } = await import('@mcpc-tech/acp-ai-provider');

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [{ role: 'user', content: 'test' }],
      extra_body: {
        acpConfig: {
          command: 'custom-command',
          args: ['--x'],
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

  it('streams SSE chunks and ends with [DONE]', async () => {
    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      stream: true,
      messages: [{ role: 'user', content: 'stream please' }],
    };

    const chunks: string[] = [];
    for await (const chunk of adapter.handleChatCompletionStream(req)) {
      chunks.push(chunk);
    }

    expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');
    const first = JSON.parse(chunks[0].replace('data: ', ''));
    expect(first.choices[0].delta.role).toBe('assistant');
  });

  it('throws when ACP config is missing', async () => {
    const adapterWithoutConfig = new ACP2OpenAI();

    const req: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [{ role: 'user', content: 'hello' }],
    };

    await expect(adapterWithoutConfig.handleChatCompletion(req)).rejects.toThrow(
      'ACP session config is required',
    );
  });
});
