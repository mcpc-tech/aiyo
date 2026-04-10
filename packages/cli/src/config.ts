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
  upstreamBaseURL?: string;
  upstreamApiKey?: string;
  ptc?: boolean;
  ptcToolNames?: string[];
  cwd: string;
}

export interface LaunchOverrides {
  host?: string;
  port?: number;
  model?: string;
  upstreamBaseURL?: string;
  upstreamApiKey?: string;
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

export function resolveLaunchConfig(overrides: LaunchOverrides = {}): LaunchConfig {
  const file = loadFileConfig();

  return {
    host: overrides.host || process.env.HOST || file.host || "127.0.0.1",
    port: Number(overrides.port || process.env.PORT || file.port || 3456),
    model: overrides.model || process.env.OPENAI_MODEL || file.defaultModel || "gpt-4o-mini",
    upstreamBaseURL: overrides.upstreamBaseURL || process.env.OPENAI_BASE_URL,
    upstreamApiKey: overrides.upstreamApiKey || process.env.OPENAI_API_KEY,
    ptc: overrides.ptc ?? (process.env.AIYO_PTC === "true"),
    cwd: overrides.cwd || process.env.ACP_CWD || file.acp?.cwd || process.cwd(),
  };
}
