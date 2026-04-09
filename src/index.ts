import {
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
  acpTools,
  createACPProvider,
  type ACPProviderSettings,
} from "@mcpc-tech/acp-ai-provider";
import {
  generateText,
  streamText,
  Output,
  type ModelMessage,
  tool,
  jsonSchema,
} from "ai";
import { z } from "zod/v4";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type {
  ResponseFormatText,
  ResponseFormatJSONSchema,
  ResponseFormatJSONObject,
} from "openai/resources/shared";

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

export type ACP2OpenAIEndpoint = "chat.completions" | "responses" | "messages";
export type ACP2OpenAICallType = "generateText" | "streamText";
export type ACP2OpenAIToolChoiceValue =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; toolName: string };

export interface ACP2OpenAIModelCallParams {
  model: any;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  topK?: number;
  seed?: number;
  output?: ReturnType<typeof Output.json>;
  tools?: Record<string, any>;
  toolChoice?: ACP2OpenAIToolChoiceValue;
}

export interface ACP2ProviderRuntime {
  model: any;
  modelName?: string;
  tools?: Record<string, any>;
  toolChoice?: ACP2OpenAIToolChoiceValue;
  cleanup?: () => void | Promise<void>;
}

export interface ACP2RuntimeFactoryContext {
  endpoint: ACP2OpenAIEndpoint;
  callType: ACP2OpenAICallType;
  request: OpenAIChatCompletionRequest;
  modelId?: string;
  defaultModel?: string;
}

export type ACP2RuntimeFactory = (
  context: ACP2RuntimeFactoryContext,
) => ACP2ProviderRuntime | Promise<ACP2ProviderRuntime>;

export type ACP2ListModelsResolver =
  | (() => string[] | Promise<string[]>)
  | string[];

export type ACP2OpenAIResultEventType = "text-delta" | "tool-calls" | "finish";

export interface ACP2OpenAIResultMutation {
  eventType: ACP2OpenAIResultEventType;
  textDelta?: string;
  toolCalls?: any[];
  finishReason?: string;
}

export interface ACP2OpenAIUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ACP2OpenAIFinalResult {
  text?: string | null;
  toolCalls?: any[];
  finishReason?: string;
  usage?: ACP2OpenAIUsage;
}

export interface ACP2OpenAIRunModelOptions {
  callType?: ACP2OpenAICallType;
  skipPlugins?: boolean;
}

export interface ACP2OpenAIResultHandlerContext {
  endpoint: ACP2OpenAIEndpoint;
  callType: ACP2OpenAICallType;
  stream: boolean;
  originalRequest:
    | OpenAIChatCompletionRequest
    | OpenAIResponsesRequest
    | AnthropicMessagesRequest;
  request: OpenAIChatCompletionRequest;
  params: ACP2OpenAIModelCallParams;
  result: ACP2OpenAIFinalResult;
  overrideResult?: ACP2OpenAIFinalResult;
  runModel: (
    request: OpenAIChatCompletionRequest,
    options?: ACP2OpenAIRunModelOptions,
  ) => Promise<ACP2OpenAIFinalResult>;
}

export type ACP2OpenAIResultHandler = (
  context: ACP2OpenAIResultHandlerContext,
) => void | Promise<void>;

export interface ACP2OpenAIPlugin {
  name?: string;
  middleware?: ACP2OpenAIMiddleware | ACP2OpenAIMiddleware[];
  onResult?: ACP2OpenAIResultHandler | ACP2OpenAIResultHandler[];
}

export interface ACP2OpenAIMiddlewareContext {
  phase: "request" | "params" | "result";
  endpoint: ACP2OpenAIEndpoint;
  callType: ACP2OpenAICallType;
  stream: boolean;
  originalRequest:
    | OpenAIChatCompletionRequest
    | OpenAIResponsesRequest
    | AnthropicMessagesRequest;
  request: OpenAIChatCompletionRequest;
  params?: ACP2OpenAIModelCallParams;
  result?: ACP2OpenAIResultMutation;
}

export type ACP2OpenAIMiddleware = (
  context: ACP2OpenAIMiddlewareContext,
) => void | Promise<void>;

// Extend OpenAI types with ACP-specific fields via extra_body
export interface OpenAIChatCompletionRequest extends Omit<
  ChatCompletionCreateParams,
  "extra_body"
> {
  extra_body?: OpenAIExtraBody;
}

export interface OpenAIResponsesInputMessage {
  type?: string;
  role?: "system" | "developer" | "user" | "assistant" | "tool";
  content?:
    | string
    | Array<{
        type?: string;
        text?: string;
        input_text?: string;
        output_text?: string;
      }>;
  tool_call_id?: string;
  call_id?: string;
}

export interface OpenAIResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export type OpenAIResponsesTool = OpenAIResponsesFunctionTool;

export type OpenAIResponsesToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; name: string }
  | { type: "tool"; name: string }
  | { type: "function"; function: { name: string } };

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
  object: "response";
  created_at: number;
  status: "completed";
  model: string;
  output: Array<
    | {
        type: "message";
        id: string;
        role: "assistant";
        status: "completed";
        content: Array<{
          type: "output_text";
          text: string;
          annotations: unknown[];
        }>;
      }
    | {
        type: "function_call";
        id: string;
        call_id: string;
        name: string;
        arguments: string;
        status: "completed";
      }
  >;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type?: string;
  };
}

export interface AnthropicImageBlock {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicTextBlock[];
  is_error?: boolean;
  cache_control?: {
    type?: string;
  };
}

export interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock;

export interface AnthropicMessageParam {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string }
  | { type: "none" };

export interface AnthropicMessagesRequest {
  model?: string;
  messages: AnthropicMessageParam[];
  system?: string | AnthropicTextBlock[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  extra_body?: OpenAIExtraBody;
}

export type AnthropicStopReason =
  | "end_turn"
  | "max_tokens"
  | "tool_use"
  | "stop_sequence";

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  stop_reason: AnthropicStopReason;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface OpenAIModelObject {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface OpenAIModelListResponse {
  object: "list";
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
  middleware?: ACP2OpenAIMiddleware | ACP2OpenAIMiddleware[];
  plugins?: ACP2OpenAIPlugin | ACP2OpenAIPlugin[];
  runtimeFactory?: ACP2RuntimeFactory;
  listModels?: ACP2ListModelsResolver;
}

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const RESPONSES_PATH = "/v1/responses";
const MESSAGES_PATH = "/v1/messages";
const MODELS_PATH = "/v1/models";
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;
const REQUEST_TOOL_PRIORITY_PROMPT_MARKER = "## Request-scoped MCP tools";

type OpenAIFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "function_call";

type RuntimeContext = ACP2ProviderRuntime & {
  modelName: string;
  tools: Record<string, any> | undefined;
  toolChoice: ACP2OpenAIToolChoiceValue | undefined;
  allowedToolNames: Set<string>;
  forcedToolName?: string;
};

type ToolSelectionContext = Pick<
  RuntimeContext,
  "allowedToolNames" | "forcedToolName"
>;

type PreparedChatInvocation = {
  endpoint: ACP2OpenAIEndpoint;
  callType: ACP2OpenAICallType;
  originalRequest:
    | OpenAIChatCompletionRequest
    | OpenAIResponsesRequest
    | AnthropicMessagesRequest;
  request: OpenAIChatCompletionRequest;
  runtime: RuntimeContext;
  params: ACP2OpenAIModelCallParams;
  toolSelection: ToolSelectionContext;
};

// ─────────────────────────────────────────────────────────────────────────────
// Core adapter class
// ─────────────────────────────────────────────────────────────────────────────

export class ACP2OpenAI {
  private config: ACP2OpenAIConfig;

  constructor(config: ACP2OpenAIConfig = {}) {
    this.config = config;
  }

  private getPlugins(): ACP2OpenAIPlugin[] {
    if (!this.config.plugins) return [];
    return Array.isArray(this.config.plugins)
      ? this.config.plugins
      : [this.config.plugins];
  }

  private getMiddlewares(): ACP2OpenAIMiddleware[] {
    const configured = !this.config.middleware
      ? []
      : Array.isArray(this.config.middleware)
        ? this.config.middleware
        : [this.config.middleware];

    const fromPlugins = this.getPlugins().flatMap((plugin) => {
      if (!plugin.middleware) return [];
      return Array.isArray(plugin.middleware)
        ? plugin.middleware
        : [plugin.middleware];
    });

    return [...configured, ...fromPlugins];
  }

  private getResultHandlers(): ACP2OpenAIResultHandler[] {
    return this.getPlugins().flatMap((plugin) => {
      if (!plugin.onResult) return [];
      return Array.isArray(plugin.onResult)
        ? plugin.onResult
        : [plugin.onResult];
    });
  }

  private hasResultHandlers(): boolean {
    return this.getResultHandlers().length > 0;
  }

  private cloneRequest<T>(value: T): T {
    if (typeof globalThis.structuredClone === "function") {
      return globalThis.structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
  }

  private async runMiddleware(
    context: ACP2OpenAIMiddlewareContext,
  ): Promise<void> {
    for (const middleware of this.getMiddlewares()) {
      await middleware(context);
    }
  }

  private buildModelCallParams(
    req: OpenAIChatCompletionRequest,
    runtime: RuntimeContext,
  ): ACP2OpenAIModelCallParams {
    return {
      model: runtime.model,
      messages: this.convertMessages(req.messages),
      ...this.buildGenerationOptions(req),
      tools: runtime.tools,
      toolChoice: runtime.toolChoice,
    };
  }

  private injectRequestToolPriorityPrompt(
    req: OpenAIChatCompletionRequest,
  ): void {
    const prompt = this.buildRequestToolPriorityPrompt(req.tools);
    if (!prompt || this.hasRequestToolPriorityPrompt(req.messages)) {
      return;
    }

    const firstMessage = req.messages[0];
    if (
      firstMessage &&
      (firstMessage.role === "system" || firstMessage.role === "developer") &&
      typeof firstMessage.content === "string"
    ) {
      firstMessage.content = `${firstMessage.content}\n\n${prompt}`;
      return;
    }

    req.messages = [{ role: "system", content: prompt }, ...req.messages];
  }

  private buildRequestToolPriorityPrompt(
    openaiTools?: OpenAITool[],
  ): string | undefined {
    const toolNames = Array.from(this.getAllowedToolNames(openaiTools));
    if (toolNames.length === 0) return undefined;

    const toolList = toolNames.map((name) => `- \`${name}\``).join("\n");

    return `${REQUEST_TOOL_PRIORITY_PROMPT_MARKER}

<available_tools>
The following request-scoped MCP tools are available for this request. Note: These tools may be prefixed with the MCP server name (e.g., "mcp__acp-ai-sdk-tools__tool_name"):
${toolList}
</available_tools>

<tool_selection_priority>
1. <priority>ALWAYS use tools from <available_tools> above when they can solve the task.</priority>
2. <priority>DO NOT use built-in or provider tools when a suitable tool exists in <available_tools>.</priority>
3. <priority>When calling a tool, use the EXACT name as listed in <available_tools>, including any provider prefix.</priority>
</tool_selection_priority>`;
  }

  private hasRequestToolPriorityPrompt(
    messages: ChatCompletionMessageParam[],
  ): boolean {
    return messages.some(
      (message) =>
        (message.role === "system" || message.role === "developer") &&
        typeof message.content === "string" &&
        message.content.includes(REQUEST_TOOL_PRIORITY_PROMPT_MARKER),
    );
  }

  private buildToolSelectionFromParams(
    params: ACP2OpenAIModelCallParams,
  ): ToolSelectionContext {
    const allowedToolNames = new Set<string>(Object.keys(params.tools ?? {}));
    let forcedToolName: string | undefined;

    if (
      params.toolChoice &&
      typeof params.toolChoice === "object" &&
      params.toolChoice.type === "tool"
    ) {
      forcedToolName = params.toolChoice.toolName;
    } else if (
      params.toolChoice === "required" &&
      allowedToolNames.size === 1
    ) {
      forcedToolName = Array.from(allowedToolNames)[0];
    }

    return {
      allowedToolNames,
      forcedToolName,
    };
  }

  private async prepareChatInvocation({
    endpoint,
    callType,
    originalRequest,
    request,
  }: {
    endpoint: ACP2OpenAIEndpoint;
    callType: ACP2OpenAICallType;
    originalRequest:
      | OpenAIChatCompletionRequest
      | OpenAIResponsesRequest
      | AnthropicMessagesRequest;
    request: OpenAIChatCompletionRequest;
  }): Promise<PreparedChatInvocation> {
    const mutableRequest = this.cloneRequest(request);
    const stream = callType === "streamText";

    await this.runMiddleware({
      phase: "request",
      endpoint,
      callType,
      stream,
      originalRequest,
      request: mutableRequest,
    });

    this.injectRequestToolPriorityPrompt(mutableRequest);

    const runtime = await this.buildRuntime(mutableRequest, endpoint, callType);
    const params = this.buildModelCallParams(mutableRequest, runtime);

    await this.runMiddleware({
      phase: "params",
      endpoint,
      callType,
      stream,
      originalRequest,
      request: mutableRequest,
      params,
    });

    return {
      endpoint,
      callType,
      originalRequest,
      request: mutableRequest,
      runtime,
      params,
      toolSelection: this.buildToolSelectionFromParams(params),
    };
  }

  private async mutateStreamResult(
    invocation: PreparedChatInvocation,
    result: ACP2OpenAIResultMutation,
  ): Promise<ACP2OpenAIResultMutation> {
    const mutableResult = this.cloneRequest(result);

    await this.runMiddleware({
      phase: "result",
      endpoint: invocation.endpoint,
      callType: invocation.callType,
      stream: true,
      originalRequest: invocation.originalRequest,
      request: invocation.request,
      params: invocation.params,
      result: mutableResult,
    });

    return mutableResult;
  }

  private async runModelFromResultHandler(
    invocation: PreparedChatInvocation,
    request: OpenAIChatCompletionRequest,
    options?: ACP2OpenAIRunModelOptions,
  ): Promise<ACP2OpenAIFinalResult> {
    const nestedInvocation = await this.prepareChatInvocation({
      endpoint: invocation.endpoint,
      callType: options?.callType ?? "streamText",
      originalRequest: request,
      request,
    });

    // Always use streamText path so tools are forwarded correctly
    const { result } = await this.collectPreparedStreamResult(nestedInvocation);
    return result;
  }

  private async applyResultHandlers(
    invocation: PreparedChatInvocation,
    result: ACP2OpenAIFinalResult,
  ): Promise<{ result: ACP2OpenAIFinalResult; overridden: boolean }> {
    if (!this.hasResultHandlers()) {
      return {
        result: this.cloneRequest(result),
        overridden: false,
      };
    }

    let mutableResult = this.cloneRequest(result);
    let overridden = false;

    for (const handler of this.getResultHandlers()) {
      const context: ACP2OpenAIResultHandlerContext = {
        endpoint: invocation.endpoint,
        callType: invocation.callType,
        stream: invocation.callType === "streamText",
        originalRequest: invocation.originalRequest,
        request: this.cloneRequest(invocation.request),
        params: {
          ...invocation.params,
          messages: this.cloneRequest(invocation.params.messages),
        },
        result: mutableResult,
        runModel: async (request, options) =>
          await this.runModelFromResultHandler(invocation, request, options),
      };

      await handler(context);

      if (context.overrideResult) {
        mutableResult = this.cloneRequest(context.overrideResult);
        overridden = true;
        continue;
      }

      mutableResult = this.cloneRequest(context.result);
    }

    return {
      result: mutableResult,
      overridden,
    };
  }

  private async runPreparedModelResult(
    invocation: PreparedChatInvocation,
    applyPlugins = true,
  ): Promise<ACP2OpenAIFinalResult> {
    try {
      const result = await generateText(invocation.params);
      let finalResult: ACP2OpenAIFinalResult = {
        text: result.text ?? null,
        toolCalls: this.pickToolCalls(
          result.toolCalls,
          invocation.toolSelection,
        ),
        finishReason: result.finishReason,
        usage: {
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          totalTokens: result.usage?.totalTokens ?? 0,
        },
      };

      if (applyPlugins) {
        finalResult = (await this.applyResultHandlers(invocation, finalResult))
          .result;
      }

      return finalResult;
    } finally {
      await this.cleanupRuntime(invocation.runtime);
    }
  }

  private ensureACPConfig(
    req: OpenAIChatCompletionRequest,
  ): ACPProviderSettings {
    const acpConfig = req.extra_body?.acpConfig || this.config.defaultACPConfig;
    if (!acpConfig) {
      throw new Error(
        "ACP session config is required (via extra_body.acpConfig or defaultACPConfig)",
      );
    }
    return acpConfig;
  }

  private resolveModelId(req: OpenAIChatCompletionRequest): string | undefined {
    const id = req.model || this.config.defaultModel;
    return id || undefined;
  }

  private buildDefaultACPRuntime(
    req: OpenAIChatCompletionRequest,
    modelId: string | undefined,
  ): ACP2ProviderRuntime {
    const provider = createACPProvider(this.ensureACPConfig(req));
    const providerTools = provider.tools as Record<string, any> | undefined;

    return {
      model: provider.languageModel(modelId),
      modelName: modelId,
      tools: providerTools,
      cleanup: () => {
        provider.cleanup();
      },
    };
  }

  private async buildRuntime(
    req: OpenAIChatCompletionRequest,
    endpoint: ACP2OpenAIEndpoint,
    callType: ACP2OpenAICallType,
  ): Promise<RuntimeContext> {
    const modelId = this.resolveModelId(req);
    const requestTools = this.convertTools(req.tools);
    const allowedToolNames = this.getAllowedToolNames(req.tools);
    const providerRuntime = this.config.runtimeFactory
      ? await this.config.runtimeFactory({
          endpoint,
          callType,
          request: this.cloneRequest(req),
          modelId,
          defaultModel: this.config.defaultModel,
        })
      : this.buildDefaultACPRuntime(req, modelId);

    return {
      ...providerRuntime,
      modelName: providerRuntime.modelName ?? modelId ?? "",
      tools: this.mergeTools(providerRuntime.tools, requestTools),
      toolChoice:
        providerRuntime.toolChoice ??
        this.convertToolChoice(req.tool_choice, req.tools),
      allowedToolNames,
      forcedToolName: this.getForcedToolName(req.tool_choice, req.tools),
    };
  }

  private convertResponseFormat(
    responseFormat?:
      | ResponseFormatText
      | ResponseFormatJSONSchema
      | ResponseFormatJSONObject,
  ): ReturnType<typeof Output.json> | undefined {
    if (!responseFormat) return undefined;

    switch (responseFormat.type) {
      case "text":
        return undefined; // default behavior

      case "json_object":
        return Output.json();

      case "json_schema": {
        const { json_schema } = responseFormat as ResponseFormatJSONSchema;
        // Build a custom Output that passes the JSON Schema directly to the provider.
        // We can't use Output.object() because that requires a Zod schema,
        // and we have an arbitrary JSON Schema from the OpenAI request.
        return {
          name: "object",
          responseFormat: Promise.resolve({
            type: "json" as const,
            ...(json_schema.schema != null && { schema: json_schema.schema }),
            ...(json_schema.name != null && { name: json_schema.name }),
            ...(json_schema.description != null && {
              description: json_schema.description,
            }),
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

    const stopSequences = Array.isArray(req.stop)
      ? req.stop.filter((value): value is string => typeof value === "string")
      : typeof req.stop === "string"
        ? [req.stop]
        : undefined;

    return {
      temperature: req.temperature ?? undefined,
      maxOutputTokens: req.max_completion_tokens ?? req.max_tokens ?? undefined,
      topP: req.top_p ?? undefined,
      frequencyPenalty: req.frequency_penalty ?? undefined,
      presencePenalty: req.presence_penalty ?? undefined,
      stopSequences,
      topK: req.extra_body?.topK,
      seed: req.extra_body?.seed,
      ...(output != null && { output }),
    };
  }

  private stringifyResponsesInputContent(
    content: OpenAIResponsesInputMessage["content"],
  ): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
      .map((part) => {
        if (typeof part.text === "string") return part.text;
        if (typeof part.input_text === "string") return part.input_text;
        if (typeof part.output_text === "string") return part.output_text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  private convertResponsesTools(
    tools?: OpenAIResponsesTool[],
  ): OpenAITool[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    const mapped = tools
      .filter(
        (tool): tool is OpenAIResponsesFunctionTool =>
          tool.type === "function" && !!tool.name,
      )
      .map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: "object", properties: {} },
        },
      }));

    return mapped.length > 0 ? mapped : undefined;
  }

  private convertResponsesToolChoice(
    toolChoice?: OpenAIResponsesToolChoice,
  ): ChatCompletionToolChoiceOption | undefined {
    if (!toolChoice) return undefined;
    if (
      toolChoice === "none" ||
      toolChoice === "auto" ||
      toolChoice === "required"
    )
      return toolChoice;

    if (typeof toolChoice === "object") {
      if (toolChoice.type === "function" && "name" in toolChoice) {
        return {
          type: "function",
          function: { name: toolChoice.name },
        };
      }

      if (toolChoice.type === "tool" && "name" in toolChoice) {
        return {
          type: "function",
          function: { name: toolChoice.name },
        };
      }

      if (toolChoice.type === "function" && "function" in toolChoice) {
        return {
          type: "function",
          function: { name: toolChoice.function.name },
        };
      }
    }

    return undefined;
  }

  private convertResponsesInputToMessages(
    req: OpenAIResponsesRequest,
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    if (req.instructions) {
      messages.push({ role: "system", content: req.instructions });
    }

    const input = req.input;

    if (typeof input === "string") {
      messages.push({ role: "user", content: input });
      return messages;
    }

    if (!Array.isArray(input)) return messages;

    for (const item of input) {
      const role = item?.role;
      const content = this.stringifyResponsesInputContent(item?.content);

      if (item?.type === "function_call_output") {
        messages.push({
          role: "tool",
          tool_call_id: item.call_id ?? item.tool_call_id ?? "",
          content,
        });
        continue;
      }

      if (role === "tool") {
        messages.push({
          role: "tool",
          tool_call_id: item.call_id ?? item.tool_call_id ?? "",
          content,
        });
        continue;
      }

      if (
        role === "system" ||
        role === "developer" ||
        role === "assistant" ||
        role === "user"
      ) {
        messages.push({ role, content });
      }
    }

    return messages;
  }

  private toChatCompletionRequestFromResponses(
    req: OpenAIResponsesRequest,
  ): OpenAIChatCompletionRequest {
    return {
      model: req.model || this.config.defaultModel || "",
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
  ): OpenAIResponsesResponse["output"] {
    const output: OpenAIResponsesResponse["output"] = [];

    if (messageContent && messageContent.length > 0) {
      output.push({
        type: "message",
        id: `msg_${Math.random().toString(36).slice(2, 15)}`,
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: messageContent,
            annotations: [],
          },
        ],
      });
    }

    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        if (call.type !== "function") continue;

        output.push({
          type: "function_call",
          id: call.id,
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          status: "completed",
        });
      }
    }

    if (output.length === 0) {
      output.push({
        type: "message",
        id: `msg_${Math.random().toString(36).slice(2, 15)}`,
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "",
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
      object: "response",
      created_at: chatResponse.created,
      status: "completed",
      model: chatResponse.model,
      output: this.toResponsesOutput(
        message?.content ?? null,
        this.coerceOpenAIToolCalls(message?.tool_calls),
      ),
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
        total_tokens: usage?.total_tokens ?? 0,
      },
    };
  }

  private coerceOpenAIToolCalls(
    toolCalls: unknown,
  ): OpenAIToolCall[] | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

    const direct = toolCalls.filter(
      (call): call is OpenAIToolCall =>
        this.isRecord(call) &&
        typeof call.id === "string" &&
        call.type === "function" &&
        this.isRecord(call.function) &&
        typeof call.function.name === "string" &&
        typeof call.function.arguments === "string",
    );

    if (direct.length > 0) {
      return direct;
    }

    return this.toOpenAIToolCalls(toolCalls as any[]);
  }

  private stringifyAnthropicBlockText(
    content: string | AnthropicTextBlock[],
  ): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  private convertAnthropicToolsToOpenAI(
    tools?: AnthropicTool[],
  ): OpenAITool[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    const mapped = tools
      .filter((tool) => !!tool.name)
      .map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema ?? { type: "object", properties: {} },
        },
      }));

    return mapped.length > 0 ? mapped : undefined;
  }

  private convertAnthropicToolChoice(
    toolChoice?: AnthropicToolChoice,
  ): ChatCompletionToolChoiceOption | undefined {
    if (!toolChoice) return undefined;

    if (toolChoice.type === "tool") {
      return {
        type: "function",
        function: { name: toolChoice.name },
      };
    }

    if (toolChoice.type === "any") return "required";
    if (toolChoice.type === "auto" || toolChoice.type === "none") {
      return toolChoice.type;
    }

    return undefined;
  }

  private convertAnthropicMessagesToOpenAI(
    req: AnthropicMessagesRequest,
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    if (typeof req.system === "string" && req.system.length > 0) {
      messages.push({ role: "system", content: req.system });
    } else if (Array.isArray(req.system) && req.system.length > 0) {
      const systemText = req.system
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      if (systemText.length > 0) {
        messages.push({ role: "system", content: systemText });
      }
    }

    for (const message of req.messages ?? []) {
      if (typeof message.content === "string") {
        messages.push({ role: message.role, content: message.content });
        continue;
      }

      if (!Array.isArray(message.content)) continue;

      if (message.role === "user") {
        const userParts: any[] = [];

        for (const block of message.content) {
          if (block.type === "text") {
            userParts.push({ type: "text", text: block.text });
            continue;
          }

          if (block.type === "image") {
            const source = block.source;
            const url =
              source.type === "base64" && source.data
                ? `data:${source.media_type ?? "application/octet-stream"};base64,${source.data}`
                : source.url;

            if (url) {
              userParts.push({
                type: "image_url",
                image_url: { url },
              });
            }
            continue;
          }

          if (block.type === "tool_result") {
            messages.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: this.stringifyAnthropicBlockText(block.content),
            });
          }
        }

        if (userParts.length === 1 && userParts[0]?.type === "text") {
          messages.push({ role: "user", content: userParts[0].text });
        } else if (userParts.length > 0) {
          messages.push({ role: "user", content: userParts as any });
        }

        continue;
      }

      const textParts: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];

      for (const block of message.content) {
        if (block.type === "text") {
          textParts.push(block.text);
          continue;
        }

        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        }
      }

      if (textParts.length === 0 && toolCalls.length === 0) continue;

      messages.push({
        role: "assistant",
        content: textParts.length > 0 ? textParts.join("\n") : null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      } as ChatCompletionMessageParam);
    }

    return messages;
  }

  private toChatCompletionRequestFromAnthropic(
    req: AnthropicMessagesRequest,
  ): OpenAIChatCompletionRequest {
    const extraBody =
      req.extra_body || req.top_k != null
        ? {
            ...(req.extra_body ?? {}),
            ...(req.top_k != null ? { topK: req.top_k } : {}),
          }
        : undefined;

    return {
      model: req.model || this.config.defaultModel || "",
      messages: this.convertAnthropicMessagesToOpenAI(req),
      tools: this.convertAnthropicToolsToOpenAI(req.tools),
      tool_choice: this.convertAnthropicToolChoice(req.tool_choice),
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      top_p: req.top_p,
      stop: req.stop_sequences,
      stream: req.stream,
      extra_body: extraBody,
    };
  }

  private mapOpenAIStopReasonToAnthropic(
    finishReason: string | undefined,
    toolCalls?: OpenAIToolCall[],
  ): AnthropicStopReason {
    if (toolCalls && toolCalls.length > 0) {
      return "tool_use";
    }

    const resolved = this.resolveNonStreamFinishReason(finishReason, toolCalls);

    switch (resolved) {
      case "length":
        return "max_tokens";
      case "tool_calls":
        return "tool_use";
      case "content_filter":
        return "stop_sequence";
      case "stop":
      default:
        return "end_turn";
    }
  }

  private toAnthropicUsageFromOpenAI(
    usage: OpenAIChatCompletionResponse["usage"] | undefined,
  ): AnthropicMessageResponse["usage"] {
    return {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    };
  }

  private toAnthropicUsageFromAISDK(
    usage:
      | {
          inputTokens?: number;
          outputTokens?: number;
        }
      | undefined,
  ): AnthropicMessageResponse["usage"] {
    return {
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
    };
  }

  private toAnthropicContentBlocks(
    messageContent: string | null,
    toolCalls: OpenAIToolCall[] | undefined,
  ): Array<AnthropicTextBlock | AnthropicToolUseBlock> {
    const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];

    if (messageContent && messageContent.length > 0) {
      content.push({ type: "text", text: messageContent });
    }

    for (const call of toolCalls ?? []) {
      if (call.type !== "function") continue;

      content.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: this.parseArgsObject(call.function.arguments),
      });
    }

    if (content.length === 0) {
      content.push({ type: "text", text: "" });
    }

    return content;
  }

  private mapChatToAnthropic(
    chatResponse: OpenAIChatCompletionResponse,
  ): AnthropicMessageResponse {
    const choice = chatResponse.choices[0];
    const toolCalls = this.coerceOpenAIToolCalls(choice?.message?.tool_calls);

    return {
      id: `msg_${Math.random().toString(36).slice(2, 15)}`,
      type: "message",
      role: "assistant",
      model: chatResponse.model,
      content: this.toAnthropicContentBlocks(
        choice?.message?.content ?? null,
        toolCalls,
      ),
      stop_reason: this.mapOpenAIStopReasonToAnthropic(
        choice?.finish_reason ?? undefined,
        toolCalls,
      ),
      stop_sequence: null,
      usage: this.toAnthropicUsageFromOpenAI(chatResponse.usage),
    };
  }

  private formatSSEEvent(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  private parseSSEDataChunk(chunk: string): OpenAIStreamChunk | null {
    if (!chunk.startsWith("data: ")) return null;
    const payload = chunk.slice("data: ".length).trim();
    if (!payload || payload === "[DONE]") return null;

    try {
      return JSON.parse(payload) as OpenAIStreamChunk;
    } catch {
      return null;
    }
  }

  private mergeStreamToolCalls(
    existing: OpenAIToolCall[],
    incoming: NonNullable<
      OpenAIStreamChunk["choices"]
    >[number]["delta"]["tool_calls"],
  ): OpenAIToolCall[] {
    if (!incoming || incoming.length === 0) return existing;

    const map = new Map(existing.map((call) => [call.id, call]));

    for (const item of incoming) {
      if (!item.id || item.type !== "function" || !item.function) continue;

      map.set(item.id, {
        id: item.id,
        type: "function",
        function: {
          name: item.function.name ?? "",
          arguments: item.function.arguments ?? "{}",
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
    return path === CHAT_COMPLETIONS_PATH && method === "POST";
  }

  private isResponsesRequest(path: string, method: string): boolean {
    return path === RESPONSES_PATH && method === "POST";
  }

  private isAnthropicMessagesRequest(path: string, method: string): boolean {
    return path === MESSAGES_PATH && method === "POST";
  }

  private isModelsListRequest(path: string, method: string): boolean {
    return path === MODELS_PATH && method === "GET";
  }

  private isSupportedRequest(path: string, method: string): boolean {
    return (
      this.isChatCompletionsRequest(path, method) ||
      this.isResponsesRequest(path, method) ||
      this.isAnthropicMessagesRequest(path, method) ||
      this.isModelsListRequest(path, method)
    );
  }

  private async resolveConfiguredModelIds(): Promise<string[]> {
    if (Array.isArray(this.config.listModels)) {
      return this.config.listModels.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
    }

    if (typeof this.config.listModels === "function") {
      const resolved = await this.config.listModels();
      return resolved.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
    }

    if (this.config.runtimeFactory) {
      return [this.config.defaultModel ?? "default"];
    }

    if (!this.config.defaultACPConfig) {
      throw new Error(
        "defaultACPConfig is required for GET /v1/models (needs ACP initSession)",
      );
    }

    const provider = createACPProvider(this.config.defaultACPConfig);

    try {
      const sessionInfo = await provider.initSession();
      return [
        ...(sessionInfo.models?.availableModels ?? []).map(
          (model) => model.modelId,
        ),
        sessionInfo.models?.currentModelId,
        this.config.defaultModel,
        "default",
      ].filter((id): id is string => Boolean(id));
    } finally {
      provider.cleanup();
    }
  }

  private async handleModelsList(): Promise<OpenAIModelListResponse> {
    const created = Math.floor(Date.now() / 1000);
    const modelIds = Array.from(
      new Set(await this.resolveConfiguredModelIds()),
    );

    return {
      object: "list",
      data: modelIds.map((id) => ({
        id,
        object: "model",
        created,
        owned_by: "acp2openai",
      })),
    };
  }

  private createSSEReadableStream(
    stream: AsyncIterable<string>,
  ): ReadableStream<Uint8Array> {
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
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private parseArgsObject(value: unknown): Record<string, unknown> {
    if (this.isRecord(value)) return value;
    if (typeof value !== "string") return {};

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
  ):
    | { toolCallId: string; toolName: string; input: Record<string, unknown> }
    | undefined {
    if (!this.isACPWrappedToolName(wrapperName)) return undefined;

    const nestedToolName =
      (typeof payload.toolName === "string" && payload.toolName) ||
      (typeof payload.name === "string" && payload.name) ||
      "";

    if (!nestedToolName) return undefined;

    const nestedArgs = this.isRecord(payload.args)
      ? payload.args
      : this.isRecord(payload.arguments)
        ? payload.arguments
        : {};

    const nestedToolCallId =
      typeof payload.toolCallId === "string" && payload.toolCallId
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
      typeof tc?.toolCallId === "string" && tc.toolCallId
        ? tc.toolCallId
        : `call_${Math.random().toString(36).slice(2, 10)}`;

    const rawToolName = typeof tc?.toolName === "string" ? tc.toolName : "";
    const rawInput = this.isRecord(tc?.input)
      ? tc.input
      : this.isRecord(tc?.args)
        ? tc.args
        : {};

    const unwrapped = this.unwrapACPToolCall(
      rawToolName,
      rawInput,
      fallbackToolCallId,
    );
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
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("\n");
    }
    return "";
  }

  /**
   * Convert OpenAI image_url parts to AI SDK FilePart format.
   * ACP provider expects { type: 'file', mediaType, data } (LanguageModelV3FilePart).
   */
  private toImageFileParts(content: any): any[] {
    if (!Array.isArray(content)) return [];
    return content
      .filter((part: any) => part.type === "image_url" && part.image_url?.url)
      .map((part: any) => {
        const url: string = part.image_url.url;
        if (url.startsWith("data:")) {
          const [meta, data] = url.split(",");
          const mediaType = meta.replace("data:", "").replace(";base64", "");
          return { type: "file" as const, mediaType, data };
        }
        return { type: "file" as const, mediaType: "image/jpeg", data: url };
      });
  }

  private normalizeRole(
    role: ChatCompletionMessageParam["role"],
  ): "system" | "user" | "assistant" {
    if (role === "system" || role === "developer") return "system";
    if (role === "user") return "user";
    return "assistant";
  }

  private convertToolResultMessage(msg: any): ModelMessage {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);

    // Try to parse as JSON for structured output
    let output: any;
    try {
      const parsed = JSON.parse(content);
      output = { type: "json", value: parsed };
    } catch {
      output = { type: "text", value: content };
    }

    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: msg.tool_call_id,
          toolName: msg.name ?? "tool",
          output,
        },
      ],
    };
  }

  private convertAssistantToolCallMessage(msg: any): ModelMessage {
    const textContent = typeof msg.content === "string" ? msg.content : "";

    return {
      role: "assistant",
      content: [
        ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
        ...msg.tool_calls
          .filter((tc: any) => tc.type === "function")
          .map((tc: any) => {
            const parsedArgs = this.parseArgsObject(tc.function.arguments);
            const fallbackToolCallId =
              typeof tc.id === "string" && tc.id
                ? tc.id
                : `call_${Math.random().toString(36).slice(2, 10)}`;
            const unwrapped = this.unwrapACPToolCall(
              tc.function.name,
              parsedArgs,
              fallbackToolCallId,
            );

            return {
              type: "tool-call" as const,
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
  private convertMessages(
    messages: ChatCompletionMessageParam[],
  ): ModelMessage[] {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        return this.convertToolResultMessage(msg);
      }

      if (msg.role === "assistant" && msg.tool_calls) {
        return this.convertAssistantToolCallMessage(msg);
      }

      const textContent = this.stringifyContent(msg.content);
      const imageParts =
        msg.role === "user" ? this.toImageFileParts(msg.content) : [];

      if (imageParts.length > 0) {
        const parts: any[] = [];
        if (textContent) parts.push({ type: "text", text: textContent });
        parts.push(...imageParts);
        return { role: "user", content: parts };
      }

      return {
        role: this.normalizeRole(msg.role),
        content: textContent,
      };
    }) as ModelMessage[];
  }

  /**
   * Convert OpenAI tools to AI SDK tools format
   */
  private convertTools(
    openaiTools?: OpenAITool[],
  ): Record<string, any> | undefined {
    if (!openaiTools || openaiTools.length === 0) return undefined;

    const tools: Record<string, any> = {};

    for (const openaiTool of openaiTools) {
      if (openaiTool.type !== "function") continue;

      const fn = openaiTool.function;
      // Use the original JSON Schema parameters if available, otherwise allow any object
      const inputSchema = fn.parameters
        ? jsonSchema(fn.parameters as any)
        : z.object({}).passthrough();

      tools[fn.name] = tool({
        description: fn.description || `Function: ${fn.name}`,
        inputSchema,
      });
    }

    if (Object.keys(tools).length === 0) return undefined;

    return acpTools(tools as Record<string, any>);
  }

  /**
   * Convert OpenAI tool_choice to AI SDK toolChoice format.
   *
   * ACP currently honors object-form forced tool choice reliably, but string-form
   * `required` may be ignored by downstream providers. When OpenAI sends
   * `tool_choice: "required"` with exactly one available tool, we can preserve
   * the expected behavior by converting it to an explicit forced tool choice.
   */
  private convertToolChoice(
    toolChoice?: ChatCompletionToolChoiceOption,
    openaiTools?: OpenAITool[],
  ):
    | "auto"
    | "none"
    | "required"
    | { type: "tool"; toolName: string }
    | undefined {
    if (!toolChoice) return undefined;

    if (toolChoice === "required") {
      const onlyAllowedToolName = this.getOnlyAllowedToolName(openaiTools);
      if (onlyAllowedToolName) {
        return {
          type: "tool",
          toolName: onlyAllowedToolName,
        };
      }
      return toolChoice;
    }

    if (toolChoice === "none" || toolChoice === "auto") {
      return toolChoice;
    }

    if (typeof toolChoice === "object" && toolChoice.type === "function") {
      return {
        type: "tool",
        toolName: toolChoice.function.name,
      };
    }

    return undefined;
  }

  private getAllowedToolNames(openaiTools?: OpenAITool[]): Set<string> {
    if (!openaiTools || openaiTools.length === 0) return new Set();

    return new Set(
      openaiTools
        .filter((t) => t.type === "function")
        .map((t) => t.function.name),
    );
  }

  private getOnlyAllowedToolName(
    openaiTools?: OpenAITool[],
  ): string | undefined {
    const allowedToolNames = Array.from(this.getAllowedToolNames(openaiTools));
    return allowedToolNames.length === 1 ? allowedToolNames[0] : undefined;
  }

  private getForcedToolName(
    toolChoice?: ChatCompletionToolChoiceOption,
    openaiTools?: OpenAITool[],
  ): string | undefined {
    if (toolChoice === "required") {
      return this.getOnlyAllowedToolName(openaiTools);
    }
    if (!toolChoice || typeof toolChoice !== "object") return undefined;
    if (toolChoice.type !== "function") return undefined;
    return toolChoice.function.name;
  }

  private sanitizeToolCalls(
    toolCalls: any[] | undefined,
    toolSelection: ToolSelectionContext,
  ): any[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    const normalized = toolCalls
      .map((tc) => this.normalizeToolCall(tc))
      .filter((tc): tc is any => Boolean(tc));

    const filtered = normalized.filter((tc) => {
      const name = String(tc?.toolName ?? "");
      if (!name) return false;
      if (
        toolSelection.allowedToolNames.size > 0 &&
        !toolSelection.allowedToolNames.has(name)
      )
        return false;
      if (toolSelection.forcedToolName && name !== toolSelection.forcedToolName)
        return false;
      return true;
    });

    return filtered.length > 0 ? filtered : undefined;
  }

  private coerceForcedToolCall(
    rawToolCalls: any[] | undefined,
    toolSelection: ToolSelectionContext,
  ): any[] | undefined {
    if (!toolSelection.forcedToolName) return undefined;
    if (!rawToolCalls || rawToolCalls.length === 0) return undefined;

    const first = this.normalizeToolCall(rawToolCalls[0]);
    if (!first) return undefined;

    return [
      {
        ...first,
        toolName: toolSelection.forcedToolName,
      },
    ];
  }

  private pickToolCalls(
    rawToolCalls: any[] | undefined,
    toolSelection: ToolSelectionContext,
  ): any[] | undefined {
    return (
      this.sanitizeToolCalls(rawToolCalls, toolSelection) ??
      this.coerceForcedToolCall(rawToolCalls, toolSelection)
    );
  }

  private resolveNonStreamFinishReason(
    finishReason: string | undefined,
    toolCalls: OpenAIToolCall[] | undefined,
  ): OpenAIFinishReason {
    if (toolCalls && toolCalls.length > 0) {
      return "tool_calls";
    }

    const mapped = this.mapFinishReason(finishReason);
    if (mapped === "tool_calls") {
      return "stop";
    }
    return mapped;
  }

  private resolveStreamFinishReason(
    finishReason: string | undefined,
    toolCalls: any[] | undefined,
  ): OpenAIFinishReason | null {
    if (toolCalls && toolCalls.length > 0) {
      return "tool_calls";
    }

    const mapped = this.mapStreamFinishReason(finishReason);
    if (mapped === "tool_calls") {
      return "stop";
    }
    return mapped;
  }

  private mapFinishReason(
    finishReason: string | undefined,
  ): OpenAIFinishReason {
    if (finishReason === "tool-calls") return "tool_calls";
    if (finishReason === "stop") return "stop";
    if (finishReason === "length") return "length";
    return "stop";
  }

  private mapStreamFinishReason(
    finishReason: string | undefined,
  ): OpenAIFinishReason | null {
    if (finishReason === "tool-calls") return "tool_calls";
    if (finishReason === "stop") return "stop";
    if (finishReason === "length") return "length";
    return null;
  }

  private toOpenAIToolCalls(
    toolCalls: any[] | undefined,
  ): OpenAIToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    const normalized = toolCalls
      .map((tc) => this.normalizeToolCall(tc))
      .filter((tc): tc is any => Boolean(tc));

    if (normalized.length === 0) return undefined;

    return normalized.map((tc) => ({
      id: tc.toolCallId,
      type: "function" as const,
      function: {
        name: tc.toolName,
        arguments: JSON.stringify(tc.input),
      },
    }));
  }

  private async cleanupRuntime(runtime: RuntimeContext): Promise<void> {
    await runtime.cleanup?.();
  }

  private async resolveMaybePromise<T>(
    value: T | Promise<T> | PromiseLike<T>,
  ): Promise<T> {
    return await value;
  }

  private toChatCompletionResponse(
    invocation: PreparedChatInvocation,
    result: ACP2OpenAIFinalResult,
  ): OpenAIChatCompletionResponse {
    const id = `chatcmpl-${Math.random().toString(36).slice(2, 15)}`;
    const created = Math.floor(Date.now() / 1000);
    const openAIToolCalls = this.toOpenAIToolCalls(result.toolCalls);

    return {
      id,
      object: "chat.completion",
      created,
      model: invocation.runtime.modelName,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: result.text || null,
            refusal: null,
            tool_calls: openAIToolCalls,
          },
          finish_reason: this.resolveNonStreamFinishReason(
            result.finishReason,
            openAIToolCalls,
          ),
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

  private async runPreparedChatCompletion(
    invocation: PreparedChatInvocation,
  ): Promise<OpenAIChatCompletionResponse> {
    // Always use streamText path so ACP provider receives tools via doStream
    // (doGenerate does not forward tools to the ACP session).
    const { result } = await this.collectPreparedStreamResult(invocation);
    return this.toChatCompletionResponse(invocation, result);
  }

  private async collectPreparedStreamResult(
    invocation: PreparedChatInvocation,
  ): Promise<{
    result: ACP2OpenAIFinalResult;
    textDeltas: string[];
    overridden: boolean;
  }> {
    const result = streamText(invocation.params);

    try {
      const textDeltas: string[] = [];

      for await (const chunk of result.textStream) {
        const mutated = await this.mutateStreamResult(invocation, {
          eventType: "text-delta",
          textDelta: chunk,
        });
        const textDelta = mutated.textDelta ?? "";
        if (textDelta.length === 0) continue;
        textDeltas.push(textDelta);
      }

      const awaited = result;
      const rawToolCalls = await this.resolveMaybePromise(awaited.toolCalls);
      let selectedToolCalls = this.pickToolCalls(
        rawToolCalls,
        invocation.toolSelection,
      );
      const mutatedToolCalls = await this.mutateStreamResult(invocation, {
        eventType: "tool-calls",
        toolCalls: selectedToolCalls,
      });
      selectedToolCalls = mutatedToolCalls.toolCalls;

      const finishReasonValue = await this.resolveMaybePromise(
        awaited.finishReason,
      );
      const mutatedFinish = await this.mutateStreamResult(invocation, {
        eventType: "finish",
        finishReason: finishReasonValue,
      });
      const usage = await this.resolveMaybePromise(
        (awaited as { usage?: any }).usage,
      );

      return {
        textDeltas,
        ...(await this.applyResultHandlers(invocation, {
          text: textDeltas.length > 0 ? textDeltas.join("") : null,
          toolCalls: selectedToolCalls,
          finishReason: mutatedFinish.finishReason,
          usage: {
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
          },
        })),
      };
    } catch (err: any) {
      // If the model produced no output (e.g. during a PTC resume with dummy
      // messages), still let result-handler plugins run so they can override.
      if (
        err?.name === "AI_NoOutputGeneratedError" ||
        err?.constructor?.name === "NoOutputGeneratedError"
      ) {
        const emptyResult: ACP2OpenAIFinalResult = {
          text: null,
          toolCalls: [],
          finishReason: "other",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
        const handled = await this.applyResultHandlers(invocation, emptyResult);
        if (handled.overridden) {
          return { textDeltas: [], ...handled };
        }
      }
      throw err;
    } finally {
      await this.cleanupRuntime(invocation.runtime);
    }
  }

  private async *streamOpenAIFromFinalResult(
    invocation: PreparedChatInvocation,
    result: ACP2OpenAIFinalResult,
    textDeltas?: string[],
  ): AsyncIterable<string> {
    const id = `chatcmpl-${Math.random().toString(36).slice(2, 15)}`;
    const created = Math.floor(Date.now() / 1000);
    let isFirst = true;

    const deltas =
      textDeltas && textDeltas.length > 0
        ? textDeltas
        : typeof result.text === "string" && result.text.length > 0
          ? [result.text]
          : [];

    for (const textDelta of deltas) {
      const streamChunk: OpenAIStreamChunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model: invocation.runtime.modelName,
        choices: [
          {
            index: 0,
            delta: isFirst
              ? { role: "assistant", content: textDelta }
              : { content: textDelta },
            finish_reason: null,
          },
        ],
      };
      isFirst = false;
      yield `data: ${JSON.stringify(streamChunk)}\n\n`;
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      for (let i = 0; i < result.toolCalls.length; i++) {
        const tc = result.toolCalls[i];
        const toolCallChunk: OpenAIStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: invocation.runtime.modelName,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: i,
                    id: tc.toolCallId,
                    type: "function",
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
      object: "chat.completion.chunk",
      created,
      model: invocation.runtime.modelName,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: this.resolveStreamFinishReason(
            result.finishReason,
            result.toolCalls,
          ),
        },
      ],
    };

    yield `data: ${JSON.stringify(finalChunk)}\n\n`;
    yield "data: [DONE]\n\n";
  }

  private async *runPreparedChatCompletionStream(
    invocation: PreparedChatInvocation,
  ): AsyncIterable<string> {
    if (this.hasResultHandlers()) {
      const buffered = await this.collectPreparedStreamResult(invocation);
      yield* this.streamOpenAIFromFinalResult(
        invocation,
        buffered.result,
        buffered.overridden ? undefined : buffered.textDeltas,
      );
      return;
    }

    const result = streamText(invocation.params);

    try {
      const id = `chatcmpl-${Math.random().toString(36).slice(2, 15)}`;
      const created = Math.floor(Date.now() / 1000);

      let isFirst = true;

      for await (const chunk of result.textStream) {
        const mutated = await this.mutateStreamResult(invocation, {
          eventType: "text-delta",
          textDelta: chunk,
        });
        const textDelta = mutated.textDelta ?? "";
        if (textDelta.length === 0) continue;

        const streamChunk: OpenAIStreamChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model: invocation.runtime.modelName,
          choices: [
            {
              index: 0,
              delta: isFirst
                ? { role: "assistant", content: textDelta }
                : { content: textDelta },
              finish_reason: null,
            },
          ],
        };
        isFirst = false;
        yield `data: ${JSON.stringify(streamChunk)}\n\n`;
      }

      const awaited = result;
      const rawToolCalls = await this.resolveMaybePromise(awaited.toolCalls);
      let selectedToolCalls = this.pickToolCalls(
        rawToolCalls,
        invocation.toolSelection,
      );
      const mutatedToolCalls = await this.mutateStreamResult(invocation, {
        eventType: "tool-calls",
        toolCalls: selectedToolCalls,
      });
      selectedToolCalls = mutatedToolCalls.toolCalls;

      if (selectedToolCalls && selectedToolCalls.length > 0) {
        for (let i = 0; i < selectedToolCalls.length; i++) {
          const tc = selectedToolCalls[i];
          const toolCallChunk: OpenAIStreamChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model: invocation.runtime.modelName,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: i,
                      id: tc.toolCallId,
                      type: "function",
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

      const finishReasonValue = await this.resolveMaybePromise(
        awaited.finishReason,
      );
      const mutatedFinish = await this.mutateStreamResult(invocation, {
        eventType: "finish",
        finishReason: finishReasonValue,
      });

      const finalChunk: OpenAIStreamChunk = {
        id,
        object: "chat.completion.chunk",
        created,
        model: invocation.runtime.modelName,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: this.resolveStreamFinishReason(
              mutatedFinish.finishReason,
              selectedToolCalls,
            ),
          },
        ],
      };

      yield `data: ${JSON.stringify(finalChunk)}\n\n`;
      yield "data: [DONE]\n\n";
    } finally {
      await this.cleanupRuntime(invocation.runtime);
    }
  }

  /**
   * Handle non-streaming chat completion
   */
  async handleChatCompletion(
    req: OpenAIChatCompletionRequest,
  ): Promise<OpenAIChatCompletionResponse> {
    const invocation = await this.prepareChatInvocation({
      endpoint: "chat.completions",
      callType: "generateText",
      originalRequest: req,
      request: req,
    });

    return this.runPreparedChatCompletion(invocation);
  }

  /**
   * Handle streaming chat completion
   * Returns an async iterable of SSE-formatted strings
   */
  async *handleChatCompletionStream(
    req: OpenAIChatCompletionRequest,
  ): AsyncIterable<string> {
    const invocation = await this.prepareChatInvocation({
      endpoint: "chat.completions",
      callType: "streamText",
      originalRequest: req,
      request: req,
    });

    yield* this.runPreparedChatCompletionStream(invocation);
  }

  async handleResponses(
    req: OpenAIResponsesRequest,
  ): Promise<OpenAIResponsesResponse> {
    const chatReq = this.toChatCompletionRequestFromResponses(req);
    const invocation = await this.prepareChatInvocation({
      endpoint: "responses",
      callType: "generateText",
      originalRequest: req,
      request: chatReq,
    });
    const chatResponse = await this.runPreparedChatCompletion(invocation);
    return this.mapChatToResponses(chatResponse);
  }

  async *handleResponsesStream(
    req: OpenAIResponsesRequest,
  ): AsyncIterable<string> {
    const chatReq = this.toChatCompletionRequestFromResponses({
      ...req,
      stream: true,
    });
    const invocation = await this.prepareChatInvocation({
      endpoint: "responses",
      callType: "streamText",
      originalRequest: req,
      request: chatReq,
    });
    const responseId = `resp_${Math.random().toString(36).slice(2, 15)}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const modelName = invocation.runtime.modelName || "default";
    const messageId = `msg_${Math.random().toString(36).slice(2, 15)}`;

    yield `event: response.created\ndata: ${JSON.stringify({
      type: "response.created",
      response: {
        id: responseId,
        object: "response",
        created_at: createdAt,
        status: "in_progress",
        model: modelName,
        output: [],
      },
    })}\n\n`;

    let fullText = "";
    let toolCalls: OpenAIToolCall[] = [];

    for await (const chunk of this.runPreparedChatCompletionStream(
      invocation,
    )) {
      const parsed = this.parseSSEDataChunk(chunk);
      if (!parsed) continue;

      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      if (typeof delta?.content === "string" && delta.content.length > 0) {
        fullText += delta.content;
        yield `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: "response.output_text.delta",
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
      object: "chat.completion",
      created: createdAt,
      model: modelName,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: fullText || null,
            refusal: null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
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

    const finalResponse = this.mapChatToResponses(
      finalChatResponse,
      responseId,
    );

    yield `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: finalResponse,
    })}\n\n`;
    yield "data: [DONE]\n\n";
  }

  async handleAnthropicMessages(
    req: AnthropicMessagesRequest,
  ): Promise<AnthropicMessageResponse> {
    const chatReq = this.toChatCompletionRequestFromAnthropic(req);
    const invocation = await this.prepareChatInvocation({
      endpoint: "messages",
      callType: "generateText",
      originalRequest: req,
      request: chatReq,
    });
    const chatResponse = await this.runPreparedChatCompletion(invocation);
    return this.mapChatToAnthropic(chatResponse);
  }

  private async *streamAnthropicFromFinalResult(
    modelName: string,
    result: ACP2OpenAIFinalResult,
    textDeltas?: string[],
  ): AsyncIterable<string> {
    const messageId = `msg_${Math.random().toString(36).slice(2, 15)}`;
    const textBlockIndex = 0;
    let hasTextBlock = false;
    let nextBlockIndex = 1;

    yield this.formatSSEEvent("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model: modelName,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    });

    const deltas =
      textDeltas && textDeltas.length > 0
        ? textDeltas
        : typeof result.text === "string" && result.text.length > 0
          ? [result.text]
          : [];

    for (const textDelta of deltas) {
      if (!hasTextBlock) {
        hasTextBlock = true;
        yield this.formatSSEEvent("content_block_start", {
          type: "content_block_start",
          index: textBlockIndex,
          content_block: {
            type: "text",
            text: "",
          },
        });
      }

      yield this.formatSSEEvent("content_block_delta", {
        type: "content_block_delta",
        index: textBlockIndex,
        delta: {
          type: "text_delta",
          text: textDelta,
        },
      });
    }

    if (hasTextBlock) {
      yield this.formatSSEEvent("content_block_stop", {
        type: "content_block_stop",
        index: textBlockIndex,
      });
    }

    const openAIToolCalls = this.toOpenAIToolCalls(result.toolCalls);

    for (const toolCall of result.toolCalls ?? []) {
      const blockIndex = nextBlockIndex++;
      yield this.formatSSEEvent("content_block_start", {
        type: "content_block_start",
        index: blockIndex,
        content_block: {
          type: "tool_use",
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          input: {},
        },
      });
      yield this.formatSSEEvent("content_block_delta", {
        type: "content_block_delta",
        index: blockIndex,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(toolCall.input ?? {}),
        },
      });
      yield this.formatSSEEvent("content_block_stop", {
        type: "content_block_stop",
        index: blockIndex,
      });
    }

    yield this.formatSSEEvent("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: this.mapOpenAIStopReasonToAnthropic(
          result.finishReason,
          openAIToolCalls,
        ),
        stop_sequence: null,
      },
      usage: this.toAnthropicUsageFromAISDK(result.usage),
    });
    yield this.formatSSEEvent("message_stop", {
      type: "message_stop",
    });
  }

  async *handleAnthropicMessagesStream(
    req: AnthropicMessagesRequest,
  ): AsyncIterable<string> {
    const chatReq = this.toChatCompletionRequestFromAnthropic({
      ...req,
      stream: true,
    });
    const invocation = await this.prepareChatInvocation({
      endpoint: "messages",
      callType: "streamText",
      originalRequest: req,
      request: chatReq,
    });
    const modelName =
      invocation.runtime.modelName || chatReq.model || "default";

    if (this.hasResultHandlers()) {
      const buffered = await this.collectPreparedStreamResult(invocation);
      yield* this.streamAnthropicFromFinalResult(
        modelName,
        buffered.result,
        buffered.overridden ? undefined : buffered.textDeltas,
      );
      return;
    }

    const result = streamText(invocation.params);
    const messageId = `msg_${Math.random().toString(36).slice(2, 15)}`;
    const textBlockIndex = 0;
    let hasTextBlock = false;
    let nextBlockIndex = 1;

    yield this.formatSSEEvent("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model: modelName,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    });

    try {
      for await (const chunk of result.textStream) {
        const mutated = await this.mutateStreamResult(invocation, {
          eventType: "text-delta",
          textDelta: chunk,
        });
        const textDelta = mutated.textDelta ?? "";
        if (textDelta.length === 0) continue;

        if (!hasTextBlock) {
          hasTextBlock = true;
          yield this.formatSSEEvent("content_block_start", {
            type: "content_block_start",
            index: textBlockIndex,
            content_block: {
              type: "text",
              text: "",
            },
          });
        }

        yield this.formatSSEEvent("content_block_delta", {
          type: "content_block_delta",
          index: textBlockIndex,
          delta: {
            type: "text_delta",
            text: textDelta,
          },
        });
      }

      if (hasTextBlock) {
        yield this.formatSSEEvent("content_block_stop", {
          type: "content_block_stop",
          index: textBlockIndex,
        });
      }

      const awaited = result;
      const rawToolCalls = await this.resolveMaybePromise(awaited.toolCalls);
      let selectedToolCalls = this.pickToolCalls(
        rawToolCalls,
        invocation.toolSelection,
      );
      const mutatedToolCalls = await this.mutateStreamResult(invocation, {
        eventType: "tool-calls",
        toolCalls: selectedToolCalls,
      });
      selectedToolCalls = mutatedToolCalls.toolCalls;
      const openAIToolCalls = this.toOpenAIToolCalls(selectedToolCalls);

      for (const toolCall of selectedToolCalls ?? []) {
        const blockIndex = nextBlockIndex++;
        yield this.formatSSEEvent("content_block_start", {
          type: "content_block_start",
          index: blockIndex,
          content_block: {
            type: "tool_use",
            id: toolCall.toolCallId,
            name: toolCall.toolName,
            input: {},
          },
        });
        yield this.formatSSEEvent("content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(toolCall.input ?? {}),
          },
        });
        yield this.formatSSEEvent("content_block_stop", {
          type: "content_block_stop",
          index: blockIndex,
        });
      }

      const finishReasonValue = await this.resolveMaybePromise(
        awaited.finishReason,
      );
      const mutatedFinish = await this.mutateStreamResult(invocation, {
        eventType: "finish",
        finishReason: finishReasonValue,
      });
      const usage = await this.resolveMaybePromise(
        (awaited as { usage?: any }).usage,
      );

      yield this.formatSSEEvent("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: this.mapOpenAIStopReasonToAnthropic(
            mutatedFinish.finishReason,
            openAIToolCalls,
          ),
          stop_sequence: null,
        },
        usage: this.toAnthropicUsageFromAISDK(usage),
      });
      yield this.formatSSEEvent("message_stop", {
        type: "message_stop",
      });
    } finally {
      await this.cleanupRuntime(invocation.runtime);
    }
  }

  /**
   * Framework-agnostic handler for standard Request/Response
   * (Works with Hono, Cloudflare Workers, etc.)
   */
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!this.isSupportedRequest(url.pathname, request.method)) {
      return new Response("Not Found", { status: 404 });
    }

    if (this.isModelsListRequest(url.pathname, request.method)) {
      const response = await this.handleModelsList();
      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (this.isResponsesRequest(url.pathname, request.method)) {
      const body = (await request.json()) as OpenAIResponsesRequest;

      if (body.stream) {
        return new Response(
          this.createSSEReadableStream(this.handleResponsesStream(body)),
          {
            headers: SSE_HEADERS,
          },
        );
      }

      const response = await this.handleResponses(body);
      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (this.isAnthropicMessagesRequest(url.pathname, request.method)) {
      const body = (await request.json()) as AnthropicMessagesRequest;

      if (body.stream) {
        return new Response(
          this.createSSEReadableStream(
            this.handleAnthropicMessagesStream(body),
          ),
          {
            headers: SSE_HEADERS,
          },
        );
      }

      const response = await this.handleAnthropicMessages(body);
      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = (await request.json()) as OpenAIChatCompletionRequest;

    if (body.stream) {
      return new Response(
        this.createSSEReadableStream(this.handleChatCompletionStream(body)),
        {
          headers: SSE_HEADERS,
        },
      );
    }

    const response = await this.handleChatCompletion(body);
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Express/Node.js middleware-style handler
   */
  expressHandler() {
    return async (req: any, res: any) => {
      if (!this.isSupportedRequest(req.path, req.method)) {
        res.status(404).json({ error: "Not Found" });
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
      const isAnthropic = this.isAnthropicMessagesRequest(req.path, req.method);
      const body = req.body as
        | OpenAIChatCompletionRequest
        | OpenAIResponsesRequest
        | AnthropicMessagesRequest;

      if (body.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        try {
          if (isResponses) {
            for await (const chunk of this.handleResponsesStream(
              body as OpenAIResponsesRequest,
            )) {
              res.write(chunk);
            }
          } else if (isAnthropic) {
            for await (const chunk of this.handleAnthropicMessagesStream(
              body as AnthropicMessagesRequest,
            )) {
              res.write(chunk);
            }
          } else {
            for await (const chunk of this.handleChatCompletionStream(
              body as OpenAIChatCompletionRequest,
            )) {
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
          : isAnthropic
            ? await this.handleAnthropicMessages(
                body as AnthropicMessagesRequest,
              )
            : await this.handleChatCompletion(
                body as OpenAIChatCompletionRequest,
              );
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
        return c.json({ error: "Not Found" }, 404);
      }

      if (this.isModelsListRequest(c.req.path, c.req.method)) {
        return c.json(await this.handleModelsList());
      }

      const isResponses = this.isResponsesRequest(c.req.path, c.req.method);
      const isAnthropic = this.isAnthropicMessagesRequest(
        c.req.path,
        c.req.method,
      );
      const body = (await c.req.json()) as
        | OpenAIChatCompletionRequest
        | OpenAIResponsesRequest
        | AnthropicMessagesRequest;

      if (body.stream) {
        return c.newResponse(
          this.createSSEReadableStream(
            isResponses
              ? this.handleResponsesStream(body as OpenAIResponsesRequest)
              : isAnthropic
                ? this.handleAnthropicMessagesStream(
                    body as AnthropicMessagesRequest,
                  )
                : this.handleChatCompletionStream(
                    body as OpenAIChatCompletionRequest,
                  ),
          ),
          {
            headers: SSE_HEADERS,
          },
        );
      }

      const response = isResponses
        ? await this.handleResponses(body as OpenAIResponsesRequest)
        : isAnthropic
          ? await this.handleAnthropicMessages(body as AnthropicMessagesRequest)
          : await this.handleChatCompletion(
              body as OpenAIChatCompletionRequest,
            );
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

export {
  buildCodeExecutionSystemPrompt,
  createJavaScriptCodeExecutionPlugin,
  createJavaScriptProgrammaticToolLoopPlugin,
  createProgrammaticToolLoopPlugin,
} from "./programmatic-tool-loop-plugin.js";
export type {
  CodeExecutionPendingToolCall,
  CodeExecutionSession,
  CodeExecutionSessionState,
  JavaScriptCodeExecutionPluginConfig,
  JavaScriptProgrammaticExecutionResult,
  JavaScriptProgrammaticToolCallRecord,
  JavaScriptProgrammaticToolHandlerContext,
  ProgrammaticToolLoopExecuteContext,
  ProgrammaticToolLoopFinalResultStep,
  ProgrammaticToolLoopMatchContext,
  ProgrammaticToolLoopPluginConfig,
  ProgrammaticToolLoopStepResult,
  ProgrammaticToolLoopToolCall,
  ProgrammaticToolLoopToolResultStep,
} from "./programmatic-tool-loop-plugin.js";
