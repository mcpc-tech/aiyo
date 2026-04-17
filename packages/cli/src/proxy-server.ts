import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createOpenAI } from "@ai-sdk/openai";
import { createAiyo, type AiyoPlugin } from "@mcpc-tech/aiyo";
import { createAiyo as createAiyoAcp } from "@mcpc-tech/aiyo-acp";
import { createAiyo as createAiyoSampling } from "@mcpc-tech/aiyo-sampling";
import { logger } from "./logger.js";
import type { LaunchConfig } from "./config.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProxyAdapter =
  | ReturnType<typeof createAiyo>
  | ReturnType<typeof createAiyoAcp>
  | ReturnType<typeof createAiyoSampling>;

export interface ProxyServerOptions {
  plugins?: AiyoPlugin[];
  samplingServer?: import("@modelcontextprotocol/sdk/server/index.js").Server;
}

export interface RunningProxyServer {
  baseURL: string;
  close(): Promise<void>;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf-8") : undefined;
}

function logIncomingBody(url: string | undefined, body: string): void {
  logger.info({ url, body }, "incoming request body");

  try {
    logger.info({ url, json: JSON.parse(body) }, "incoming request json");
  } catch {
    logger.info({ url }, "incoming request body is not valid json");
  }
}

function logSSELine(line: string, state: { textLen: number; chunkCount: number }): void {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!normalized) return;

  logger.info({ line: normalized }, "SSE raw");

  if (normalized === "data: [DONE]") {
    logger.info({ textLen: state.textLen, chunks: state.chunkCount }, "SSE out: done");
    return;
  }

  if (!normalized.startsWith("data: ")) {
    return;
  }

  try {
    const parsed = JSON.parse(normalized.slice(6));
    const delta = parsed.choices?.[0]?.delta;
    const finish = parsed.choices?.[0]?.finish_reason;

    if (delta?.content) {
      state.textLen += delta.content.length;
      logger.info({ content: delta.content }, "SSE out: content");
    }
    if (delta?.tool_calls) {
      logger.info({ tool_calls: delta.tool_calls }, "SSE out: tool_calls");
    }
    if (finish) {
      logger.info(
        {
          finish_reason: finish,
          textLen: state.textLen,
          chunks: state.chunkCount,
        },
        "SSE out: finish",
      );
    }
    state.chunkCount += 1;
  } catch {
    logger.info({ data: normalized.slice(6) }, "SSE out: non-json data");
  }
}

async function pipeResponse(res: ServerResponse, response: Response, isSSE = false): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (!response.body) {
    res.end();
    return;
  }
  const readable = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  if (isSSE) {
    const state = { textLen: 0, chunkCount: 0 };
    let buffered = "";
    const logStream = new Transform({
      transform(chunk, _enc, cb) {
        const text = buffered + chunk.toString("utf-8");
        const lines = text.split("\n");
        buffered = lines.pop() ?? "";

        for (const line of lines) {
          logSSELine(line, state);
        }

        cb(null, chunk);
      },
      flush(cb) {
        if (buffered) {
          logSSELine(buffered, state);
        }
        cb();
      },
    });
    await pipeline(readable, logStream, res);
  } else {
    await pipeline(readable, res);
  }
}

function getPlugins(options: ProxyServerOptions): AiyoPlugin[] {
  return options.plugins ? [...options.plugins] : [];
}

function getPluginNames(plugins: AiyoPlugin[]): string[] {
  return plugins.map((plugin, index) => plugin.name || `plugin-${index + 1}`);
}

// ─── Adapter factory ──────────────────────────────────────────────────────────

export function createProxyAdapter(
  config: LaunchConfig,
  options: ProxyServerOptions = {},
): ProxyAdapter {
  const plugins = getPlugins(options);

  const coreLog = (details: Record<string, unknown>, msg: string) => {
    logger.info(details, `core: ${msg}`);
  };

  if (config.provider === "acp") {
    logger.info(`Provider: acp  command: ${config.acpCommand} ${config.acpArgs.join(" ")}`);
    return createAiyoAcp({
      defaultModel: config.model,
      defaultACPConfig: {
        command: config.acpCommand,
        args: config.acpArgs,
        env: config.acpEnv,
        session: { cwd: config.cwd, mcpServers: [] },
      },
      plugins,
      log: coreLog,
    });
  }

  if (config.provider === "sampling") {
    if (!options.samplingServer) {
      throw new Error("sampling provider requires a samplingServer instance (MCP Server)");
    }
    logger.info("Provider: sampling  (MCP Sampling via connected client)");
    return createAiyoSampling({
      defaultModel: config.model,
      defaultSamplingConfig: { server: options.samplingServer },
      plugins,
      log: coreLog,
    });
  }

  logger.info(`Provider: openai  base: ${config.upstreamBaseURL}`);
  const openai = createOpenAI({
    baseURL: config.upstreamBaseURL,
    apiKey: config.upstreamApiKey,
  });
  return createAiyo({
    defaultModel: config.model,
    runtimeFactory: ({ modelId }) => ({
      model: openai.chat(modelId || config.model),
      modelName: modelId || config.model,
    }),
    plugins,
    log: coreLog,
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startProxyServer(
  config: LaunchConfig,
  options: ProxyServerOptions = {},
): Promise<RunningProxyServer> {
  const adapter = createProxyAdapter(config, options);
  const pluginNames = getPluginNames(getPlugins(options));

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        jsonResponse(res, 400, { error: "Invalid request" });
        return;
      }

      // Info endpoint
      if (req.method === "GET" && req.url === "/") {
        jsonResponse(res, 200, {
          name: "aiyo-cli-proxy",
          model: config.model,
          provider: config.provider,
          plugins: pluginNames,
          endpoints: [
            "/health",
            "/v1/models",
            "/v1/chat/completions",
            "/v1/responses",
            "/v1/messages",
          ],
        });
        return;
      }

      // Health endpoint
      if (req.method === "GET" && req.url === "/health") {
        jsonResponse(res, 200, {
          status: "ok",
          model: config.model,
          provider: config.provider,
          plugins: pluginNames,
        });
        return;
      }

      // Proxy to adapter
      const body = await readBody(req);
      if (body && req.url?.includes("/chat/completions")) {
        try {
          const parsed = JSON.parse(body);
          const msgs = parsed.messages ?? [];
          const summary = msgs.slice(-4).map(
            (m: { role?: string; tool_calls?: unknown[]; tool_call_id?: string }) => {
              const e: { role?: string; tc?: number; tcid?: string } = { role: m.role };
              if (m.tool_calls) e.tc = m.tool_calls.length;
              if (m.tool_call_id) e.tcid = m.tool_call_id;
              return e;
            },
          );
          logger.info(
            {
              msgCount: msgs.length,
              toolCount: (parsed.tools ?? []).length,
              tail: summary,
            },
            "incoming request",
          );
        } catch {}
        logIncomingBody(req.url, body);
      }
      const headers = new Headers(
        Object.entries(req.headers).flatMap(([k, v]) =>
          typeof v === "string"
            ? [[k, v] as [string, string]]
            : Array.isArray(v)
              ? [[k, v.join(", ")] as [string, string]]
              : [],
        ),
      );

      const startMs = Date.now();
      const response = await adapter.handleRequest(
        new Request(`http://${config.host}:${config.port}${req.url}`, {
          method: req.method,
          headers,
          body,
        }),
      );
      logger.info({ status: response.status, elapsed: Date.now() - startMs }, "upstream response");

      const isStream = body
        ? (() => {
            try {
              return JSON.parse(body).stream === true;
            } catch {
              return false;
            }
          })()
        : false;
      await pipeResponse(res, response, isStream);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "request error");
      if (res.headersSent) {
        res.destroy(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    baseURL: `http://${config.host}:${config.port}`,
    close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}
