import type { SandboxConfig } from "@mcpc-tech/handle-sandbox";
import {
  createDenoCodeExecutionRuntimeFactory,
  type CodeExecutionRuntimeFactory,
  type CodeExecutionRuntimeHandle,
} from "./code-execution-runtime.js";
import type {
  AiyoFinalResult,
  AiyoPlugin,
  AiyoMiddleware,
  OpenAIChatCompletionRequest,
} from "./index.js";
import type { ChatCompletionToolChoiceOption } from "openai/resources/chat/completions";

export interface ProgrammaticToolLoopToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ProgrammaticToolLoopMatchContext {
  iteration: number;
  request: OpenAIChatCompletionRequest;
  result: AiyoFinalResult;
}

export interface ProgrammaticToolLoopExecuteContext extends ProgrammaticToolLoopMatchContext {
  toolCall: ProgrammaticToolLoopToolCall;
}

export interface ProgrammaticToolLoopToolResultStep {
  type?: "tool-result";
  output: unknown;
}

export interface ProgrammaticToolLoopFinalResultStep {
  type: "final-result";
  result: AiyoFinalResult;
}

export type ProgrammaticToolLoopStepResult =
  | ProgrammaticToolLoopToolResultStep
  | ProgrammaticToolLoopFinalResultStep;

export interface ProgrammaticToolLoopPluginConfig {
  name?: string;
  maxIterations?: number;
  match?: (
    toolCall: ProgrammaticToolLoopToolCall,
    context: ProgrammaticToolLoopMatchContext,
  ) => boolean;
  execute: (
    context: ProgrammaticToolLoopExecuteContext,
  ) => Promise<ProgrammaticToolLoopStepResult | unknown> | ProgrammaticToolLoopStepResult | unknown;
  prepareNextRequest?: (
    request: OpenAIChatCompletionRequest,
    context: ProgrammaticToolLoopExecuteContext,
  ) => OpenAIChatCompletionRequest;
  serializeToolResult?: (output: unknown) => string;
}

// ─────────────────────────────────────────────────────────────────────────────
// JavaScript code execution plugin types
// ─────────────────────────────────────────────────────────────────────────────

export interface JavaScriptProgrammaticToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  output: unknown;
}

export interface JavaScriptProgrammaticToolHandlerContext extends ProgrammaticToolLoopExecuteContext {
  args: Record<string, unknown>;
  logs: string[];
  toolHistory: JavaScriptProgrammaticToolCallRecord[];
}

export interface JavaScriptProgrammaticExecutionResult {
  source: string;
  value: unknown;
  logs: string[];
  toolHistory: JavaScriptProgrammaticToolCallRecord[];
}

/** A pending tool call that the sandbox is blocked on. */
export interface CodeExecutionPendingToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** The state of a running code execution session. */
export type CodeExecutionSessionState =
  | "running"
  | "waiting_for_tool_result"
  | "completed"
  | "error";

/** A code execution session that can be suspended and resumed across HTTP requests. */
export interface CodeExecutionSession {
  executionId: string;
  handle: CodeExecutionRuntimeHandle;
  executionToolCallId?: string;
  modelRequestMessages?: OpenAIChatCompletionRequest["messages"];
  assistantToolCallMessage?: OpenAIChatCompletionRequest["messages"][number];
}

export interface JavaScriptCodeExecutionPluginConfig {
  name?: string;
  /** Tool name that the model calls with JS code inside. Default: matches any. */
  match?: (
    toolCall: ProgrammaticToolLoopToolCall,
    context: ProgrammaticToolLoopMatchContext,
  ) => boolean;
  /** Extract JS source from tool call input. Default: input.code / input.javascript / input.js */
  getCode?: (toolCall: ProgrammaticToolLoopToolCall) => string | undefined;
  /** Names of the tools that the JS code is allowed to call (these are the real OpenAI tools).
   * Use `["*"]` to intercept all function tools from the request. */
  toolNames: string[];
  /**
   * The name of the single tool exposed to the model. Default: "code_execution".
   * The model will call this tool with a `code` field containing JavaScript.
   */
  codeExecutionToolName?: string;
  /**
   * Description for the code_execution tool shown to the model.
   * If not set, a default description is generated that lists all available tools.
   */
  codeExecutionToolDescription?: string;
  /**
   * If true (default), the plugin automatically:
   * 1. Replaces the request's tools with a single `code_execution` tool
   * 2. Injects a system prompt describing available tools and how to call them
   *
   * Set to false if you want to manage the tool definition and prompt yourself.
   */
  rewriteRequest?: boolean;
  /** Per-execution timeout in ms. Default: 30_000 */
  timeoutMs?: number;
  /** Max console.log lines kept. Default: 50 */
  maxLogs?: number;
  /** Extra globals injected into the sandbox. */
  sandbox?: () => Record<string, unknown> | undefined;
  /** Deno sandbox process options such as permissions, cwd, env, and extra args. */
  denoSandbox?: SandboxConfig;
  /** Custom runtime factory for advanced embedding; defaults to the built-in Deno runtime. */
  runtimeFactory?: CodeExecutionRuntimeFactory;
  /** Maps the final execution result before it's sent back to the model as tool_result. */
  mapExecutionResult?: (
    result: JavaScriptProgrammaticExecutionResult,
  ) => Promise<unknown> | unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDefaultJavaScriptCode(toolCall: ProgrammaticToolLoopToolCall): string | undefined {
  const candidates = [toolCall.input.code, toolCall.input.javascript, toolCall.input.js];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function normalizeToolCall(toolCall: any): ProgrammaticToolLoopToolCall | undefined {
  if (!isRecord(toolCall)) return undefined;
  const toolCallId =
    typeof toolCall.toolCallId === "string" && toolCall.toolCallId
      ? toolCall.toolCallId
      : undefined;
  const toolName =
    typeof toolCall.toolName === "string" && toolCall.toolName ? toolCall.toolName : undefined;

  if (!toolCallId || !toolName) return undefined;

  const input = isRecord(toolCall.input)
    ? toolCall.input
    : isRecord(toolCall.args)
      ? toolCall.args
      : {};

  return {
    toolCallId,
    toolName,
    input,
  };
}

function toAssistantToolCallMessage(
  result: AiyoFinalResult,
): OpenAIChatCompletionRequest["messages"][number] | undefined {
  const normalizedToolCalls = (result.toolCalls ?? [])
    .map((toolCall) => normalizeToolCall(toolCall))
    .filter((toolCall): toolCall is ProgrammaticToolLoopToolCall => Boolean(toolCall));

  if (normalizedToolCalls.length === 0) {
    return undefined;
  }

  return {
    role: "assistant",
    content: typeof result.text === "string" ? result.text : null,
    tool_calls: normalizedToolCalls.map((toolCall) => ({
      id: toolCall.toolCallId,
      type: "function" as const,
      function: {
        name: toolCall.toolName,
        arguments: JSON.stringify(toolCall.input ?? {}),
      },
    })),
  };
}

function defaultSerializeToolResult(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output ?? null);
}

const RESUME_SESSION_ID_FIELD = "__aiyo_resume_session_id";

function setResumeSessionId(request: OpenAIChatCompletionRequest, executionId: string): void {
  (request as OpenAIChatCompletionRequest & Record<string, unknown>)[RESUME_SESSION_ID_FIELD] =
    executionId;
}

function getResumeSessionId(request: OpenAIChatCompletionRequest): string | undefined {
  const value = (request as OpenAIChatCompletionRequest & Record<string, unknown>)[
    RESUME_SESSION_ID_FIELD
  ];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stripResumeSessionId(request: OpenAIChatCompletionRequest): OpenAIChatCompletionRequest {
  const cloned = {
    ...request,
  } as OpenAIChatCompletionRequest & Record<string, unknown>;
  delete cloned[RESUME_SESSION_ID_FIELD];
  return cloned;
}

function isFinalResultStep(
  value: ProgrammaticToolLoopStepResult | unknown,
): value is ProgrammaticToolLoopFinalResultStep {
  return isRecord(value) && value.type === "final-result" && isRecord(value.result);
}

function toToolResultOutput(value: ProgrammaticToolLoopStepResult | unknown): unknown {
  if (isRecord(value) && (value.type === undefined || value.type === "tool-result")) {
    return value.output;
  }

  return value;
}

function generateId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic programmatic tool loop (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export function createProgrammaticToolLoopPlugin(
  config: ProgrammaticToolLoopPluginConfig,
): AiyoPlugin {
  const maxIterations = Math.max(1, config.maxIterations ?? 8);
  const match =
    config.match ??
    (() => {
      return true;
    });
  const serializeToolResult = config.serializeToolResult ?? defaultSerializeToolResult;

  return {
    name: config.name ?? "programmatic-tool-loop",
    onResult: async (ctx) => {
      let currentRequest = cloneValue(ctx.request);
      let currentResult = cloneValue(ctx.result);
      let looped = false;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const matchedToolCall = (currentResult.toolCalls ?? [])
          .map((toolCall) => normalizeToolCall(toolCall))
          .filter((toolCall): toolCall is ProgrammaticToolLoopToolCall => Boolean(toolCall))
          .find((toolCall) =>
            match(toolCall, {
              iteration,
              request: cloneValue(currentRequest),
              result: cloneValue(currentResult),
            }),
          );

        if (!matchedToolCall) {
          if (looped) {
            ctx.overrideResult = currentResult;
          }
          return;
        }

        looped = true;

        const executeContext: ProgrammaticToolLoopExecuteContext = {
          iteration,
          toolCall: cloneValue(matchedToolCall),
          request: cloneValue(currentRequest),
          result: cloneValue(currentResult),
        };
        const step = await config.execute(executeContext);

        if (isFinalResultStep(step)) {
          ctx.overrideResult = cloneValue(step.result);
          return;
        }

        const assistantMessage = toAssistantToolCallMessage(currentResult);
        if (!assistantMessage) {
          ctx.overrideResult = currentResult;
          return;
        }

        currentRequest = {
          ...currentRequest,
          messages: [
            ...currentRequest.messages,
            assistantMessage,
            {
              role: "tool",
              tool_call_id: matchedToolCall.toolCallId,
              content: serializeToolResult(toToolResultOutput(step)),
            },
          ],
        };

        if (config.prepareNextRequest) {
          currentRequest = config.prepareNextRequest(cloneValue(currentRequest), executeContext);
        }

        currentResult = await ctx.runModel(currentRequest, {
          skipPlugins: true,
        });
      }

      ctx.overrideResult = currentResult;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt generation for programmatic tool calling
// ─────────────────────────────────────────────────────────────────────────────

interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
  };
}

function summarizeSchemaProperties(schema: Record<string, unknown> | undefined): string[] {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const props = isRecord(schema?.properties) ? schema.properties : {};

  return Object.entries(props).map(([key, propertySchema]) => {
    const s = isRecord(propertySchema) ? propertySchema : {};
    const req = required.includes(key) ? " (required)" : " (optional)";
    const desc = typeof s.description === "string" ? ` — ${s.description}` : "";
    return `  - ${key}: ${s.type ?? "any"}${req}${desc}`;
  });
}

function getToolOutputSchema(tool: OpenAIToolDefinition): Record<string, unknown> | undefined {
  const fn = tool.function;

  if (isRecord(fn.outputSchema)) {
    return fn.outputSchema;
  }

  if (isRecord(fn.output_schema)) {
    return fn.output_schema;
  }

  return undefined;
}

function buildToolSchemaBlock(tool: OpenAIToolDefinition): string {
  const fn = tool.function;
  const paramsJson = fn.parameters ? JSON.stringify(fn.parameters, null, 2) : "{}";
  const outputSchema = getToolOutputSchema(tool);
  const outputJson = outputSchema ? JSON.stringify(outputSchema, null, 2) : undefined;

  const paramLines = summarizeSchemaProperties(fn.parameters);
  const outputLines = summarizeSchemaProperties(outputSchema);

  return [
    `<tool name="${fn.name}">`,
    fn.description ? `<description>${fn.description}</description>` : "",
    `<parameters>`,
    `${paramsJson}`,
    `</parameters>`,
    paramLines.length > 0 ? `<param_summary>\n${paramLines.join("\n")}\n</param_summary>` : "",
    outputJson ? `<output_schema>\n${outputJson}\n</output_schema>` : "",
    outputLines.length > 0 ? `<output_summary>\n${outputLines.join("\n")}\n</output_summary>` : "",
    `<usage>const result = await tools.${fn.name}(${buildExampleArgs(fn.parameters)});</usage>`,
    `</tool>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildExampleArgs(parameters?: Record<string, unknown>): string {
  if (!parameters) return "{}";
  const props = parameters.properties;
  if (!isRecord(props) || Object.keys(props).length === 0) return "{}";

  const example: Record<string, string> = {};
  for (const [key, schema] of Object.entries(props)) {
    if (isRecord(schema)) {
      const type = schema.type;
      if (type === "string") example[key] = `"..."`;
      else if (type === "number" || type === "integer") example[key] = "0";
      else if (type === "boolean") example[key] = "true";
      else if (type === "array") example[key] = "[]";
      else example[key] = `"..."`;
    }
  }

  return (
    "{ " +
    Object.entries(example)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ") +
    " }"
  );
}

/**
 * Build the system prompt that teaches the model how to use programmatic tool calling.
 *
 * @param tools - The original OpenAI tools from the request
 * @param codeExecutionToolName - Name of the wrapper tool (default: "code_execution")
 */
export function buildCodeExecutionSystemPrompt(
  tools: OpenAIToolDefinition[],
  codeExecutionToolName = "code_execution",
): string {
  const toolSchemas = tools
    .filter((t) => t.type === "function" && t.function?.name)
    .map((t) => buildToolSchemaBlock(t))
    .join("\n\n");

  return `<programmatic_tool_calling>
<overview>
You write JavaScript code to call tools programmatically via the \`${codeExecutionToolName}\` tool.
Call \`${codeExecutionToolName}\` with a \`code\` field containing your JavaScript.
</overview>

<instructions>
- Call tools with \`await tools.<name>(args)\`. Always await.
- Use \`return <value>\` to produce a final structured result.
- Use \`console.log()\` for debug output (captured, not returned to user).
- You may use loops, conditionals, variables, try/catch.
- Sandboxed: no \`require\`, \`import\`, or network access.
- Tool args must be plain JSON-serializable objects.
- For multiple independent tool calls, use sequential awaits (not Promise.all).
- If a tool declares an \`output_schema\`, treat it as authoritative and read only fields defined there.
- Do not guess alternate result field names when an output schema is available.
</instructions>

<available_tools>
${toolSchemas}
</available_tools>

<example>
<user_request>How many rockets launched in 2025 and what's the weather in Tokyo?</user_request>
<code>
const launches = await tools.get_launch_count({ year: 2025 });
const weather = await tools.get_weather({ city: "Tokyo", country: "Japan" });
return { launches, weather };
</code>
</example>
</programmatic_tool_calling>`;
}

/**
 * Build the OpenAI tool definition for the code execution wrapper tool.
 */
function buildCodeExecutionToolDefinition(
  toolName: string,
  description?: string,
): OpenAIToolDefinition {
  return {
    type: "function",
    function: {
      name: toolName,
      description:
        description ??
        "Execute JavaScript code that can call tools programmatically. Put your code in the `code` field. Use `await tools.<name>(args)` to call tools. Use `return <value>` to produce a result.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript code to execute. Use `await tools.<name>(args)` to call available tools. Use `return <value>` for the final result.",
          },
        },
        required: ["code"],
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JavaScript code execution plugin (cross-request tool bridge)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a plugin that implements the Claude-style programmatic tool calling:
 *
 * 1. AI SDK sees ONE tool (e.g. `code_execution`). The model writes JS code.
 * 2. The plugin runs the JS in a sandbox. When the code calls `tools.read(args)`,
 *    the sandbox **suspends** (the `await` blocks on a Promise).
 * 3. The OpenAI layer **responds immediately** with `tool_calls: [{ name: "read", args }]`.
 * 4. The user/agent executes the real tool and sends a new request with `tool_result`.
 * 5. The plugin **resumes** the sandbox — `tools.read()` returns the result.
 * 6. Repeat until the JS finishes. The final value becomes the `tool_result` for
 *    the model's original `code_execution` tool call.
 */
export function createJavaScriptCodeExecutionPlugin(
  config: JavaScriptCodeExecutionPluginConfig,
): AiyoPlugin {
  const maxLogs = Math.max(1, config.maxLogs ?? 50);
  const timeoutMs = Math.max(1, config.timeoutMs ?? 30_000);
  const codeToolName = config.codeExecutionToolName ?? "code_execution";
  const shouldRewrite = config.rewriteRequest !== false;

  // In-memory session store. Key = executionId.
  const sessions = new Map<string, CodeExecutionSession>();

  // ── request rewrite middleware ───────────────────────────────────────

  const rewriteMiddleware: AiyoMiddleware = (ctx) => {
    if (ctx.phase !== "request" || !shouldRewrite) return;

    const originalTools = ctx.request.tools;
    if (!originalTools || originalTools.length === 0) return;

    // toolNames: ["*"] means intercept ALL function tools from the request.
    // Otherwise filter to only the specified tool names.
    const matchAll = config.toolNames.length === 1 && config.toolNames[0] === "*";
    const toolNamesSet = new Set(config.toolNames);
    const relevantTools = originalTools.filter(
      (t): t is OpenAIToolDefinition =>
        t.type === "function" &&
        !!t.function?.name &&
        (matchAll || toolNamesSet.has(t.function.name)),
    );

    if (relevantTools.length === 0) return;

    // 1. Generate the system prompt
    const systemPrompt = buildCodeExecutionSystemPrompt(relevantTools, codeToolName);

    // 2. Inject system prompt at the beginning of messages
    const hasSystemMessage =
      ctx.request.messages.length > 0 &&
      isRecord(ctx.request.messages[0]) &&
      ctx.request.messages[0].role === "system";

    if (hasSystemMessage) {
      // Append to existing system message
      const existing = ctx.request.messages[0] as {
        role: "system";
        content: string;
      };
      existing.content =
        (typeof existing.content === "string" ? existing.content : "") + "\n\n" + systemPrompt;
    } else {
      // Prepend new system message
      ctx.request.messages = [{ role: "system", content: systemPrompt }, ...ctx.request.messages];
    }

    // 3. Replace tools with just the code_execution tool
    ctx.request.tools = [
      buildCodeExecutionToolDefinition(codeToolName, config.codeExecutionToolDescription),
    ];

    // 4. Adjust tool_choice if it was forcing one of the real tools
    if (ctx.request.tool_choice && typeof ctx.request.tool_choice === "object") {
      const tc = ctx.request.tool_choice as ChatCompletionToolChoiceOption & {
        type: string;
        function?: { name: string };
      };
      if (tc.type === "function" && tc.function?.name) {
        if (toolNamesSet.has(tc.function.name)) {
          ctx.request.tool_choice = {
            type: "function",
            function: { name: codeToolName },
          };
        }
      }
    } else if (ctx.request.tool_choice === "required") {
      // Keep as required — model must call code_execution
    }
  };

  const runtimeFactory =
    config.runtimeFactory ??
    createDenoCodeExecutionRuntimeFactory({
      name: config.name,
      timeoutMs,
      maxLogs,
      toolNames: config.toolNames,
      sandboxGlobals: config.sandbox,
      denoSandbox: config.denoSandbox,
    });

  // ── helpers ──────────────────────────────────────────────────────────

  async function startSession(
    executionId: string,
    source: string,
    toolCallInput: Record<string, unknown>,
  ): Promise<CodeExecutionSession> {
    const handle = await runtimeFactory.createExecution({
      executionId,
      source,
      toolCallInput,
    });

    const session: CodeExecutionSession = {
      executionId,
      handle,
    };

    sessions.set(executionId, session);
    return session;
  }

  function findSessionByPendingToolCall(toolCallId: string): CodeExecutionSession | undefined {
    for (const session of sessions.values()) {
      if (
        session.handle.state === "waiting_for_tool_result" &&
        session.handle.pendingToolCall?.toolCallId === toolCallId
      ) {
        return session;
      }
    }

    return undefined;
  }

  // ── middleware: intercept incoming tool_result for a pending session ──

  const resumeMiddleware: AiyoMiddleware = (ctx) => {
    if (ctx.phase !== "request") return;

    const messages = ctx.request.messages;
    if (!messages || messages.length === 0) return;

    for (const msg of messages) {
      if (!isRecord(msg) || msg.role !== "tool") continue;

      const toolCallId = msg.tool_call_id;
      if (typeof toolCallId !== "string") continue;

      const session = findSessionByPendingToolCall(toolCallId);
      if (!session) continue;

      const content = msg.content;
      let parsed: unknown;
      if (typeof content === "string") {
        try {
          parsed = JSON.parse(content);
        } catch {
          parsed = content;
        }
      } else {
        parsed = content;
      }

      session.handle.resumeToolResult(toolCallId, parsed);

      // Mark this request as resuming a specific execution session.
      // Replace messages with a simple dummy so AI SDK doesn't choke on
      // content:null assistant messages.
      setResumeSessionId(ctx.request, session.executionId);
      ctx.request.messages = [{ role: "user", content: "__code_execution_resume__" }];
      return;
    }
  };

  // ── onResult handler: start or continue a code execution ──

  const match =
    config.match ??
    (shouldRewrite
      ? (tc: ProgrammaticToolLoopToolCall) => tc.toolName === codeToolName
      : () => true);

  const getCode = config.getCode ?? getDefaultJavaScriptCode;

  return {
    name: config.name ?? "js-code-execution",
    middleware: [rewriteMiddleware, resumeMiddleware],
    onResult: async (ctx) => {
      // ── Resume path: middleware already resolved a session ──
      const resumeExecutionId = getResumeSessionId(ctx.request);
      if (resumeExecutionId) {
        const session = sessions.get(resumeExecutionId);
        if (!session) return;

        const handle = session.handle;
        await handle.waitForSuspendOrComplete();

        if (handle.state === "waiting_for_tool_result" && handle.pendingToolCall) {
          const pending = handle.pendingToolCall;
          ctx.overrideResult = {
            text: null,
            toolCalls: [
              {
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                input: pending.args,
              },
            ],
            finishReason: "tool-calls",
            usage: ctx.result.usage,
          };
          return;
        }

        if (handle.state === "completed" && handle.result) {
          const finalValue = config.mapExecutionResult
            ? await config.mapExecutionResult(handle.result)
            : handle.result.value;

          const serialized = defaultSerializeToolResult(finalValue);
          sessions.delete(session.executionId);
          handle.dispose();

          const nextMessages = session.modelRequestMessages
            ? cloneValue(session.modelRequestMessages)
            : [];
          if (session.assistantToolCallMessage) {
            nextMessages.push(cloneValue(session.assistantToolCallMessage));
          }

          if (session.executionToolCallId) {
            nextMessages.push({
              role: "tool",
              tool_call_id: session.executionToolCallId,
              content: serialized,
            });
          } else {
            nextMessages.push({
              role: "user",
              content: `Code execution completed. Result:\n${serialized}`,
            });
          }

          const nextRequest: OpenAIChatCompletionRequest = {
            ...stripResumeSessionId(ctx.request),
            messages: nextMessages,
          };

          const modelResult = await ctx.runModel(nextRequest, {
            skipPlugins: true,
          });
          ctx.overrideResult = modelResult;
          return;
        }

        if (handle.state === "error") {
          sessions.delete(session.executionId);
          handle.dispose();
          throw handle.error ?? new Error("Code execution failed");
        }
        return;
      }

      // ── Start path: new code execution ──
      const result = ctx.result;
      const toolCalls = (result.toolCalls ?? [])
        .map((tc) => normalizeToolCall(tc))
        .filter((tc): tc is ProgrammaticToolLoopToolCall => Boolean(tc));

      if (toolCalls.length === 0) return;

      // Find the first tool call that matches the code execution pattern.
      const codeToolCall = toolCalls.find((tc) =>
        match(tc, {
          iteration: 0,
          request: ctx.request,
          result,
        }),
      );
      if (!codeToolCall) return;

      const source = getCode(codeToolCall);
      if (!source) return;

      const executionId = generateId();
      const session = await startSession(executionId, source, codeToolCall.input);
      session.executionToolCallId = codeToolCall.toolCallId;
      session.modelRequestMessages = cloneValue(ctx.request.messages);
      session.assistantToolCallMessage = toAssistantToolCallMessage(result);

      const handle = session.handle;
      await handle.waitForSuspendOrComplete();

      if (handle.state === "waiting_for_tool_result" && handle.pendingToolCall) {
        const pending = handle.pendingToolCall;

        // Respond to the OpenAI caller with the tool call the sandbox needs.
        ctx.overrideResult = {
          text: null,
          toolCalls: [
            {
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              input: pending.args,
            },
          ],
          finishReason: "tool-calls",
          usage: result.usage,
          // Smuggle the execution ID so the middleware can find the session later.
          _executionId: executionId,
        };
        return;
      }

      if (handle.state === "completed" && handle.result) {
        // The code ran to completion without needing any external tools.
        // Feed the result back to the model as a tool_result via runModel.
        const finalValue = config.mapExecutionResult
          ? await config.mapExecutionResult(handle.result)
          : handle.result.value;

        const serialized = defaultSerializeToolResult(finalValue);

        const assistantMsg = toAssistantToolCallMessage(result);
        if (!assistantMsg) return;

        const nextRequest: OpenAIChatCompletionRequest = {
          ...ctx.request,
          messages: [
            ...ctx.request.messages,
            assistantMsg,
            {
              role: "tool",
              tool_call_id: codeToolCall.toolCallId,
              content: serialized,
            },
          ],
        };

        const modelResult = await ctx.runModel(nextRequest, {
          skipPlugins: true,
        });
        ctx.overrideResult = modelResult;
        sessions.delete(executionId);
        handle.dispose();
        return;
      }

      if (handle.state === "error") {
        sessions.delete(executionId);
        handle.dispose();
        throw handle.error ?? new Error("Code execution failed");
      }
    },
  };
}

/**
 * Resume middleware factory. Call this once and pass the returned middleware
 * to the AiyoAdapter config. It shares the session store with the plugin
 * created by `createJavaScriptCodeExecutionPlugin`.
 *
 * NOTE: The plugin already includes this middleware internally, so you
 * don't need to add it separately.
 */

// Also keep the old helpers for backward compat
export function createJavaScriptProgrammaticToolLoopPlugin(
  config: JavaScriptCodeExecutionPluginConfig,
): AiyoPlugin {
  return createJavaScriptCodeExecutionPlugin(config);
}
