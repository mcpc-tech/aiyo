#!/usr/bin/env node

import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import cac from "cac";
import { resolveLaunchConfig, type ProviderType } from "./config.js";
import { startProxyServer } from "./proxy-server.js";
import { launchOpenCode } from "./opencode.js";
import { launchClaudeCode } from "./claude-code.js";

// ─── Load .env (cwd first, then package root) ─────────────────────────────────

for (const envPath of [
  resolve(process.cwd(), ".env"),
  resolve(import.meta.dirname, "../../.env"),
]) {
  const { error } = dotenvConfig({ path: envPath, override: false });
  if (!error) {
    console.error(`[aiyo] Loaded env from ${envPath}`);
    break;
  }
}

// ─── Shared option type ───────────────────────────────────────────────────────

interface SharedOptions {
  model?: string;
  host?: string;
  port?: number;
  provider?: ProviderType;
  ptc?: boolean;
  upstreamUrl?: string;
  upstreamKey?: string;
  acpCommand?: string;
  acpArgs?: string;
  cwd?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildConfig(opts: SharedOptions) {
  return resolveLaunchConfig({
    host: opts.host,
    port: opts.port,
    model: opts.model,
    provider: opts.provider,
    upstreamBaseURL: opts.upstreamUrl,
    upstreamApiKey: opts.upstreamKey,
    acpCommand: opts.acpCommand,
    acpArgs: opts.acpArgs?.trim().split(/\s+/).filter(Boolean),
    ptc: opts.ptc,
    cwd: opts.cwd,
  });
}

function addSharedOptions(cmd: ReturnType<typeof cli.command>) {
  return cmd
    .option("--provider <type>", "Provider: openai (default) | acp  [env: AIYO_PROVIDER]")
    .option("--model <name>", "Model name  [env: OPENAI_MODEL]")
    .option("--host <host>", "Bind host  [default: 127.0.0.1]")
    .option("--port <port>", "Bind port  [default: 3456]")
    .option("--ptc", "Enable PTC plugin — intercepts all tools  [env: AIYO_PTC=true]")
    .option("--upstream-url <url>", "OpenAI upstream base URL  [env: OPENAI_BASE_URL]")
    .option("--upstream-key <key>", "OpenAI upstream API key  [env: OPENAI_API_KEY]")
    .option("--acp-command <cmd>", "ACP command  [env: ACP_COMMAND, default: opencode]")
    .option("--acp-args <args>", "ACP args space-separated  [env: ACP_ARGS, default: 'acp']");
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const cli = cac("aiyo");

// serve
addSharedOptions(
  cli.command("serve", "Start OpenAI-compatible proxy server (API mode)"),
).action(async (opts: SharedOptions) => {
  const config = buildConfig(opts);
  const server = await startProxyServer(config);

  console.error(`[aiyo] Listening at ${server.baseURL}`);
  console.error(`[aiyo] model=${config.model}  provider=${config.provider}  ptc=${config.ptc}`);
  console.error(
    `[aiyo] endpoints: /health /v1/models /v1/chat/completions /v1/responses /v1/messages`,
  );

  await new Promise<void>((res) => {
    process.once("SIGINT", res);
    process.once("SIGTERM", res);
  });

  await server.close();
});

// launch [integration]
addSharedOptions(
  cli
    .command("launch <integration>", "Start proxy + launch an IDE integration")
    .example("aiyo launch opencode")
    .example("aiyo launch claude"),
).action(async (integration: string, opts: SharedOptions) => {
  const norm = integration === "claude-code" ? "claude" : integration;

  if (norm !== "opencode" && norm !== "claude") {
    console.error(
      `[aiyo] Unknown integration: ${integration}. Supported: opencode, claude (alias: claude-code)`,
    );
    process.exit(1);
  }

  const config = buildConfig(opts);
  const server = await startProxyServer(config);

  console.error(`[aiyo] Proxy at ${server.baseURL}  model=${config.model}  ptc=${config.ptc}`);

  try {
    if (norm === "opencode") {
      await launchOpenCode({ baseURL: server.baseURL, model: config.model, cwd: config.cwd, extraArgs: [] });
    } else {
      await launchClaudeCode({ baseURL: server.baseURL, model: config.model, cwd: config.cwd, extraArgs: [] });
    }
  } finally {
    await server.close();
  }
});

cli.help();
cli.version("0.0.1-beta.2");
cli.parse(process.argv, { run: false });
await cli.runMatchedCommand();
