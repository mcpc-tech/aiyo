import { mkdirSync, readFileSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runInteractiveCommand } from "./process-utils.js";

const PROVIDER_ID = "aiyo";
const MODEL_MARKER = "_aiyo_launch";

export interface OpenCodeLaunchOptions {
  baseURL: string;
  model: string;
  cwd: string;
  extraArgs: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): JsonRecord {
  if (!existsSync(filePath)) return {};

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonWithBackup(filePath: string, data: JsonRecord) {
  mkdirSync(dirname(filePath), { recursive: true });

  if (existsSync(filePath)) {
    copyFileSync(filePath, `${filePath}.bak`);
  }

  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function updateRecentState(statePath: string, model: string) {
  const state = readJsonFile(statePath);
  const recent = Array.isArray(state.recent) ? state.recent : [];

  const nextRecent = [
    {
      providerID: PROVIDER_ID,
      modelID: model,
    },
    ...recent.filter((entry) => {
      if (!isRecord(entry)) return true;
      return !(entry.providerID === PROVIDER_ID && entry.modelID === model);
    }),
  ].slice(0, 10);

  state.recent = nextRecent;
  if (!Array.isArray(state.favorite)) state.favorite = [];
  if (!isRecord(state.variant)) state.variant = {};

  writeJsonWithBackup(statePath, state);
}

function updateConfig(configPath: string, baseURL: string, model: string) {
  const config = readJsonFile(configPath);
  config.$schema = "https://opencode.ai/config.json";

  const provider = isRecord(config.provider) ? config.provider : {};
  const currentProvider = isRecord(provider[PROVIDER_ID]) ? provider[PROVIDER_ID] : {};
  const currentModels = isRecord(currentProvider.models) ? currentProvider.models : {};

  for (const [name, value] of Object.entries(currentModels)) {
    if (isRecord(value) && value[MODEL_MARKER] === true) {
      delete currentModels[name];
    }
  }

  currentModels[model] = {
    name: model,
    [MODEL_MARKER]: true,
  };

  provider[PROVIDER_ID] = {
    npm: "@ai-sdk/openai-compatible",
    name: "AiyoAdapter",
    options: {
      baseURL: `${baseURL}/v1`,
    },
    models: currentModels,
  };

  config.provider = provider;
  config.model = `${PROVIDER_ID}/${model}`;

  writeJsonWithBackup(configPath, config);
}

export async function launchOpenCode(options: OpenCodeLaunchOptions): Promise<void> {
  const home = homedir();
  const configPath = join(home, ".config", "opencode", "opencode.json");
  const statePath = join(home, ".local", "state", "opencode", "model.json");

  updateConfig(configPath, options.baseURL, options.model);
  updateRecentState(statePath, options.model);

  await runInteractiveCommand("opencode", options.extraArgs, {
    cwd: options.cwd,
  });
}
