#!/usr/bin/env node

import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { launchClaudeCode } from "./claude-code.js";
import { launchOpenCode } from "./opencode.js";
import { resolveLaunchConfig } from "./config.js";
import { startProxyServer } from "./proxy-server.js";

// Load .env from cwd, then package root (first found wins)
for (const envPath of [resolve(process.cwd(), ".env"), resolve(import.meta.dirname, "../../.env")]) {
  const result = dotenvConfig({ path: envPath, override: false });
  if (!result.error) {
    console.error(`[aiyo-cli] Loaded env from ${envPath}`);
    break;
  }
}

import type { ProviderType } from "./config.js";

interface ParsedArgs {
  command?: string;
  integration?: string;
  model?: string;
  host?: string;
  port?: number;
  cwd?: string;
  provider?: ProviderType;
  ptc?: boolean;
  upstreamBaseURL?: string;
  upstreamApiKey?: string;
  acpCommand?: string;
  acpArgs?: string[];
  extraArgs: string[];
}

function printHelp() {
  console.log(`aiyo CLI

Usage:
  aiyo serve [options]                     Start proxy server only (API mode)
  aiyo launch opencode [options] [-- ...]  Start proxy + launch opencode
  aiyo launch claude [options] [-- ...]    Start proxy + launch claude

Options:
  --provider <type>           Provider: openai (default) or acp (env: AIYO_PROVIDER)
  --model <name>              Model name (env: OPENAI_MODEL)
  --host <host>               Bind host (default: 127.0.0.1)
  --port <port>               Bind port (default: 3456)
  --cwd <path>                Working directory (launch only)
  --ptc                       Enable PTC plugin — intercepts all tools (env: AIYO_PTC=true)

  OpenAI provider options:
  --upstream-url <url>        Upstream base URL (env: OPENAI_BASE_URL)
  --upstream-key <key>        Upstream API key (env: OPENAI_API_KEY)

  ACP provider options:
  --acp-command <cmd>         ACP command (env: ACP_COMMAND, default: opencode)
  --acp-args <args>           ACP args JSON or space-separated (env: ACP_ARGS, default: acp)

  -h, --help                  Show help
`);
}

function expectValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const dashIndex = argv.indexOf("--");
  const head = dashIndex >= 0 ? argv.slice(0, dashIndex) : argv;
  const extraArgs = dashIndex >= 0 ? argv.slice(dashIndex + 1) : [];

  const parsed: ParsedArgs = {
    command: head[0],
    extraArgs,
  };

  // For "launch", head[1] is the integration name (not a flag)
  let startIndex = 1;
  if (head[0] === "launch" && head[1] && !head[1].startsWith("-")) {
    parsed.integration = head[1];
    startIndex = 2;
  }

  for (let index = startIndex; index < head.length; index += 1) {
    const token = head[index];

    switch (token) {
      case "--model":
        parsed.model = expectValue(head, index, token);
        index += 1;
        break;
      case "--host":
        parsed.host = expectValue(head, index, token);
        index += 1;
        break;
      case "--port":
        parsed.port = Number(expectValue(head, index, token));
        index += 1;
        break;
      case "--cwd":
        parsed.cwd = expectValue(head, index, token);
        index += 1;
        break;
      case "--provider":
        parsed.provider = expectValue(head, index, token) as ProviderType;
        index += 1;
        break;
      case "--upstream-url":
        parsed.upstreamBaseURL = expectValue(head, index, token);
        index += 1;
        break;
      case "--upstream-key":
        parsed.upstreamApiKey = expectValue(head, index, token);
        index += 1;
        break;
      case "--acp-command":
        parsed.acpCommand = expectValue(head, index, token);
        index += 1;
        break;
      case "--acp-args":
        parsed.acpArgs = expectValue(head, index, token).split(/\s+/).filter(Boolean);
        index += 1;
        break;
      case "--ptc":
        parsed.ptc = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return parsed;
}

function normalizeIntegration(integration: string | undefined): "opencode" | "claude" {
  if (integration === "opencode") return integration;
  if (integration === "claude" || integration === "claude-code") {
    return "claude";
  }

  throw new Error(
    `Unsupported integration: ${integration || "<empty>"}. Currently supported: opencode, claude`,
  );
}

async function runServe(parsed: ParsedArgs): Promise<void> {
  const config = resolveLaunchConfig({
    host: parsed.host,
    port: parsed.port,
    model: parsed.model,
    provider: parsed.provider,
    upstreamBaseURL: parsed.upstreamBaseURL,
    upstreamApiKey: parsed.upstreamApiKey,
    acpCommand: parsed.acpCommand,
    acpArgs: parsed.acpArgs,
    ptc: parsed.ptc,
    cwd: parsed.cwd,
  });

  const server = await startProxyServer(config);

  console.error(`[aiyo-cli] Server running at ${server.baseURL}`);
  console.error(`[aiyo-cli] Model: ${config.model}`);
  console.error(`[aiyo-cli] PTC: ${config.ptc ? "enabled" : "disabled"}`);
  console.error(`[aiyo-cli] Endpoints: /health /v1/models /v1/chat/completions /v1/responses /v1/messages`);

  // Keep alive until SIGINT/SIGTERM
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });

  await server.close();
}

async function runLaunch(parsed: ParsedArgs): Promise<void> {
  const integration = normalizeIntegration(parsed.integration);

  const config = resolveLaunchConfig({
    host: parsed.host,
    port: parsed.port,
    model: parsed.model,
    provider: parsed.provider,
    upstreamBaseURL: parsed.upstreamBaseURL,
    upstreamApiKey: parsed.upstreamApiKey,
    acpCommand: parsed.acpCommand,
    acpArgs: parsed.acpArgs,
    ptc: parsed.ptc,
    cwd: parsed.cwd,
  });

  console.error(`[aiyo-cli] Starting proxy at http://${config.host}:${config.port}`);
  console.error(`[aiyo-cli] Model: ${config.model}`);
  console.error(`[aiyo-cli] PTC: ${config.ptc ? "enabled" : "disabled"}`);
  console.error(`[aiyo-cli] Launch target: ${integration}`);

  const server = await startProxyServer(config);

  try {
    if (integration === "opencode") {
      await launchOpenCode({
        baseURL: server.baseURL,
        model: config.model,
        cwd: config.cwd,
        extraArgs: parsed.extraArgs,
      });
      return;
    }

    await launchClaudeCode({
      baseURL: server.baseURL,
      model: config.model,
      cwd: config.cwd,
      extraArgs: parsed.extraArgs,
    });
  } finally {
    await server.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    printHelp();
    return;
  }

  const parsed = parseArgs(argv);

  if (parsed.command === "serve") {
    await runServe(parsed);
    return;
  }

  if (parsed.command !== "launch") {
    throw new Error(`Unsupported command: ${parsed.command || "<empty>"}. Use 'serve' or 'launch'`);
  }

  await runLaunch(parsed);
}

main().catch((error) => {
  console.error(`[aiyo-cli] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
