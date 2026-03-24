import {
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
  acpTools,
  createACPProvider,
  type ACPProviderSettings,
} from '@mcpc-tech/acp-ai-provider';
import { generateText, streamText, Output, type ModelMessage, tool } from 'ai';
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
import type {
  ResponseFormatText,
  ResponseFormatJSONSchema,
  ResponseFormatJSONObject,
} from 'openai/resources/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Type aliases - use OpenAI SDK types directly
// ─────────────────────────────────────────────────────────────────────────────

export type OpenAIMessage = ChatCompletionMessageParam;
export type OpenAITool = ChatCompletionTool;
export type OpenAIToolCall = ChatCompletionMessageFunctionToolCall;

export interface OpenAIExtraBody {
  // ACP provider config (command, session, etc.)
  acpConfig?: ACPProviderSettings;
  // AI SDK settings
  topK?: number;
  seed?: number;
}

// Extend OpenAI types with ACP-specific fields via extra_body
export interface OpenAIChatCompletionRequest extends Omit<ChatCompletionCreateParams, 'extra_body'> {
  extra_body?: OpenAIExtraBody;
}

export interface OpenAIResponsesInputMessage {
  type?: string;
  role?: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content?:
    | string
    | Array<{ type?: string; text?: string; input_text?: string; output_text?: string }>;
  tool_call_id?: string;
  call_id?: string;
}

export interface OpenAIResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export type OpenAIResponsesTool = OpenAIResponsesFunctionTool;

export type OpenAIResponsesToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; name: string }
  | { type: 'tool'; name: string }
  | { type: 'function'; function: { name: string } };

export interface OpenAIResponsesRequest {
  model?: string;
  input?: string | OpenAIResponsesInputMessage[];
  instructions?: string;
  tools?: OpenAIResponsesTool[];
  tool_choice?: OpenAIResponsesToolChoice;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  extra_body?: OpenAIExtraBody;
}

export interface OpenAIResponsesResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed';
  model: string;
  output: Array<
    | {
        type: 'message';
        id: string;
        role: 'assistant';
        status: 'completed';
        content: Array<{
          type: 'output_text';
          text: string;
          annotations: unknown[];
        }>;
      }
    | {
        type: 'function_call';
        id: string;
        call_id: string;
        name: string;
        arguments: string;
        status: 'completed';
      }
  >;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface OpenAIModelListResponse {
  object: 'list';
  data: OpenAIModelObject[];
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
const RESPONSES_PATH = '/v1/responses';
const MODELS_PATH = '/v1/models';
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

  private convertResponseFormat(
    responseFormat?: ResponseFormatText | ResponseFormatJSONSchema | ResponseFormatJSONObject,
  ): ReturnType<typeof Output.json> | undefined {
    if (!responseFormat) return undefined;

    switch (responseFormat.type) {
      case 'text':
        return undefined; // default behavior

      case 'json_object':
        return Output.json();

      case 'json_schema': {
        const { json_schema } = responseFormat as ResponseFormatJSONSchema;
        // Build a custom Output that passes the JSON Schema directly to the provider.
        // We can't use Output.object() because that requires a Zod schema,
        // and we have an arbitrary JSON Schema from the OpenAI request.
        return {
          name: 'object',
          responseFormat: Promise.resolve({
            type: 'json' as const,
            ...(json_schema.schema != null && { schema: json_schema.schema }),
            ...(json_schema.name != null && { name: json_schema.name }),
            ...(json_schema.description != null && { description: json_schema.description }),
          }),
          async parseCompleteOutput({ text }: { text: string }) {
            try {
              return JSON.parse(text);
            } catch {
              return text;
            }
          },
          async parsePartialOutput({ text }: { text: string }) {
            try {
              return { partial: JSON.parse(text) };
            } catch {
              return undefined;
            }
          },
          createElementStreamTransform() {
            return undefined;
          },
        } as ReturnType<typeof Output.json>;
      }

      default:
        return undefined;
    }
  }

  private buildGenerationOptions(req: OpenAIChatCompletionRequest) {
    const output = this.convertResponseFormat(req.response_format);

    return {
      temperature: req.temperature ?? undefined,
      maxOutputTokens: req.max_completion_tokens ?? req.max_tokens ?? undefined,
      topP: req.top_p ?? undefined,
      frequencyPenalty: req.frequency_penalty ?? undefined,
      presencePenalty: req.presence_penalty ?? undefined,
      topK: req.extra_body?.topK,
      seed: req.extra_body?.seed,
      ...(output != null && { output }),
    };
  }

  private stringifyResponsesInputContent(content: OpenAIResponsesInputMessage['content']): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content
      .map((part) => {
        if (typeof part.text === 'string') return part.text;
        if (typeof part.input_text === 'string') return part.input_text;
        if (typeof part.output_text === 'string') return part.output_text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private convertResponsesTools(tools?: OpenAIResponsesTool[]): OpenAITool[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    const mapped = tools
      .filter((tool): tool is OpenAIResponsesFunctionTool => tool.type === 'function' && !!tool.name)
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: 'object', properties: {} },
        },
      }));

    return mapped.length > 0 ? mapped : undefined;
  }

  private convertResponsesToolChoice(toolChoice?: OpenAIResponsesToolChoice): ChatCompletionToolChoiceOption | undefined {
    if (!toolChoice) return undefined;
    if (toolChoice === 'none' || toolChoice === 'auto' || toolChoice === 'required') return toolChoice;

    if (typeof toolChoice === 'object') {
      if (toolChoice.type === 'function' && 'name' in toolChoice) {
        return {
          type: 'function',
          function: { name: toolChoice.name },
        };
      }

      if (toolChoice.type === 'tool' && 'name' in toolChoice) {
        return {
          type: 'function',
          function: { name: toolChoice.name },
        };
      }

      if (toolChoice.type === 'function' && 'function' in toolChoice) {
        return {
          type: 'function',
          function: { name: toolChoice.function.name },
        };
      }
    }

    return undefined;
  }

  private convertResponsesInputToMessages(req: OpenAIResponsesRequest): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    if (req.instructions) {
      messages.push({ role: 'system', content: req.instructions });
    }

    const input = req.input;

    if (typeof input === 'string') {
      messages.push({ role: 'user', content: input });
      return messages;
    }

    if (!Array.isArray(input)) return messages;

    for (const item of input) {
      const role = item?.role;
      const content = this.stringifyResponsesInputContent(item?.content);

      if (item?.type === 'function_call_output') {
        messages.push({
          role: 'tool',
          tool_call_id: item.call_id ?? item.tool_call_id ?? '',
          content,
        });
        continue;
      }

      if (role === 'tool') {
        messages.push({
          role: 'tool',
          tool_call_id: item.call_id ?? item.tool_call_id ?? '',
          content,
        });
        continue;
      }

      if (role === 'system' || role === 'developer' || role === 'assistant' || role === 'user') {
        messages.push({ role, content });
      }
    }

    return messages;
  }

  private toChatCompletionRequestFromResponses(req: OpenAIResponsesRequest): OpenAIChatCompletionRequest {
    return {
      model: req.model || this.config.defaultModel || 'default',
      messages: this.convertResponsesInputToMessages(req),
      tools: this.convertResponsesTools(req.tools),
      tool_choice: this.convertResponsesToolChoice(req.tool_choice),
      temperature: req.temperature,
      max_tokens: req.max_output_tokens,
      top_p: req.top_p,
      frequency_penalty: req.frequency_penalty,
      presence_penalty: req.presence_penalty,
      stream: req.stream,
      extra_body: req.extra_body,
    };
  }

  private toResponsesOutput(
    messageContent: string | null,
    toolCalls: OpenAIToolCall[] | undefined,
  ): OpenAIResponsesResponse['output'] {
    const output: OpenAIResponsesResponse['output'] = [];

    if (messageContent && messageContent.length > 0) {
      output.push({
        type: 'message',
        id: `msg_${Math.random().toString(36).slice(2, 15)}`,
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: messageContent,
            annotations: [],
          },
        ],
      });
    }

    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        if (call.type !== 'function') continue;

        output.push({
          type: 'function_call',
          id: call.id,
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          status: 'completed',
        });
      }
    }

    if (output.length === 0) {
      output.push({
        type: 'message',
        id: `msg_${Math.random().toString(36).slice(2, 15)}`,
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: '',
            annotations: [],
          },
        ],
      });
    }

    return output;
  }

  private mapChatToResponses(
    chatResponse: OpenAIChatCompletionResponse,
    responseId?: string,
  ): OpenAIResponsesResponse {
    const id = responseId ?? `resp_${Math.random().toString(36).slice(2, 15)}`;
    const message = chatResponse.choices[0]?.message;
    const usage = chatResponse.usage;

    return {
      id,
      object: 'response',
      created_at: chatResponse.created,
      status: 'completed',
      model: chatResponse.model,
      output: this.toResponsesOutput(
        message?.content ?? null,
        this.toOpenAIToolCalls((message?.tool_calls as any[]) ?? undefined),
      ),
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    };
  }

  private parseSSEDataChunk(chunk: string): OpenAIStreamChunk | null {
    if (!chunk.startsWith('data: ')) return null;
    const payload = chunk.slice('data: '.length).trim();
    if (!payload || payload === '[DONE]') return null;

    try {
      return JSON.parse(payload) as OpenAIStreamChunk;
    } catch {
      return null;
    }
  }

  private mergeStreamToolCalls(
    existing: OpenAIToolCall[],
    incoming: NonNullable<OpenAIStreamChunk['choices']>[number]['delta']['tool_calls'],
  ): OpenAIToolCall[] {
    if (!incoming || incoming.length === 0) return existing;

    const map = new Map(existing.map((call) => [call.id, call]));

    for (const item of incoming) {
      if (!item.id || item.type !== 'function' || !item.function) continue;

      map.set(item.id, {
        id: item.id,
        type: 'function',
        function: {
          name: item.function.name ?? '',
          arguments: item.function.arguments ?? '{}',
        },
      });
    }

    return Array.from(map.values());
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

  private isResponsesRequest(path: string, method: string): boolean {
    return path === RESPONSES_PATH && method === 'POST';
  }

  private isModelsListRequest(path: string, method: string): boolean {
    return path === MODELS_PATH && method === 'GET';
  }

  private isSupportedRequest(path: string, method: string): boolean {
    return this.isChatCompletionsRequest(path, method)
      || this.isResponsesRequest(path, method)
      || this.isModelsListRequest(path, method);
  }

  private async handleModelsList(): Promise<OpenAIModelListResponse> {
    if (!this.config.defaultACPConfig) {
      throw new Error('defaultACPConfig is required for GET /v1/models (needs ACP initSession)');
    }

    const provider = createACPProvider(this.config.defaultACPConfig);

    try {
      const sessionInfo = await provider.initSession();
      const created = Math.floor(Date.now() / 1000);
      const availableModelIds = (sessionInfo.models?.availableModels ?? [])
        .map((model) => model.modelId)
        .filter((id): id is string => Boolean(id));

      const modelCandidates = [
        ...availableModelIds,
        sessionInfo.models?.currentModelId,
        this.config.defaultModel,
        'default',
      ].filter((m): m is string => Boolean(m));

      const modelIds = Array.from(new Set(modelCandidates));

      return {
        object: 'list',
        data: modelIds.map((id) => ({
          id,
          object: 'model',
          created,
          owned_by: 'acp2openai',
        })),
      };
    } finally {
      provider.cleanup();
    }
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

  async handleResponses(req: OpenAIResponsesRequest): Promise<OpenAIResponsesResponse> {
    const chatReq = this.toChatCompletionRequestFromResponses(req);
    const chatResponse = await this.handleChatCompletion(chatReq);
    return this.mapChatToResponses(chatResponse);
  }

  async *handleResponsesStream(req: OpenAIResponsesRequest): AsyncIterable<string> {
    const chatReq = this.toChatCompletionRequestFromResponses({ ...req, stream: true });
    const responseId = `resp_${Math.random().toString(36).slice(2, 15)}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const modelName = chatReq.model || this.config.defaultModel || 'default';
    const messageId = `msg_${Math.random().toString(36).slice(2, 15)}`;

    yield `event: response.created\ndata: ${JSON.stringify({
      type: 'response.created',
      response: {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        status: 'in_progress',
        model: modelName,
        output: [],
      },
    })}\n\n`;

    let fullText = '';
    let toolCalls: OpenAIToolCall[] = [];

    for await (const chunk of this.handleChatCompletionStream(chatReq)) {
      const parsed = this.parseSSEDataChunk(chunk);
      if (!parsed) continue;

      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        fullText += delta.content;
        yield `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: 'response.output_text.delta',
          response_id: responseId,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          delta: delta.content,
        })}\n\n`;
      }

      if (delta?.tool_calls && delta.tool_calls.length > 0) {
        toolCalls = this.mergeStreamToolCalls(toolCalls, delta.tool_calls);
      }
    }

    const finalChatResponse: OpenAIChatCompletionResponse = {
      id: `chatcmpl-${Math.random().toString(36).slice(2, 15)}`,
      object: 'chat.completion',
      created: createdAt,
      model: modelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: fullText || null,
            refusal: null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      service_tier: null,
    };

    const finalResponse = this.mapChatToResponses(finalChatResponse, responseId);

    yield `event: response.completed\ndata: ${JSON.stringify({
      type: 'response.completed',
      response: finalResponse,
    })}\n\n`;
    yield 'data: [DONE]\n\n';
  }

  /**
   * Framework-agnostic handler for standard Request/Response
   * (Works with Hono, Cloudflare Workers, etc.)
   */
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!this.isSupportedRequest(url.pathname, request.method)) {
      return new Response('Not Found', { status: 404 });
    }

    if (this.isModelsListRequest(url.pathname, request.method)) {
      const response = await this.handleModelsList();
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (this.isResponsesRequest(url.pathname, request.method)) {
      const body = await request.json() as OpenAIResponsesRequest;

      if (body.stream) {
        return new Response(this.createSSEReadableStream(this.handleResponsesStream(body)), {
          headers: SSE_HEADERS,
        });
      }

      const response = await this.handleResponses(body);
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });
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
      if (!this.isSupportedRequest(req.path, req.method)) {
        res.status(404).json({ error: 'Not Found' });
        return;
      }

      if (this.isModelsListRequest(req.path, req.method)) {
        try {
          const response = await this.handleModelsList();
          res.json(response);
        } catch (error) {
          res.status(500).json({ error: String(error) });
        }
        return;
      }

      const isResponses = this.isResponsesRequest(req.path, req.method);
      const body = req.body as OpenAIChatCompletionRequest | OpenAIResponsesRequest;

      if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        try {
          if (isResponses) {
            for await (const chunk of this.handleResponsesStream(body as OpenAIResponsesRequest)) {
              res.write(chunk);
            }
          } else {
            for await (const chunk of this.handleChatCompletionStream(body as OpenAIChatCompletionRequest)) {
              res.write(chunk);
            }
          }
          res.end();
        } catch (error) {
          res.status(500).json({ error: String(error) });
        }
        return;
      }

      try {
        const response = isResponses
          ? await this.handleResponses(body as OpenAIResponsesRequest)
          : await this.handleChatCompletion(body as OpenAIChatCompletionRequest);
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
      if (!this.isSupportedRequest(c.req.path, c.req.method)) {
        return c.json({ error: 'Not Found' }, 404);
      }

      if (this.isModelsListRequest(c.req.path, c.req.method)) {
        return c.json(await this.handleModelsList());
      }

      const isResponses = this.isResponsesRequest(c.req.path, c.req.method);
      const body = await c.req.json() as OpenAIChatCompletionRequest | OpenAIResponsesRequest;

      if (body.stream) {
        return c.newResponse(
          this.createSSEReadableStream(
            isResponses
              ? this.handleResponsesStream(body as OpenAIResponsesRequest)
              : this.handleChatCompletionStream(body as OpenAIChatCompletionRequest),
          ),
          {
            headers: SSE_HEADERS,
          },
        );
      }

      const response = isResponses
        ? await this.handleResponses(body as OpenAIResponsesRequest)
        : await this.handleChatCompletion(body as OpenAIChatCompletionRequest);
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
