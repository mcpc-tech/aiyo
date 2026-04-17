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

const CLI_VERSION = "0.0.1-beta.5";
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
    .option(
      "--provider <type>",
      "Provider: openai (default) | acp | sampling  [env: AIYO_PROVIDER]",
    )
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

  // ── mcp command ─────────────────────────────────────────────────────────────
  cli
    .command("mcp", "Start MCP Sampling server on stdio (+ optional HTTP proxy)")
    .option("--model <name>", "Default model hint  [default: gpt-5-mini]")
    .option("--http", "Also start an OpenAI-compatible HTTP proxy server")
    .option("--host <host>", "HTTP bind host  [default: 127.0.0.1]")
    .option("--port <port>", "HTTP bind port  [default: 3456]")
    .action(async (opts: { model?: string; http?: boolean; host?: string; port?: number }) => {
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      const { CallToolRequestSchema, ListToolsRequestSchema } =
        await import("@modelcontextprotocol/sdk/types.js");
      const { createMCPSamplingProvider } = await import("@mcpc-tech/mcp-sampling-ai-provider");
      const { generateText } = await import("ai");

      const defaultModel = opts.model || process.env.SAMPLING_MODEL || "gpt-5-mini";
      const TOOL_ASK_AI = "ask_ai";

      interface ModelPreferences {
        model_hint?: string;
        cost_priority?: number;
        speed_priority?: number;
        intelligence_priority?: number;
      }

      function buildModelPreferences(prefs: ModelPreferences | undefined): Record<string, unknown> {
        const hints: Array<{ name: string }> = [];
        if (prefs?.model_hint) hints.push({ name: prefs.model_hint });
        if (!hints.length) hints.push({ name: defaultModel });

        const result: Record<string, unknown> = { hints };
        if (prefs?.cost_priority != null) result.costPriority = prefs.cost_priority;
        if (prefs?.speed_priority != null) result.speedPriority = prefs.speed_priority;
        if (prefs?.intelligence_priority != null)
          result.intelligencePriority = prefs.intelligence_priority;

        return result;
      }

      const mcpServer = new Server(
        { name: "mcp-sampling-aiyo-server", version: "0.0.1" },
        { capabilities: { tools: {} } },
      );

      mcpServer.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [
          {
            name: TOOL_ASK_AI,
            description:
              "Ask an LLM a question using MCP Sampling. " +
              "Use this tool when you need an LLM to answer a question, generate text, analyze content, or perform any reasoning task. " +
              "The connected MCP client (e.g. VS Code, Claude Code) handles the actual model call via MCP Sampling. " +
              "Required parameter: `prompt` — the user message/question to send. " +
              "Optional: `system` — system instruction for LLM context. " +
              "Optional model preferences (MCP Sampling spec): " +
              "`model_hint` — preferred model name (default: " +
              defaultModel +
              "), " +
              "`cost_priority` / `speed_priority` / `intelligence_priority` — 0..1 floats controlling trade-offs.",
            inputSchema: {
              type: "object" as const,
              properties: {
                prompt: {
                  type: "string" as const,
                  description:
                    "The user message or question to send to the LLM. This is the main input — always use this parameter.",
                },
                system: {
                  type: "string" as const,
                  description:
                    "Optional system instruction to set context, persona, or constraints for the LLM response.",
                },
                model_hint: {
                  type: "string" as const,
                  description:
                    'Preferred model name hint (fuzzy-matched by client). Default: "' +
                    defaultModel +
                    '"',
                },
                cost_priority: {
                  type: "number" as const,
                  minimum: 0,
                  maximum: 1,
                  description: "Cost preference: higher value prefers cheaper models (0–1).",
                },
                speed_priority: {
                  type: "number" as const,
                  minimum: 0,
                  maximum: 1,
                  description: "Speed preference: higher value prefers faster models (0–1).",
                },
                intelligence_priority: {
                  type: "number" as const,
                  minimum: 0,
                  maximum: 1,
                  description:
                    "Intelligence preference: higher value prefers more capable models (0–1).",
                },
              },
              required: ["prompt"],
            },
          },
        ],
      }));

      mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        if (name !== TOOL_ASK_AI) {
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
        }

        const prompt = String(args?.prompt ?? "");
        if (!prompt) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Missing required argument: prompt",
              },
            ],
            isError: true,
          };
        }

        const system = args?.system ? String(args.system) : undefined;

        const prefs: ModelPreferences = args ?? {};
        const modelPreferences = buildModelPreferences(prefs);

        const provider = createMCPSamplingProvider({ server: mcpServer });
        const result = await generateText({
          model: provider.languageModel({ modelPreferences }),
          system,
          prompt,
        });

        return {
          content: [{ type: "text" as const, text: result.text }],
        };
      });

      // Optional HTTP proxy
      let httpServer: { close(): void } | undefined;
      if (opts.http) {
        const config = resolveLaunchConfig({
          provider: "sampling",
          model: defaultModel,
          host: opts.host,
          port: opts.port,
        });
        const server = await startProxyServer(config, {
          samplingServer: mcpServer,
        });
        httpServer = { close: () => server.close() };
        logger.info(`HTTP proxy at ${server.baseURL}  model=${defaultModel}`);
      }

      const transport = new StdioServerTransport();
      transport.onclose = () => {
        logger.info("stdio transport closed, shutting down");
        httpServer?.close();
      };

      await mcpServer.connect(transport);
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
