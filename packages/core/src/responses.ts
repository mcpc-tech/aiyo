/**
 * OpenAI Responses API adapter — request/response conversion helpers.
 * @see https://developers.openai.com/api/reference/resources/responses/methods/create
 *
 * All functions are pure (no class state).  The ACP2OpenAI class delegates to
 * these helpers so this file can be read and maintained in isolation.
 */
import type {
  ChatCompletionToolChoiceOption,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAITool,
  OpenAIToolCall,
  OpenAIResponsesRequest,
  OpenAIResponsesResponse,
  OpenAIResponsesInputItem,
  OpenAIResponsesInputMessage,
  OpenAIResponsesTextConfig,
  OpenAIResponsesTool,
  OpenAIResponsesFunctionTool,
  OpenAIResponsesToolChoice,
  OpenAIResponsesResponseMessageItem,
  OpenAIResponsesResponseFunctionCallItem,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 15);
}

// ─────────────────────────────────────────────────────────────────────────────
// Input conversion
// ─────────────────────────────────────────────────────────────────────────────

export function stringifyResponsesInputContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.input_text === "string") return part.input_text;
      if (typeof part.output_text === "string") return part.output_text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function getResponsesToolCallId(
  item: Partial<Pick<OpenAIResponsesInputMessage, "call_id" | "tool_call_id" | "id">>,
): string {
  return item.call_id ?? item.tool_call_id ?? item.id ?? `call_${generateId()}`;
}

export function convertResponsesTextConfig(
  textConfig?: OpenAIResponsesTextConfig,
): OpenAIChatCompletionRequest["response_format"] | undefined {
  const format = textConfig?.format;
  if (!format) return undefined;

  switch (format.type) {
    case "text":
      return { type: "text" };
    case "json_object":
      return { type: "json_object" };
    case "json_schema":
      return {
        type: "json_schema",
        json_schema: {
          name: format.name ?? "response",
          ...(format.description != null && { description: format.description }),
          ...(format.schema != null && { schema: format.schema }),
          ...(format.strict != null && { strict: format.strict }),
        },
      };
    default:
      return undefined;
  }
}

export function convertResponsesTools(tools?: OpenAIResponsesTool[]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const mapped = tools
    .filter((tool): tool is OpenAIResponsesFunctionTool => tool.type === "function" && !!tool.name)
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

export function convertResponsesToolChoice(
  toolChoice?: OpenAIResponsesToolChoice,
): ChatCompletionToolChoiceOption | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "none" || toolChoice === "auto" || toolChoice === "required")
    return toolChoice;

  if (typeof toolChoice === "object") {
    if (toolChoice.type === "function" && "name" in toolChoice) {
      return { type: "function", function: { name: toolChoice.name } };
    }
    if (toolChoice.type === "tool" && "name" in toolChoice) {
      return { type: "function", function: { name: toolChoice.name } };
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

export function convertResponsesInputToMessages(
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

  for (const item of input as OpenAIResponsesInputItem[]) {
    if (!isRecord(item)) continue;

    const typedItem = item as Record<string, unknown>;
    const role = typedItem.role as string | undefined;
    const content = stringifyResponsesInputContent(typedItem.content);
    const outputContent = stringifyResponsesInputContent(typedItem.output ?? typedItem.content);

    if (typedItem.type === "function_call" && typeof typedItem.name === "string") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: getResponsesToolCallId(typedItem as any),
            type: "function",
            function: {
              name: typedItem.name,
              arguments: typeof typedItem.arguments === "string" ? typedItem.arguments : "{}",
            },
          },
        ],
      });
      continue;
    }

    if (typedItem.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: getResponsesToolCallId(typedItem as any),
        content: outputContent,
      });
      continue;
    }

    if (role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: getResponsesToolCallId(typedItem as any),
        content: outputContent,
      });
      continue;
    }

    if (role === "system" || role === "developer" || role === "assistant" || role === "user") {
      messages.push({ role, content });
    }
  }

  return messages;
}

export function toChatCompletionRequestFromResponses(
  req: OpenAIResponsesRequest,
): OpenAIChatCompletionRequest {
  return {
    model: req.model ?? "",
    messages: convertResponsesInputToMessages(req),
    tools: convertResponsesTools(req.tools),
    tool_choice: convertResponsesToolChoice(req.tool_choice),
    response_format: convertResponsesTextConfig(req.text),
    temperature: req.temperature,
    max_tokens: req.max_output_tokens,
    top_p: req.top_p,
    frequency_penalty: req.frequency_penalty,
    presence_penalty: req.presence_penalty,
    stream: req.stream,
    extra_body: req.extra_body,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response mapping
// ─────────────────────────────────────────────────────────────────────────────

export function coerceOpenAIToolCalls(
  toolCalls: unknown,
  toOpenAIToolCalls: (tcs: any[]) => OpenAIToolCall[] | undefined,
): OpenAIToolCall[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

  const direct = toolCalls.filter(
    (call): call is OpenAIToolCall =>
      isRecord(call) &&
      typeof call.id === "string" &&
      call.type === "function" &&
      isRecord(call.function) &&
      typeof call.function.name === "string" &&
      typeof call.function.arguments === "string",
  );

  return direct.length > 0 ? direct : toOpenAIToolCalls(toolCalls);
}

export function toResponsesOutput(
  messageContent: string | null,
  toolCalls: OpenAIToolCall[] | undefined,
  options?: { messageId?: string },
): OpenAIResponsesResponse["output"] {
  const output: OpenAIResponsesResponse["output"] = [];

  if (messageContent && messageContent.length > 0) {
    output.push({
      type: "message",
      id: options?.messageId ?? `msg_${generateId()}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: messageContent, annotations: [] }],
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
      id: options?.messageId ?? `msg_${generateId()}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "", annotations: [] }],
    });
  }

  return output;
}

export function getResponsesOutputText(output: OpenAIResponsesResponse["output"]): string {
  return output
    .filter((item): item is OpenAIResponsesResponseMessageItem => item.type === "message")
    .flatMap((item) => item.content)
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n");
}

export function buildResponsesUsage(
  usage?: OpenAIChatCompletionResponse["usage"],
): OpenAIResponsesResponse["usage"] {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: usage?.completion_tokens ?? 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: usage?.total_tokens ?? 0,
  };
}

export function buildResponsesResponse(
  req: OpenAIResponsesRequest,
  model: string,
  createdAt: number,
  output: OpenAIResponsesResponse["output"],
  options?: {
    responseId?: string;
    status?: OpenAIResponsesResponse["status"];
    completedAt?: number | null;
    usage?: OpenAIChatCompletionResponse["usage"];
    error?: OpenAIResponsesResponse["error"];
    incompleteDetails?: OpenAIResponsesResponse["incomplete_details"];
  },
): OpenAIResponsesResponse {
  const id = options?.responseId ?? `resp_${generateId()}`;

  return {
    id,
    object: "response",
    created_at: createdAt,
    status: options?.status ?? "completed",
    model,
    output_text: getResponsesOutputText(output),
    error: options?.error ?? null,
    incomplete_details: options?.incompleteDetails ?? null,
    instructions: req.instructions ?? null,
    metadata: req.metadata ?? null,
    output,
    parallel_tool_calls: req.parallel_tool_calls ?? false,
    temperature: req.temperature ?? null,
    tool_choice: req.tool_choice ?? "auto",
    tools: req.tools ?? [],
    top_p: req.top_p ?? null,
    usage: buildResponsesUsage(options?.usage),
    completed_at: options?.completedAt ?? null,
  };
}

export function mapChatToResponses(
  chatResponse: OpenAIChatCompletionResponse,
  req: OpenAIResponsesRequest,
  toOpenAIToolCalls: (tcs: any[]) => OpenAIToolCall[] | undefined,
  options?: { responseId?: string; messageId?: string },
): OpenAIResponsesResponse {
  const message = chatResponse.choices[0]?.message;
  const output = toResponsesOutput(
    message?.content ?? null,
    coerceOpenAIToolCalls(message?.tool_calls, toOpenAIToolCalls),
    { messageId: options?.messageId },
  );

  return buildResponsesResponse(req, chatResponse.model, chatResponse.created, output, {
    responseId: options?.responseId,
    status: "completed",
    completedAt: chatResponse.created,
    usage: chatResponse.usage,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming events helpers
// ─────────────────────────────────────────────────────────────────────────────

export function buildResponsesStreamEvents(
  finalResponse: OpenAIResponsesResponse,
  formatSSEEvent: (event: string, data: unknown) => string,
  nextSequenceNumber: () => number,
): string[] {
  const events: string[] = [];

  finalResponse.output.forEach((item, outputIndex) => {
    if (item.type === "message") {
      const outputTextPart = item.content[0] ?? {
        type: "output_text",
        text: "",
        annotations: [],
      };
      const startedItem: OpenAIResponsesResponseMessageItem = {
        ...item,
        status: "in_progress",
        content: [],
      };

      events.push(
        formatSSEEvent("response.output_item.added", {
          type: "response.output_item.added",
          sequence_number: nextSequenceNumber(),
          output_index: outputIndex,
          item: startedItem,
        }),
        formatSSEEvent("response.content_part.added", {
          type: "response.content_part.added",
          sequence_number: nextSequenceNumber(),
          output_index: outputIndex,
          content_index: 0,
          item_id: item.id,
          part: { type: "output_text", text: "", annotations: [] },
        }),
      );

      if (outputTextPart.text.length > 0) {
        events.push(
          formatSSEEvent("response.output_text.delta", {
            type: "response.output_text.delta",
            sequence_number: nextSequenceNumber(),
            output_index: outputIndex,
            content_index: 0,
            item_id: item.id,
            delta: outputTextPart.text,
            logprobs: [],
          }),
        );
      }

      events.push(
        formatSSEEvent("response.output_text.done", {
          type: "response.output_text.done",
          sequence_number: nextSequenceNumber(),
          output_index: outputIndex,
          content_index: 0,
          item_id: item.id,
          text: outputTextPart.text,
          logprobs: [],
        }),
        formatSSEEvent("response.content_part.done", {
          type: "response.content_part.done",
          sequence_number: nextSequenceNumber(),
          output_index: outputIndex,
          content_index: 0,
          item_id: item.id,
          part: outputTextPart,
        }),
        formatSSEEvent("response.output_item.done", {
          type: "response.output_item.done",
          sequence_number: nextSequenceNumber(),
          output_index: outputIndex,
          item,
        }),
      );
      return;
    }

    const startedItem: OpenAIResponsesResponseFunctionCallItem = {
      ...item,
      status: "in_progress",
      arguments: "",
    };

    events.push(
      formatSSEEvent("response.output_item.added", {
        type: "response.output_item.added",
        sequence_number: nextSequenceNumber(),
        output_index: outputIndex,
        item: startedItem,
      }),
    );

    if (item.arguments.length > 0) {
      events.push(
        formatSSEEvent("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          sequence_number: nextSequenceNumber(),
          output_index: outputIndex,
          item_id: item.id,
          delta: item.arguments,
        }),
      );
    }

    events.push(
      formatSSEEvent("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        sequence_number: nextSequenceNumber(),
        output_index: outputIndex,
        item_id: item.id,
        arguments: item.arguments,
        name: item.name,
      }),
      formatSSEEvent("response.output_item.done", {
        type: "response.output_item.done",
        sequence_number: nextSequenceNumber(),
        output_index: outputIndex,
        item,
      }),
    );
  });

  return events;
}
