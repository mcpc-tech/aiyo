import {
  ACP2OpenAI as CoreACP2OpenAI,
  type ACP2ListModelsResolver,
  type ACP2OpenAIConfig as CoreACP2OpenAIConfig,
  type ACP2ProviderRuntime,
  type ACP2RuntimeFactory,
  type ACP2ToolCallNormalizer,
  type ACP2ToolTransformer,
  type OpenAIChatCompletionRequest,
  type RawToolCall,
} from "@yaonyan/acp2openai-compatible";
import {
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME,
  acpTools,
  createACPProvider,
  type ACPProviderSettings,
} from "@mcpc-tech/acp-ai-provider";

export interface ACP2OpenAIConfig extends Omit<
  CoreACP2OpenAIConfig,
  "runtimeFactory" | "listModels" | "transformTools" | "normalizeToolCall"
> {
  defaultACPConfig?: ACPProviderSettings;
  runtimeFactory?: ACP2RuntimeFactory;
  listModels?: ACP2ListModelsResolver;
  transformTools?: ACP2ToolTransformer;
  normalizeToolCall?: ACP2ToolCallNormalizer;
}

function getRequestACPConfig(
  request: OpenAIChatCompletionRequest,
): ACPProviderSettings | undefined {
  const value = request.extra_body?.acpConfig;
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as ACPProviderSettings;
}

function resolveACPConfig(
  request: OpenAIChatCompletionRequest,
  defaultACPConfig?: ACPProviderSettings,
): ACPProviderSettings {
  const acpConfig = getRequestACPConfig(request) ?? defaultACPConfig;
  if (!acpConfig) {
    throw new Error(
      "ACP session config is required (via extra_body.acpConfig or defaultACPConfig)",
    );
  }
  return acpConfig;
}

export function createACPRuntimeFactory(
  defaultACPConfig?: ACPProviderSettings,
): ACP2RuntimeFactory {
  return ({ request, modelId }) => {
    const provider = createACPProvider(resolveACPConfig(request, defaultACPConfig));
    const providerTools = provider.tools as Record<string, any> | undefined;

    const runtime: ACP2ProviderRuntime = {
      model: provider.languageModel(modelId),
      modelName: modelId,
      tools: providerTools,
      cleanup: () => {
        provider.cleanup();
      },
    };

    return runtime;
  };
}

function unwrapACPToolCall(toolCall: RawToolCall): RawToolCall {
  if (toolCall.toolName !== ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME) {
    return toolCall;
  }

  const payload =
    typeof toolCall.input === "object" && toolCall.input !== null
      ? toolCall.input
      : typeof toolCall.args === "object" && toolCall.args !== null
        ? toolCall.args
        : {};

  const nestedToolName =
    (typeof payload.toolName === "string" && payload.toolName) ||
    (typeof payload.name === "string" && payload.name) ||
    toolCall.toolName;

  const nestedInput =
    typeof payload.args === "object" && payload.args !== null
      ? (payload.args as Record<string, unknown>)
      : typeof payload.arguments === "object" && payload.arguments !== null
        ? (payload.arguments as Record<string, unknown>)
        : {};

  return {
    ...toolCall,
    toolName: nestedToolName,
    input: nestedInput,
    toolCallId:
      (typeof payload.toolCallId === "string" && payload.toolCallId) || toolCall.toolCallId,
  };
}

export function createACPToolCallNormalizer(base?: ACP2ToolCallNormalizer): ACP2ToolCallNormalizer {
  return (toolCall) => {
    const normalized = unwrapACPToolCall(toolCall);
    return base ? base(normalized) : normalized;
  };
}

export function createACPToolTransformer(base?: ACP2ToolTransformer): ACP2ToolTransformer {
  return (tools, context) => {
    const transformed = base ? base(tools, context) : tools;
    if (!transformed) return undefined;
    return acpTools(transformed as Record<string, any>);
  };
}

export function createACPListModelsResolver(
  defaultACPConfig?: ACPProviderSettings,
  defaultModel?: string,
): ACP2ListModelsResolver {
  return async () => {
    if (!defaultACPConfig) {
      return defaultModel ? [defaultModel, "default"] : ["default"];
    }

    const provider = createACPProvider(defaultACPConfig);
    try {
      const sessionInfo = await provider.initSession();
      return [
        ...(sessionInfo.models?.availableModels ?? []).map((model) => model.modelId),
        sessionInfo.models?.currentModelId,
        defaultModel,
        "default",
      ].filter((id): id is string => Boolean(id));
    } finally {
      provider.cleanup();
    }
  };
}

function enhanceConfig(config: ACP2OpenAIConfig = {}): CoreACP2OpenAIConfig {
  return {
    ...config,
    runtimeFactory: config.runtimeFactory ?? createACPRuntimeFactory(config.defaultACPConfig),
    listModels:
      config.listModels ??
      createACPListModelsResolver(config.defaultACPConfig, config.defaultModel),
    transformTools: createACPToolTransformer(config.transformTools),
    normalizeToolCall: createACPToolCallNormalizer(config.normalizeToolCall),
  };
}

export class ACP2OpenAI extends CoreACP2OpenAI {
  constructor(config: ACP2OpenAIConfig = {}) {
    super(enhanceConfig(config));
  }
}

export function createACP2OpenAI(config?: ACP2OpenAIConfig): ACP2OpenAI {
  return new ACP2OpenAI(config);
}

export type { ACPProviderSettings };
export * from "@yaonyan/acp2openai-compatible";
