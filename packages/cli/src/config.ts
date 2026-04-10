import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  acpCommand: string;
  acpArgs: string[];
  acpEnv?: Record<string, string>;
  cwd: string;
}

export interface LaunchOverrides {
  host?: string;
  port?: number;
  model?: string;
  acpCommand?: string;
  acpArgs?: string[];
  cwd?: string;
}

function loadFileConfig(): FileConfig {
  const configPath = resolve(
    process.env.ACP2OPENAI_CONFIG || "examples/hono-server/acp2openai.config.json",
  );
  if (!existsSync(configPath)) return {};

  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as FileConfig;
  } catch (error) {
    console.warn(`[acp2openai-cli] Failed to parse config file ${configPath}:`, error);
    return {};
  }
}

function parseArgList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
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

  return {
    host: overrides.host || process.env.HOST || file.host || "127.0.0.1",
    port: Number(overrides.port || process.env.PORT || file.port || 3456),
    model: overrides.model || process.env.ACP_MODEL || file.defaultModel || "default",
    acpCommand: overrides.acpCommand || process.env.ACP_COMMAND || file.acp?.command || "codebuddy",
    acpArgs: overrides.acpArgs || parseACPArgs(process.env.ACP_ARGS, file.acp?.args || ["--acp"]),
    acpEnv: file.acp?.env,
    cwd: overrides.cwd || process.env.ACP_CWD || file.acp?.cwd || process.cwd(),
  };
}
