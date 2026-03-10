import {
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
  acpTools,
  createACPProvider,
  type ACPProviderSettings,
} from '@mcpc-tech/acp-ai-provider';
import { generateText, streamText, type ModelMessage, tool } from 'ai';
import { z } from 'zod/v4';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources/chat/completions';

// ─────────────────────────────────────────────────────────────────────────────
// Type aliases - use OpenAI SDK types directly
// ─────────────────────────────────────────────────────────────────────────────

export type OpenAIMessage = ChatCompletionMessageParam;
export type OpenAITool = ChatCompletionTool;
export type OpenAIToolCall = ChatCompletionMessageFunctionToolCall;

// Extend OpenAI types with ACP-specific fields via extra_body
export interface OpenAIChatCompletionRequest extends Omit<ChatCompletionCreateParams, 'extra_body'> {
  extra_body?: {
    // ACP provider config (command, session, etc.)
    acpConfig?: ACPProviderSettings;
    // AI SDK settings
    topK?: number;
    seed?: number;
  };
}

export type OpenAIChatCompletionResponse = ChatCompletion;
export type OpenAIStreamChunk = ChatCompletionChunk;

// ─────────────────────────────────────────────────────────────────────────────
// ACP2OpenAI adapter configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface ACP2OpenAIConfig {
  defaultACPConfig?: ACPProviderSettings;
  defaultModel?: string;
}

const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

type OpenAIFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';

type RuntimeContext = {
  model: any;
  modelName: string;
  tools: Record<string, any> | undefined;
  toolChoice: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string } | undefined;
  allowedToolNames: Set<string>;
  forcedToolName?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Core adapter class
// ─────────────────────────────────────────────────────────────────────────────

export class ACP2OpenAI {
  private config: ACP2OpenAIConfig;

  constructor(config: ACP2OpenAIConfig = {}) {
    this.config = config;
  }

  private ensureACPConfig(req: OpenAIChatCompletionRequest): ACPProviderSettings {
    const acpConfig = req.extra_body?.acpConfig || this.config.defaultACPConfig;
    if (!acpConfig) {
      throw new Error('ACP session config is required (via extra_body.acpConfig or defaultACPConfig)');
    }
    return acpConfig;
  }

  private resolveModelName(req: OpenAIChatCompletionRequest): string {
    return req.model || this.config.defaultModel || 'default';
  }

  private buildRuntime(req: OpenAIChatCompletionRequest): RuntimeContext {
    const modelName = this.resolveModelName(req);
    const provider = createACPProvider(this.ensureACPConfig(req));

    const providerTools = provider.tools as Record<string, any> | undefined;
    const requestTools = this.convertTools(req.tools);

    return {
      model: provider.languageModel(modelName),
      modelName,
      tools: this.mergeTools(providerTools, requestTools),
      toolChoice: this.convertToolChoice(req.tool_choice),
      allowedToolNames: this.getAllowedToolNames(req.tools),
      forcedToolName: this.getForcedToolName(req.tool_choice),
    };
  }

  private buildGenerationOptions(req: OpenAIChatCompletionRequest) {
    return {
      temperature: req.temperature ?? undefined,
      maxOutputTokens: req.max_completion_tokens ?? req.max_tokens ?? undefined,
      topP: req.top_p ?? undefined,
      frequencyPenalty: req.frequency_penalty ?? undefined,
      presencePenalty: req.presence_penalty ?? undefined,
      topK: req.extra_body?.topK,
      seed: req.extra_body?.seed,
    };
  }

  private mergeTools(
    providerTools?: Record<string, any>,
    requestTools?: Record<string, any>,
  ): Record<string, any> | undefined {
    if (!providerTools && !requestTools) return undefined;
    return {
      ...(providerTools ?? {}),
      ...(requestTools ?? {}),
    };
  }

  private isChatCompletionsRequest(path: string, method: string): boolean {
    return path === CHAT_COMPLETIONS_PATH && method === 'POST';
  }

  private createSSEReadableStream(stream: AsyncIterable<string>): ReadableStream<Uint8Array> {
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private parseArgsObject(value: unknown): Record<string, unknown> {
    if (this.isRecord(value)) return value;
    if (typeof value !== 'string') return {};

    try {
      const parsed = JSON.parse(value);
      return this.isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private isACPWrappedToolName(name: string): boolean {
    return name === ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME;
  }

  private unwrapACPToolCall(
    wrapperName: string,
    payload: Record<string, unknown>,
    fallbackToolCallId: string,
  ): { toolCallId: string; toolName: string; input: Record<string, unknown> } | undefined {
    if (!this.isACPWrappedToolName(wrapperName)) return undefined;

    const nestedToolName =
      (typeof payload.toolName === 'string' && payload.toolName) ||
      (typeof payload.name === 'string' && payload.name) ||
      '';

    if (!nestedToolName) return undefined;

    const nestedArgs = this.isRecord(payload.args)
      ? payload.args
      : this.isRecord(payload.arguments)
      ? payload.arguments
      : {};

    const nestedToolCallId =
      typeof payload.toolCallId === 'string' && payload.toolCallId
        ? payload.toolCallId
        : fallbackToolCallId;

    return {
      toolCallId: nestedToolCallId,
      toolName: nestedToolName,
      input: nestedArgs,
    };
  }

  private normalizeToolCall(tc: any): any | undefined {
    const fallbackToolCallId =
      typeof tc?.toolCallId === 'string' && tc.toolCallId
        ? tc.toolCallId
        : `call_${Math.random().toString(36).slice(2, 10)}`;

    const rawToolName = typeof tc?.toolName === 'string' ? tc.toolName : '';
    const rawInput = this.isRecord(tc?.input)
      ? tc.input
      : this.isRecord(tc?.args)
      ? tc.args
      : {};

    const unwrapped = this.unwrapACPToolCall(rawToolName, rawInput, fallbackToolCallId);
    if (unwrapped) {
      return {
        ...tc,
        ...unwrapped,
      };
    }

    if (!rawToolName) return undefined;

    return {
      ...tc,
      toolCallId: fallbackToolCallId,
      toolName: rawToolName,
      input: rawInput,
    };
  }

  private stringifyContent(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part: any) => ('text' in part ? part.text : JSON.stringify(part)))
        .join('\n');
    }
    return '';
  }

  private normalizeRole(role: ChatCompletionMessageParam['role']): 'system' | 'user' | 'assistant' {
    if (role === 'system' || role === 'developer') return 'system';
    if (role === 'user') return 'user';
    return 'assistant';
  }

  private convertToolResultMessage(msg: any): ModelMessage {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: msg.tool_call_id,
          toolName: 'tool',
          output: content,
        },
      ],
    };
  }

  private convertAssistantToolCallMessage(msg: any): ModelMessage {
    const textContent = typeof msg.content === 'string' ? msg.content : '';

    return {
      role: 'assistant',
      content: [
        ...(textContent ? [{ type: 'text' as const, text: textContent }] : []),
        ...msg.tool_calls
          .filter((tc: any) => tc.type === 'function')
          .map((tc: any) => {
            const parsedArgs = this.parseArgsObject(tc.function.arguments);
            const fallbackToolCallId =
              typeof tc.id === 'string' && tc.id
                ? tc.id
                : `call_${Math.random().toString(36).slice(2, 10)}`;
            const unwrapped = this.unwrapACPToolCall(
              tc.function.name,
              parsedArgs,
              fallbackToolCallId,
            );

            return {
              type: 'tool-call' as const,
              toolCallId: unwrapped?.toolCallId ?? fallbackToolCallId,
              toolName: unwrapped?.toolName ?? tc.function.name,
              args: unwrapped?.input ?? parsedArgs,
            };
          }),
      ],
    };
  }

  /**
   * Convert OpenAI messages to AI SDK ModelMessage format
   */
  private convertMessages(messages: ChatCompletionMessageParam[]): ModelMessage[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return this.convertToolResultMessage(msg);
      }

      if (msg.role === 'assistant' && msg.tool_calls) {
        return this.convertAssistantToolCallMessage(msg);
      }

      return {
        role: this.normalizeRole(msg.role),
        content: this.stringifyContent(msg.content),
      };
    }) as ModelMessage[];
  }

  /**
   * Convert OpenAI tools to AI SDK tools format
   */
  private convertTools(openaiTools?: OpenAITool[]): Record<string, any> | undefined {
    if (!openaiTools || openaiTools.length === 0) return undefined;

    const tools: Record<string, any> = {};

    for (const openaiTool of openaiTools) {
      if (openaiTool.type !== 'function') continue;

      const fn = openaiTool.function;
      const zodSchema = z.object({}).passthrough();

      tools[fn.name] = tool({
        description: fn.description || `Function: ${fn.name}`,
        inputSchema: zodSchema,
      });
    }

    if (Object.keys(tools).length === 0) return undefined;

    return acpTools(tools as Record<string, any>);
  }

  /**
   * Convert OpenAI tool_choice to AI SDK toolChoice format
   */
  private convertToolChoice(
    toolChoice?: ChatCompletionToolChoiceOption
  ): 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string } | undefined {
    if (!toolChoice) return undefined;

    if (toolChoice === 'none' || toolChoice === 'auto' || toolChoice === 'required') {
      return toolChoice;
    }

    if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      return {
        type: 'tool',
        toolName: toolChoice.function.name,
      };
    }

    return undefined;
  }

  private getAllowedToolNames(openaiTools?: OpenAITool[]): Set<string> {
    if (!openaiTools || openaiTools.length === 0) return new Set();

    return new Set(
      openaiTools
        .filter((t) => t.type === 'function')
        .map((t) => t.function.name),
    );
  }

  private getForcedToolName(toolChoice?: ChatCompletionToolChoiceOption): string | undefined {
    if (!toolChoice || typeof toolChoice !== 'object') return undefined;
    if (toolChoice.type !== 'function') return undefined;
    return toolChoice.function.name;
  }

  private sanitizeToolCalls(
    toolCalls: any[] | undefined,
    runtime: RuntimeContext,
  ): any[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    const normalized = toolCalls
      .map((tc) => this.normalizeToolCall(tc))
      .filter((tc): tc is any => Boolean(tc));

    const filtered = normalized.filter((tc) => {
      const name = String(tc?.toolName ?? '');
      if (!name) return false;
      if (runtime.allowedToolNames.size > 0 && !runtime.allowedToolNames.has(name)) return false;
      if (runtime.forcedToolName && name !== runtime.forcedToolName) return false;
      return true;
    });

    return filtered.length > 0 ? filtered : undefined;
  }

  private coerceForcedToolCall(
    rawToolCalls: any[] | undefined,
    runtime: RuntimeContext,
  ): any[] | undefined {
    if (!runtime.forcedToolName) return undefined;
    if (!rawToolCalls || rawToolCalls.length === 0) return undefined;

    const first = this.normalizeToolCall(rawToolCalls[0]);
    if (!first) return undefined;

    return [{
      ...first,
      toolName: runtime.forcedToolName,
    }];
  }

  private pickToolCalls(
    rawToolCalls: any[] | undefined,
    runtime: RuntimeContext,
  ): any[] | undefined {
    return this.sanitizeToolCalls(rawToolCalls, runtime) ?? this.coerceForcedToolCall(rawToolCalls, runtime);
  }

  private resolveNonStreamFinishReason(
    finishReason: string | undefined,
    toolCalls: OpenAIToolCall[] | undefined,
  ): OpenAIFinishReason {
    const mapped = this.mapFinishReason(finishReason);
    if (mapped === 'tool_calls' && (!toolCalls || toolCalls.length === 0)) {
      return 'stop';
    }
    return mapped;
  }

  private resolveStreamFinishReason(
    finishReason: string | undefined,
    toolCalls: any[] | undefined,
  ): OpenAIFinishReason | null {
    const mapped = this.mapStreamFinishReason(finishReason);
    if (mapped === 'tool_calls' && (!toolCalls || toolCalls.length === 0)) {
      return 'stop';
    }
    return mapped;
  }

  private mapFinishReason(finishReason: string | undefined): OpenAIFinishReason {
    if (finishReason === 'tool-calls') return 'tool_calls';
    if (finishReason === 'stop') return 'stop';
    if (finishReason === 'length') return 'length';
    return 'stop';
  }

  private mapStreamFinishReason(finishReason: string | undefined): OpenAIFinishReason | null {
    if (finishReason === 'tool-calls') return 'tool_calls';
    if (finishReason === 'stop') return 'stop';
    if (finishReason === 'length') return 'length';
    return null;
  }

  private toOpenAIToolCalls(toolCalls: any[] | undefined): OpenAIToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    const normalized = toolCalls
      .map((tc) => this.normalizeToolCall(tc))
      .filter((tc): tc is any => Boolean(tc));

    if (normalized.length === 0) return undefined;

    return normalized.map((tc) => ({
      id: tc.toolCallId,
      type: 'function' as const,
      function: {
        name: tc.toolName,
        arguments: JSON.stringify(tc.input),
      },
    }));
  }

  /**
   * Handle non-streaming chat completion
   */
  async handleChatCompletion(
    req: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    const runtime = this.buildRuntime(req);

    const result = await generateText({
      model: runtime.model,
      messages: this.convertMessages(req.messages),
      ...this.buildGenerationOptions(req),
      tools: runtime.tools,
      toolChoice: runtime.toolChoice,
    });

    const id = `chatcmpl-${Math.random().toString(36).slice(2, 15)}`;
    const created = Math.floor(Date.now() / 1000);
    const rawToolCalls = result.toolCalls;
    const selectedToolCalls = this.pickToolCalls(rawToolCalls, runtime);
    const openAIToolCalls = this.toOpenAIToolCalls(selectedToolCalls);

    return {
      id,
      object: 'chat.completion',
      created,
      model: runtime.modelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.text || null,
            refusal: null,
            tool_calls: openAIToolCalls,
          },
          finish_reason: this.resolveNonStreamFinishReason(result.finishReason, openAIToolCalls),
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: result.usage?.inputTokens ?? 0,
        completion_tokens: result.usage?.outputTokens ?? 0,
        total_tokens: result.usage?.totalTokens ?? 0,
      },
      service_tier: null,
    };
  }

  /**
   * Handle streaming chat completion
   * Returns an async iterable of SSE-formatted strings
   */
  async *handleChatCompletionStream(
    req: OpenAIChatCompletionRequest
  ): AsyncIterable<string> {
    const runtime = this.buildRuntime(req);

    const result = streamText({
      model: runtime.model,
      messages: this.convertMessages(req.messages),
      ...this.buildGenerationOptions(req),
      tools: runtime.tools,
      toolChoice: runtime.toolChoice,
    });

    const id = `chatcmpl-${Math.random().toString(36).slice(2, 15)}`;
    const created = Math.floor(Date.now() / 1000);

    let isFirst = true;

    for await (const chunk of result.textStream) {
      const streamChunk: OpenAIStreamChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model: runtime.modelName,
        choices: [
          {
            index: 0,
            delta: isFirst
              ? { role: 'assistant', content: chunk }
              : { content: chunk },
            finish_reason: null,
          },
        ],
      };
      isFirst = false;
      yield `data: ${JSON.stringify(streamChunk)}\n\n`;
    }

    const awaited = await result;
    const rawToolCalls = await awaited.toolCalls;
    const selectedToolCalls = this.pickToolCalls(rawToolCalls, runtime);
    const finishReasonValue = await awaited.finishReason;

    if (selectedToolCalls && selectedToolCalls.length > 0) {
      for (let i = 0; i < selectedToolCalls.length; i++) {
        const tc = selectedToolCalls[i];
        const toolCallChunk: OpenAIStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created,
          model: runtime.modelName,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: i,
                    id: tc.toolCallId,
                    type: 'function',
                    function: {
                      name: tc.toolName,
                      arguments: JSON.stringify(tc.input ?? {}),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
        yield `data: ${JSON.stringify(toolCallChunk)}\n\n`;
      }
    }

    const finalChunk: OpenAIStreamChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: runtime.modelName,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: this.resolveStreamFinishReason(finishReasonValue, selectedToolCalls),
        },
      ],
    };

    yield `data: ${JSON.stringify(finalChunk)}\n\n`;
    yield 'data: [DONE]\n\n';
  }

  /**
   * Framework-agnostic handler for standard Request/Response
   * (Works with Hono, Cloudflare Workers, etc.)
   */
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!this.isChatCompletionsRequest(url.pathname, request.method)) {
      return new Response('Not Found', { status: 404 });
    }

    const body = await request.json() as OpenAIChatCompletionRequest;

    if (body.stream) {
      return new Response(this.createSSEReadableStream(this.handleChatCompletionStream(body)), {
        headers: SSE_HEADERS,
      });
    }

    const response = await this.handleChatCompletion(body);
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Express/Node.js middleware-style handler
   */
  expressHandler() {
    return async (req: any, res: any) => {
      if (!this.isChatCompletionsRequest(req.path, req.method)) {
        res.status(404).json({ error: 'Not Found' });
        return;
      }

      const body = req.body as OpenAIChatCompletionRequest;

      if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        try {
          for await (const chunk of this.handleChatCompletionStream(body)) {
            res.write(chunk);
          }
          res.end();
        } catch (error) {
          res.status(500).json({ error: String(error) });
        }
        return;
      }

      try {
        const response = await this.handleChatCompletion(body);
        res.json(response);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    };
  }

  /**
   * Hono middleware-style handler
   */
  honoHandler() {
    return async (c: any) => {
      if (!this.isChatCompletionsRequest(c.req.path, c.req.method)) {
        return c.json({ error: 'Not Found' }, 404);
      }

      const body = await c.req.json() as OpenAIChatCompletionRequest;

      if (body.stream) {
        return c.newResponse(this.createSSEReadableStream(this.handleChatCompletionStream(body)), {
          headers: SSE_HEADERS,
        });
      }

      const response = await this.handleChatCompletion(body);
      return c.json(response);
    };
  }
}

/**
 * Convenience factory function
 */
export function createACP2OpenAI(config?: ACP2OpenAIConfig): ACP2OpenAI {
  return new ACP2OpenAI(config);
}
