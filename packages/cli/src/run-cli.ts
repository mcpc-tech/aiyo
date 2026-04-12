import { config as dotenvConfig } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cac, { type Command } from "cac";
import type { AiyoPlugin } from "@mcpc-tech/aiyo";
import { resolveLaunchConfig, type ProviderType } from "./config.js";
import { startProxyServer } from "./proxy-server.js";
import { launchOpenCode } from "./opencode.js";
import { launchClaudeCode } from "./claude-code.js";
import { logger, logFile } from "./logger.js";

const CLI_VERSION = "0.0.1-beta.4";
const packageDir = dirname(fileURLToPath(import.meta.url));

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

function loadEnv(): void {
  for (const envPath of [resolve(process.cwd(), ".env"), resolve(packageDir, "../../.env")]) {
    const { error } = dotenvConfig({ path: envPath, override: false });
    if (!error) {
      logger.info(`Loaded env from ${envPath}`);
      break;
    }
  }
}

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
    cwd: opts.cwd,
  });
}

function addSharedOptions(cmd: Command): Command {
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

async function buildPlugins(opts: SharedOptions): Promise<AiyoPlugin[]> {
  const enablePtc = opts.ptc ?? process.env.AIYO_PTC === "true";
  if (!enablePtc) return [];

  const { createJavaScriptCodeExecutionPlugin } = await import("@mcpc-tech/aiyo-ptc");
  return [
    createJavaScriptCodeExecutionPlugin({
      name: "ptc",
      toolNames: ["*"],
      log: (obj, msg) => logger.info(obj, msg),
      mapExecutionResult: async (result) => {
        logger.info({ source: result.source }, "[ptc] generated code");
        logger.info(
          {
            tools: result.toolHistory.map(
              (toolCall) => `${toolCall.toolName}(${JSON.stringify(toolCall.args)})`,
            ),
          },
          "[ptc] tool calls",
        );
        return result.value;
      },
    }),
  ];
}

function describePlugins(plugins: AiyoPlugin[]): string {
  if (plugins.length === 0) return "none";
  return plugins.map((plugin, index) => plugin.name || `plugin-${index + 1}`).join(",");
}

function createCli() {
  const cli = cac("aiyo");

  addSharedOptions(cli.command("serve", "Start OpenAI-compatible proxy server (API mode)")).action(
    async (opts: SharedOptions) => {
      const config = buildConfig(opts);
      const plugins = await buildPlugins(opts);
      const server = await startProxyServer(config, { plugins });

      logger.info(`Listening at ${server.baseURL}`);
      logger.info(
        `model=${config.model}  provider=${config.provider}  plugins=${describePlugins(plugins)}`,
      );
      logger.info("endpoints: /health /v1/models /v1/chat/completions /v1/responses /v1/messages");

      await new Promise<void>((res) => {
        process.once("SIGINT", res);
        process.once("SIGTERM", res);
      });

      await server.close();
    },
  );

  addSharedOptions(
    cli
      .command("launch <integration>", "Start proxy + launch an IDE integration")
      .example("aiyo launch opencode")
      .example("aiyo launch claude"),
  ).action(async (integration: string, opts: SharedOptions) => {
    const norm = integration === "claude-code" ? "claude" : integration;

    if (norm !== "opencode" && norm !== "claude") {
      logger.error(
        `Unknown integration: ${integration}. Supported: opencode, claude (alias: claude-code)`,
      );
      process.exit(1);
    }

    const config = buildConfig(opts);
    const plugins = await buildPlugins(opts);
    const server = await startProxyServer(config, { plugins });

    logger.info(
      `Proxy at ${server.baseURL}  model=${config.model}  plugins=${describePlugins(plugins)}`,
    );

    try {
      if (norm === "opencode") {
        await launchOpenCode({
          baseURL: server.baseURL,
          model: config.model,
          cwd: config.cwd,
          extraArgs: [],
        });
      } else {
        await launchClaudeCode({
          baseURL: server.baseURL,
          model: config.model,
          cwd: config.cwd,
          extraArgs: [],
        });
      }
    } finally {
      await server.close();
    }
  });

  cli.help();
  cli.version(CLI_VERSION);
  return cli;
}

export async function runCli(argv = process.argv): Promise<void> {
  loadEnv();
  const cli = createCli();
  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
}

export { logFile };
