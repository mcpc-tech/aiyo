/**
 * Shared type definitions for the acp2openai-compatible core adapter.
 * All public types are defined here and re-exported from index.ts.
 */
import { Output, type ModelMessage } from "ai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import type {
  ToolChoiceAuto,
  ToolChoiceAny,
  ToolChoiceTool,
  ToolChoiceNone,
  MessageCreateParams,
  TextBlock,
  ToolUseBlock,
  ToolResultBlockParam,
  ThinkingBlock,
  Message,
  StopReason,
} from "@anthropic-ai/sdk/resources/messages";

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Chat Completions — type aliases
// @see https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
// ─────────────────────────────────────────────────────────────────────────────

export type OpenAIMessage = ChatCompletionMessageParam;
export type OpenAITool = ChatCompletionTool;
export type OpenAIToolCall = ChatCompletionMessageFunctionToolCall;

export interface OpenAIExtraBody {
  topK?: number;
  seed?: number;
  [key: string]: unknown;
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

export type ACP2ToolTransformer = (
  tools: Record<string, any> | undefined,
  context: ACP2RuntimeFactoryContext,
) => Record<string, any> | undefined;

export type ACP2ToolCallNormalizer = (toolCall: RawToolCall) => RawToolCall | undefined;

export type ACP2ListModelsResolver = (() => string[] | Promise<string[]>) | string[];

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

export interface RawToolCall {
  toolCallId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ACP2OpenAIFinalResult {
  text?: string | null;
  toolCalls?: RawToolCall[];
  finishReason?: string;
  usage?: ACP2OpenAIUsage;
  /** @internal Used by the PTC plugin to smuggle the active execution session ID. */
  _executionId?: string;
}

export interface ACP2OpenAIRunModelOptions {
  callType?: ACP2OpenAICallType;
  skipPlugins?: boolean;
}

export interface ACP2OpenAIResultHandlerContext {
  endpoint: ACP2OpenAIEndpoint;
  callType: ACP2OpenAICallType;
  stream: boolean;
  originalRequest: OpenAIChatCompletionRequest | OpenAIResponsesRequest | AnthropicMessagesRequest;
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
  originalRequest: OpenAIChatCompletionRequest | OpenAIResponsesRequest | AnthropicMessagesRequest;
  request: OpenAIChatCompletionRequest;
  params?: ACP2OpenAIModelCallParams;
  result?: ACP2OpenAIResultMutation;
}

export type ACP2OpenAIMiddleware = (context: ACP2OpenAIMiddlewareContext) => void | Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Chat Completions request/response types
// @see https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenAIChatCompletionRequest extends Omit<
  ChatCompletionCreateParams,
  "extra_body"
> {
  extra_body?: OpenAIExtraBody;
}

export type OpenAIChatCompletionResponse = ChatCompletion;
export type OpenAIStreamChunk = ChatCompletionChunk;

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

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Responses API types
// @see https://developers.openai.com/api/reference/resources/responses/methods/create
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenAIResponsesContentPart {
  type?: string;
  text?: string;
  input_text?: string;
  output_text?: string;
  image_url?: string;
  file_id?: string;
  file_url?: string;
  filename?: string;
}

export interface OpenAIResponsesInputMessage {
  type?: string;
  role?: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | OpenAIResponsesContentPart[];
  output?: string | OpenAIResponsesContentPart[];
  tool_call_id?: string;
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
  status?: "in_progress" | "completed" | "incomplete";
}

export interface OpenAIResponsesFunctionCallItem {
  type: "function_call";
  call_id?: string;
  id?: string;
  name: string;
  arguments: string;
  role?: "assistant";
  status?: "in_progress" | "completed" | "incomplete";
}

export interface OpenAIResponsesFunctionCallOutputItem {
  type: "function_call_output";
  call_id?: string;
  tool_call_id?: string;
  id?: string;
  output?: string | OpenAIResponsesContentPart[];
  content?: string | OpenAIResponsesContentPart[];
  status?: "in_progress" | "completed" | "incomplete";
}

export type OpenAIResponsesInputItem =
  | OpenAIResponsesInputMessage
  | OpenAIResponsesFunctionCallItem
  | OpenAIResponsesFunctionCallOutputItem;

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

export type OpenAIResponsesTextFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      name?: string;
      description?: string;
      schema?: Record<string, unknown>;
      strict?: boolean;
    };

export interface OpenAIResponsesTextConfig {
  format?: OpenAIResponsesTextFormat;
  verbosity?: "low" | "medium" | "high" | null;
}

export interface OpenAIResponsesResponseMessageItem {
  type: "message";
  id: string;
  role: "assistant";
  status: "in_progress" | "completed" | "incomplete";
  content: Array<{
    type: "output_text";
    text: string;
    annotations: unknown[];
  }>;
}

export interface OpenAIResponsesResponseFunctionCallItem {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: "in_progress" | "completed" | "incomplete";
}

export interface OpenAIResponsesResponse {
  id: string;
  object: "response";
  created_at: number;
  status: "in_progress" | "completed" | "failed" | "incomplete";
  model: string;
  output_text: string;
  error: { message: string; type?: string; code?: string | null } | null;
  incomplete_details: Record<string, unknown> | null;
  instructions: string | null;
  metadata: Record<string, string> | null;
  output: Array<OpenAIResponsesResponseMessageItem | OpenAIResponsesResponseFunctionCallItem>;
  parallel_tool_calls: boolean;
  temperature: number | null;
  tool_choice: OpenAIResponsesToolChoice | "auto";
  tools: OpenAIResponsesTool[];
  top_p: number | null;
  usage: {
    input_tokens: number;
    input_tokens_details: { cached_tokens: number };
    output_tokens: number;
    output_tokens_details: { reasoning_tokens: number };
    total_tokens: number;
  };
  completed_at?: number | null;
}

export interface OpenAIResponsesRequest {
  model?: string;
  input?: string | OpenAIResponsesInputItem[];
  instructions?: string;
  tools?: OpenAIResponsesTool[];
  tool_choice?: OpenAIResponsesToolChoice;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  parallel_tool_calls?: boolean | null;
  metadata?: Record<string, string> | null;
  previous_response_id?: string | null;
  text?: OpenAIResponsesTextConfig;
  extra_body?: OpenAIExtraBody;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic Messages API types
// @see https://platform.claude.com/docs/en/api/typescript/messages/create
// ─────────────────────────────────────────────────────────────────────────────

// Input-side types: delegate directly to @anthropic-ai/sdk
export type {
  ImageBlockParam as AnthropicImageBlock,
  ContentBlockParam as AnthropicContentBlock,
  MessageParam as AnthropicMessageParam,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages";

export type AnthropicToolChoice = ToolChoiceAuto | ToolChoiceAny | ToolChoiceTool | ToolChoiceNone;

export interface AnthropicMessagesRequest extends Omit<MessageCreateParams, "stream"> {
  stream?: boolean;
  extra_body?: OpenAIExtraBody;
}

// Output-side types: use SDK types with Omit<> to strip fields that only
// exist on the client-side SDK but are not part of the wire protocol.

/** Anthropic text content block (wire protocol subset of SDK TextBlock) */
export type AnthropicTextBlock = Omit<TextBlock, "citations">;

/** Anthropic thinking content block */
export type AnthropicThinkingBlock = ThinkingBlock;

/** Anthropic tool-use content block (wire protocol subset of SDK ToolUseBlock) */
export type AnthropicToolUseBlock = Omit<ToolUseBlock, "caller">;

/** Anthropic tool-result content block */
export type AnthropicToolResultBlock = ToolResultBlockParam;

/** Anthropic stop reason */
export type AnthropicStopReason = StopReason;

/** Anthropic Messages response (wire protocol subset of SDK Message) */
export type AnthropicMessageResponse = Omit<
  Message,
  "container" | "stop_details" | "content" | "usage"
> & {
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  usage: { input_tokens: number; output_tokens: number };
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapter config
// ─────────────────────────────────────────────────────────────────────────────

export interface ACP2OpenAIConfig {
  defaultModel?: string;
  middleware?: ACP2OpenAIMiddleware | ACP2OpenAIMiddleware[];
  plugins?: ACP2OpenAIPlugin | ACP2OpenAIPlugin[];
  runtimeFactory?: ACP2RuntimeFactory;
  listModels?: ACP2ListModelsResolver;
  transformTools?: ACP2ToolTransformer;
  normalizeToolCall?: ACP2ToolCallNormalizer;
}
