/**
 * Anthropic Messages API adapter — request/response conversion helpers.
 * @see https://platform.claude.com/docs/en/api/typescript/messages/create
 *
 * All functions are pure (no class state).  The AiyoAdapter class delegates to
 * these helpers so this file can be read and maintained in isolation.
 */
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import type { ToolUnion } from "@anthropic-ai/sdk/resources/messages";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAITool,
  OpenAIToolCall,
  AnthropicMessagesRequest,
  AnthropicMessageResponse,
  AnthropicStopReason,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  AnthropicToolChoice,
  AnthropicTool,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 15);
}

function parseArgsObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input conversion
// ─────────────────────────────────────────────────────────────────────────────

export function stringifyAnthropicBlockText(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function convertAnthropicToolsToOpenAI(
  tools?: AnthropicTool[] | ToolUnion[],
): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const mapped = (tools as ToolUnion[])
    .filter(
      (tool): tool is AnthropicTool => "name" in tool && "input_schema" in tool && !!tool.name,
    )
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

export function convertAnthropicToolChoice(
  toolChoice?: AnthropicToolChoice,
): ChatCompletionToolChoiceOption | undefined {
  if (!toolChoice) return undefined;

  if (toolChoice.type === "tool") {
    return { type: "function", function: { name: toolChoice.name } };
  }
  if (toolChoice.type === "any") return "required";
  if (toolChoice.type === "auto" || toolChoice.type === "none") {
    return toolChoice.type;
  }

  return undefined;
}

export function convertAnthropicMessagesToOpenAI(
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
            source.type === "url"
              ? source.url
              : source.type === "base64" && source.data
                ? `data:${source.media_type ?? "application/octet-stream"};base64,${source.data}`
                : undefined;

          if (url) {
            userParts.push({ type: "image_url", image_url: { url } });
          }
          continue;
        }

        if (block.type === "tool_result") {
          messages.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: stringifyAnthropicBlockText(block.content ?? ""),
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

export function toChatCompletionRequestFromAnthropic(
  req: AnthropicMessagesRequest,
  defaultModel?: string,
): OpenAIChatCompletionRequest {
  const extraBody =
    req.extra_body || req.top_k != null
      ? {
          ...(req.extra_body ?? {}),
          ...(req.top_k != null ? { topK: req.top_k } : {}),
        }
      : undefined;

  return {
    model: req.model || defaultModel || "",
    messages: convertAnthropicMessagesToOpenAI(req),
    tools: convertAnthropicToolsToOpenAI(req.tools),
    tool_choice: convertAnthropicToolChoice(req.tool_choice),
    temperature: req.temperature,
    max_tokens: req.max_tokens,
    top_p: req.top_p,
    stop: req.stop_sequences,
    stream: req.stream,
    extra_body: extraBody,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response mapping
// ─────────────────────────────────────────────────────────────────────────────

export function mapOpenAIStopReasonToAnthropic(
  finishReason: string | undefined,
  toolCalls?: OpenAIToolCall[],
): AnthropicStopReason {
  if (toolCalls && toolCalls.length > 0) return "tool_use";

  if (!finishReason) return "end_turn";
  if (finishReason === "tool_calls" || finishReason === "tool-calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "content_filter") return "stop_sequence";
  return "end_turn";
}

export function toAnthropicUsageFromOpenAI(
  usage: OpenAIChatCompletionResponse["usage"] | undefined,
): AnthropicMessageResponse["usage"] {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
  };
}

export function toAnthropicUsageFromAISDK(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
): AnthropicMessageResponse["usage"] {
  return {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
  };
}

export function toAnthropicContentBlocks(
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
      input: parseArgsObject(call.function.arguments),
    });
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return content;
}

export function mapChatToAnthropic(
  chatResponse: OpenAIChatCompletionResponse,
  coerceToolCalls: (tcs: unknown) => OpenAIToolCall[] | undefined,
): AnthropicMessageResponse {
  const choice = chatResponse.choices[0];
  const toolCalls = coerceToolCalls(choice?.message?.tool_calls);

  return {
    id: `msg_${generateId()}`,
    type: "message",
    role: "assistant",
    model: chatResponse.model,
    content: toAnthropicContentBlocks(choice?.message?.content ?? null, toolCalls),
    stop_reason: mapOpenAIStopReasonToAnthropic(choice?.finish_reason ?? undefined, toolCalls),
    stop_sequence: null,
    usage: toAnthropicUsageFromOpenAI(chatResponse.usage),
  };
}
