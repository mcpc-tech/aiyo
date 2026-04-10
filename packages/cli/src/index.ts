#!/usr/bin/env node

import { launchClaudeCode } from "./claude-code.js";
import { launchOpenCode } from "./opencode.js";
import { resolveLaunchConfig, parseACPArgs } from "./config.js";
import { startProxyServer } from "./proxy-server.js";

interface ParsedArgs {
  command?: string;
  integration?: string;
  model?: string;
  host?: string;
  port?: number;
  cwd?: string;
  acpCommand?: string;
  acpArgs?: string[];
  extraArgs: string[];
}

function printHelp() {
  console.log(`aiyo CLI

Usage:
  aiyo launch opencode [options] [-- extra args]
  aiyo launch claude [options] [-- extra args]

Supported integrations:
  - opencode
  - claude (alias: claude-code)

Options:
  --model <name>          Model to expose via the proxy
  --host <host>           Host to bind the local proxy server
  --port <port>           Port to bind the local proxy server
  --cwd <path>            Working directory for the ACP session and launched client
  --acp-command <cmd>     ACP runtime command
  --acp-arg <value>       Repeatable ACP arg
  --acp-args <value>      ACP args as JSON array or space-separated string
  -h, --help              Show help
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
    integration: head[1],
    extraArgs,
  };

  for (let index = 2; index < head.length; index += 1) {
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
      case "--acp-command":
        parsed.acpCommand = expectValue(head, index, token);
        index += 1;
        break;
      case "--acp-arg": {
        const value = expectValue(head, index, token);
        parsed.acpArgs = [...(parsed.acpArgs || []), value];
        index += 1;
        break;
      }
      case "--acp-args":
        parsed.acpArgs = parseACPArgs(expectValue(head, index, token));
        index += 1;
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

async function runLaunch(parsed: ParsedArgs): Promise<void> {
  const integration = normalizeIntegration(parsed.integration);

  const config = resolveLaunchConfig({
    host: parsed.host,
    port: parsed.port,
    model: parsed.model,
    acpCommand: parsed.acpCommand,
    acpArgs: parsed.acpArgs,
    cwd: parsed.cwd,
  });

  console.error(`[aiyo-cli] Starting proxy at http://${config.host}:${config.port}`);
  console.error(`[aiyo-cli] ACP runtime: ${config.acpCommand} ${config.acpArgs.join(" ")}`);
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

  if (parsed.command !== "launch") {
    throw new Error(`Unsupported command: ${parsed.command || "<empty>"}`);
  }

  await runLaunch(parsed);
}

main().catch((error) => {
  console.error(`[aiyo-cli] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
