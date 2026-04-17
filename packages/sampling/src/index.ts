import {
  AiyoAdapter as CoreAiyoAdapter,
  type ACP2ListModelsResolver,
  type AiyoConfig as CoreAiyoConfig,
  type ACP2ProviderRuntime,
  type ACP2RuntimeFactory,
} from "@mcpc-tech/aiyo";
import {
  createMCPSamplingProvider,
  type MCPSamplingProviderSettings,
} from "@mcpc-tech/mcp-sampling-ai-provider";

// ── Config ──────────────────────────────────────────────────────────────────

export interface AiyoConfig extends Omit<CoreAiyoConfig, "runtimeFactory" | "listModels"> {
  defaultSamplingConfig?: MCPSamplingProviderSettings;
  runtimeFactory?: ACP2RuntimeFactory;
  listModels?: ACP2ListModelsResolver;
}

// ── Runtime factory ─────────────────────────────────────────────────────────

export function createSamplingRuntimeFactory(
  defaultSamplingConfig?: MCPSamplingProviderSettings,
): ACP2RuntimeFactory {
  return ({ modelId }) => {
    const provider = createMCPSamplingProvider(defaultSamplingConfig);

    const runtime: ACP2ProviderRuntime = {
      model: provider.languageModel({
        modelPreferences: {
          hints: modelId ? [{ name: modelId }] : [],
        },
      }),
      modelName: modelId ?? "default",
      tools: provider.tools as Record<string, unknown> | undefined,
    };

    return runtime;
  };
}

// ── List models resolver ────────────────────────────────────────────────────

export function createSamplingListModelsResolver(defaultModel?: string): ACP2ListModelsResolver {
  return async () => [defaultModel, "default"].filter((id): id is string => Boolean(id));
}

// ── Adapter ─────────────────────────────────────────────────────────────────

function enhanceConfig(config: AiyoConfig = {}): CoreAiyoConfig {
  return {
    ...config,
    runtimeFactory:
      config.runtimeFactory ?? createSamplingRuntimeFactory(config.defaultSamplingConfig),
    listModels: config.listModels ?? createSamplingListModelsResolver(config.defaultModel),
  };
}

export class AiyoAdapter extends CoreAiyoAdapter {
  constructor(config: AiyoConfig = {}) {
    super(enhanceConfig(config));
  }
}

export function createAiyo(config?: AiyoConfig): AiyoAdapter {
  return new AiyoAdapter(config);
}

// ── Re-exports ──────────────────────────────────────────────────────────────

export type { MCPSamplingProviderSettings };
export * from "@mcpc-tech/aiyo";
