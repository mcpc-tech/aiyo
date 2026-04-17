import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderType = "openai" | "acp" | "sampling";

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
  cwd: string;
  // openai provider
  upstreamBaseURL: string;
  upstreamApiKey: string;
  // acp provider
  acpCommand: string;
  acpArgs: string[];
  acpEnv?: Record<string, string>;
}

export interface LaunchOverrides {
  host?: string;
  port?: number;
  model?: string;
  provider?: ProviderType;
  cwd?: string;
  upstreamBaseURL?: string;
  upstreamApiKey?: string;
  acpCommand?: string;
  acpArgs?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadFileConfig(): FileConfig {
  const configPath = resolve(process.env.AIYO_CONFIG || "aiyo.config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as FileConfig;
  } catch (err) {
    console.warn(`[aiyo-cli] Failed to parse ${configPath}:`, err);
    return {};
  }
}

function parseArgs(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : fallback;
  } catch {
    return raw.trim().split(/\s+/).filter(Boolean);
  }
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

export function resolveLaunchConfig(overrides: LaunchOverrides = {}): LaunchConfig {
  const file = loadFileConfig();

  const provider: ProviderType =
    overrides.provider ||
    (process.env.AIYO_PROVIDER as ProviderType | undefined) ||
    (file.acp?.command ? "acp" : "openai");

  return {
    host: overrides.host || process.env.HOST || file.host || "127.0.0.1",
    port: Number(overrides.port || process.env.PORT || file.port || 3456),
    model: overrides.model || process.env.OPENAI_MODEL || file.defaultModel || "gpt-4o-mini",
    provider,
    cwd: overrides.cwd || process.env.ACP_CWD || file.acp?.cwd || process.cwd(),
    // openai
    upstreamBaseURL:
      overrides.upstreamBaseURL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    upstreamApiKey: overrides.upstreamApiKey || process.env.OPENAI_API_KEY || "dummy",
    // acp
    acpCommand: overrides.acpCommand || process.env.ACP_COMMAND || file.acp?.command || "opencode",
    acpArgs: overrides.acpArgs || parseArgs(process.env.ACP_ARGS, file.acp?.args || ["acp"]),
    acpEnv: file.acp?.env,
  };
}
