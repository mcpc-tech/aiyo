import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ProviderType = "openai" | "acp";

interface FileConfig {
  port?: number;
  host?: string;
  defaultModel?: string;
  acp?: {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
}

export interface LaunchConfig {
  host: string;
  port: number;
  model: string;
  provider: ProviderType;
  // openai provider
  upstreamBaseURL?: string;
  upstreamApiKey?: string;
  // acp provider
  acpCommand?: string;
  acpArgs?: string[];
  acpEnv?: Record<string, string>;
  // ptc
  ptc?: boolean;
  ptcToolNames?: string[];
  cwd: string;
}

export interface LaunchOverrides {
  host?: string;
  port?: number;
  model?: string;
  provider?: ProviderType;
  upstreamBaseURL?: string;
  upstreamApiKey?: string;
  acpCommand?: string;
  acpArgs?: string[];
  ptc?: boolean;
  cwd?: string;
}

function loadFileConfig(): FileConfig {
  const configPath = resolve(
    process.env.AIYO_CONFIG || "examples/hono-server/aiyo.config.json",
  );
  if (!existsSync(configPath)) return {};

  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as FileConfig;
  } catch (error) {
    console.warn(`[aiyo-cli] Failed to parse config file ${configPath}:`, error);
    return {};
  }
}

function parseArgList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).map((p) => p.trim()).filter(Boolean);
}

export function parseACPArgs(raw: string | undefined, fallback?: string[]): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return parseArgList(raw);
    }
  }
  return fallback ?? [];
}

export function resolveLaunchConfig(overrides: LaunchOverrides = {}): LaunchConfig {
  const file = loadFileConfig();

  const provider = (overrides.provider ||
    (process.env.AIYO_PROVIDER as ProviderType | undefined) ||
    (file.acp?.command ? "acp" : "openai")) as ProviderType;

  return {
    host: overrides.host || process.env.HOST || file.host || "127.0.0.1",
    port: Number(overrides.port || process.env.PORT || file.port || 3456),
    model: overrides.model || process.env.OPENAI_MODEL || file.defaultModel || "gpt-4o-mini",
    provider,
    // openai
    upstreamBaseURL: overrides.upstreamBaseURL || process.env.OPENAI_BASE_URL,
    upstreamApiKey: overrides.upstreamApiKey || process.env.OPENAI_API_KEY,
    // acp — env vars: ACP_COMMAND, ACP_ARGS
    acpCommand: overrides.acpCommand || process.env.ACP_COMMAND || file.acp?.command || "opencode",
    acpArgs: overrides.acpArgs || parseACPArgs(process.env.ACP_ARGS, file.acp?.args || ["acp"]),
    acpEnv: file.acp?.env,
    // ptc
    ptc: overrides.ptc ?? (process.env.AIYO_PTC === "true"),
    cwd: overrides.cwd || process.env.ACP_CWD || file.acp?.cwd || process.cwd(),
  };
}
