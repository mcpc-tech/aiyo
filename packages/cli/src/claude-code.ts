import { runInteractiveCommand } from "./process-utils.js";

interface ClaudeCodeLaunchOptions {
  baseURL: string;
  model: string;
  cwd: string;
  extraArgs: string[];
}

function buildClaudeEnv(baseURL: string, model: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || "dummy",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "dummy",
    ANTHROPIC_BASE_URL: baseURL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_REASONING_MODEL: model,
  };
}

function buildClaudeSettings(baseURL: string, model: string): string {
  return JSON.stringify({
    env: {
      ANTHROPIC_AUTH_TOKEN: "dummy",
      ANTHROPIC_API_KEY: "dummy",
      ANTHROPIC_BASE_URL: baseURL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_REASONING_MODEL: model,
    },
  });
}

export function launchClaudeCode(options: ClaudeCodeLaunchOptions): void {
  const args = [
    "--settings",
    buildClaudeSettings(options.baseURL, options.model),
    ...options.extraArgs,
  ];

  runInteractiveCommand("claude", args, {
    cwd: options.cwd,
    env: buildClaudeEnv(options.baseURL, options.model),
  });
}
