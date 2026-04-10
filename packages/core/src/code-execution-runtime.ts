import { Sandbox, type SandboxConfig } from "@mcpc-tech/handle-sandbox";
import type {
  CodeExecutionPendingToolCall,
  CodeExecutionSessionState,
  JavaScriptProgrammaticExecutionResult,
  JavaScriptProgrammaticToolCallRecord,
} from "./programmatic-tool-loop-plugin.js";

export interface CodeExecutionRuntimeHandle {
  readonly executionId: string;
  readonly state: CodeExecutionSessionState;
  readonly pendingToolCall?: CodeExecutionPendingToolCall;
  readonly logs: string[];
  readonly toolHistory: JavaScriptProgrammaticToolCallRecord[];
  readonly result?: JavaScriptProgrammaticExecutionResult;
  readonly error?: Error;
  waitForSuspendOrComplete(): Promise<void>;
  resumeToolResult(toolCallId: string, value: unknown): void;
  dispose(): void;
}

export interface CreateCodeExecutionRuntimeParams {
  executionId: string;
  source: string;
  toolCallInput: Record<string, unknown>;
}

export interface CodeExecutionRuntimeFactory {
  createExecution(params: CreateCodeExecutionRuntimeParams): Promise<CodeExecutionRuntimeHandle>;
}

export interface DenoCodeExecutionRuntimeFactoryConfig {
  name?: string;
  timeoutMs: number;
  maxLogs: number;
  toolNames: string[];
  sandboxGlobals?: () => Record<string, unknown> | undefined;
  denoSandbox?: SandboxConfig;
}

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneValueIfPossible<T>(value: T): T {
  try {
    return cloneValue(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringifyLogValue(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pushLog(logs: string[], maxLogs: number, values: unknown[]): void {
  if (logs.length >= maxLogs) return;
  const line = values.map((value) => stringifyLogValue(value)).join(" ");
  logs.push(line);
}

function isValidJavaScriptIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function toJavaScriptLiteral(value: unknown, label: string): string {
  if (value === undefined) return "undefined";

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error(`Failed to serialize ${label}`);
    }
    return serialized;
  } catch (error) {
    throw new Error(
      `Sandbox global \`${label}\` must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reflection: Function.prototype.toString requires any[] signature
function toFunctionLiteral(fn: (...args: any[]) => unknown, label: string): string {
  const serialized = fn.toString();
  if (!serialized || serialized.includes("[native code]")) {
    throw new Error(
      `Sandbox function \`${label}\` must be serializable with Function.prototype.toString()`,
    );
  }
  return serialized;
}

function buildWrappedSource(
  source: string,
  toolCallInput: Record<string, unknown>,
  sandboxGlobals: Record<string, unknown> | undefined,
): string {
  const lines: string[] = [];

  lines.push(`const input = ${toJavaScriptLiteral(toolCallInput, "input")};`);

  for (const [name, value] of Object.entries(sandboxGlobals ?? {})) {
    if (!isValidJavaScriptIdentifier(name)) {
      throw new Error(`Sandbox global name \`${name}\` is not a valid JavaScript identifier`);
    }

    if (typeof value === "function") {
      lines.push(
        `const ${name} = ${toFunctionLiteral(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- serialising sandbox globals requires any cast
          value as (...args: any[]) => unknown,
          name,
        )};`,
      );
      continue;
    }

    lines.push(`const ${name} = ${toJavaScriptLiteral(value, name)};`);
  }

  lines.push(`
const tools = new Proxy({}, {
  get(_target, toolName) {
    return async (args = {}) => {
      return await __ptc_call_tool(String(toolName), args ?? {});
    };
  },
});
`);

  lines.push(source);

  return lines.join("\n\n");
}

class DenoSandboxExecutionHandle implements CodeExecutionRuntimeHandle {
  public readonly executionId: string;
  public state: CodeExecutionSessionState = "running";
  public pendingToolCall?: CodeExecutionPendingToolCall;
  public readonly logs: string[] = [];
  public readonly toolHistory: JavaScriptProgrammaticToolCallRecord[] = [];
  public result?: JavaScriptProgrammaticExecutionResult;
  public error?: Error;

  private readonly sandbox: Sandbox;
  private readonly timeoutMs: number;
  private completionPromise: Promise<JavaScriptProgrammaticExecutionResult>;
  private resolvePendingToolResult?: (value: unknown) => void;
  private stateChangeNotify?: () => void;
  private stateChangePromise?: Promise<void>;
  private disposed = false;
  private readonly pendingQueue: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    resolve: (value: unknown) => void;
  }> = [];

  constructor(
    params: CreateCodeExecutionRuntimeParams,
    config: DenoCodeExecutionRuntimeFactoryConfig,
  ) {
    this.executionId = params.executionId;
    this.timeoutMs = Math.max(1, config.timeoutMs);

    this.sandbox = new Sandbox({
      timeout: this.timeoutMs,
      ...config.denoSandbox,
      onLog: (text, level) => {
        pushLog(this.logs, config.maxLogs, [text]);
        config.denoSandbox?.onLog?.(text, level);
      },
    });

    this.sandbox.registerHandler("__ptc_call_tool", async (toolName: unknown, args: unknown) => {
      const normalizedToolName =
        typeof toolName === "string" && toolName.length > 0 ? toolName : String(toolName);
      const normalizedArgs = cloneValue(normalizeObject(args));
      const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return await new Promise<unknown>((resolve) => {
        this.pendingQueue.push({
          toolCallId,
          toolName: normalizedToolName,
          args: normalizedArgs,
          resolve,
        });
        this.drainNextPending();
      });
    });

    const wrappedSource = buildWrappedSource(
      params.source,
      params.toolCallInput,
      config.sandboxGlobals?.(),
    );

    this.sandbox.start();
    this.completionPromise = this.sandbox
      .execute(wrappedSource)
      .then((executionResult) => {
        if (this.logs.length === 0 && Array.isArray(executionResult.logs)) {
          for (const line of executionResult.logs.slice(0, config.maxLogs)) {
            pushLog(this.logs, config.maxLogs, [line]);
          }
        }

        if (executionResult.error) {
          throw new Error(executionResult.error);
        }

        const result = {
          source: params.source,
          value: executionResult.result,
          logs: cloneValue(this.logs),
          toolHistory: cloneValueIfPossible(this.toolHistory),
        } satisfies JavaScriptProgrammaticExecutionResult;

        this.state = "completed";
        this.result = result;
        this.notifyStateChanged();
        return result;
      })
      .catch((error) => {
        this.state = "error";
        this.error = error instanceof Error ? error : new Error(String(error));
        this.notifyStateChanged();
        throw this.error;
      })
      .finally(() => {
        this.sandbox.stop();
      });
  }

  async waitForSuspendOrComplete(): Promise<void> {
    if (this.state !== "running") return;

    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), this.timeoutMs),
    );

    const winner = await Promise.race([
      this.completionPromise.then(
        () => "completed" as const,
        () => "errored" as const,
      ),
      this.stateChangePromise ??
        new Promise<"suspended">((resolve) => {
          this.stateChangeNotify = () => resolve("suspended");
          this.stateChangePromise = undefined;
        }),
      timeoutPromise,
    ]);

    if (winner === "timeout" && this.state === "running") {
      this.state = "error";
      this.error = new Error(`Code execution timed out after ${this.timeoutMs}ms`);
      this.notifyStateChanged();
      throw this.error;
    }
  }

  resumeToolResult(toolCallId: string, value: unknown): void {
    if (
      this.state !== "waiting_for_tool_result" ||
      !this.pendingToolCall ||
      this.pendingToolCall.toolCallId !== toolCallId ||
      !this.resolvePendingToolResult
    ) {
      throw new Error(`No pending tool call found for ${toolCallId}`);
    }

    this.resolvePendingToolResult(value);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sandbox.stop();
  }

  private drainNextPending(): void {
    if (this.pendingToolCall || this.pendingQueue.length === 0) return;

    const next = this.pendingQueue.shift()!;
    this.state = "waiting_for_tool_result";
    this.pendingToolCall = {
      toolCallId: next.toolCallId,
      toolName: next.toolName,
      args: next.args,
    };
    this.resolvePendingToolResult = (value: unknown) => {
      this.toolHistory.push({
        toolName: next.toolName,
        args: cloneValue(next.args),
        output: cloneValueIfPossible(value),
      });
      this.pendingToolCall = undefined;
      this.resolvePendingToolResult = undefined;
      this.state = "running";
      next.resolve(value);
      this.drainNextPending();
    };

    this.notifyStateChanged();
  }

  private notifyStateChanged(): void {
    if (this.stateChangeNotify) {
      this.stateChangeNotify();
      this.stateChangeNotify = undefined;
      return;
    }

    this.stateChangePromise = Promise.resolve();
  }
}

export function createDenoCodeExecutionRuntimeFactory(
  config: DenoCodeExecutionRuntimeFactoryConfig,
): CodeExecutionRuntimeFactory {
  return {
    async createExecution(params: CreateCodeExecutionRuntimeParams) {
      return new DenoSandboxExecutionHandle(params, config);
    },
  };
}
