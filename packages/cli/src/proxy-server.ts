import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createOpenAI } from "@ai-sdk/openai";
import { createAiyo } from "@mcpc-tech/aiyo";
import { createAiyo as createAiyoAcp } from "@mcpc-tech/aiyo-acp";
import {
  createJavaScriptCodeExecutionPlugin,
  type JavaScriptProgrammaticExecutionResult,
  type JavaScriptProgrammaticToolCallRecord,
} from "@mcpc-tech/aiyo-ptc";
import type { LaunchConfig } from "./config.js";

// ─── Types ────────────────────────────────────────────────────────────────────

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

async function pipeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), res);
}

// ─── Adapter factory ──────────────────────────────────────────────────────────

function buildAdapter(config: LaunchConfig) {
  const plugins = config.ptc
    ? [
        createJavaScriptCodeExecutionPlugin({
          name: "ptc",
          toolNames: config.ptcToolNames ?? ["*"],
          mapExecutionResult: async (result: JavaScriptProgrammaticExecutionResult) => {
            console.error("[aiyo] PTC generated code:\n" + result.source);
            console.error(
              "[aiyo] PTC tool calls:",
              result.toolHistory
                .map(
                  (tc: JavaScriptProgrammaticToolCallRecord) =>
                    `${tc.toolName}(${JSON.stringify(tc.args)})`,
                )
                .join(", "),
            );
            return result.value;
          },
        }),
      ]
    : [];

  if (config.provider === "acp") {
    console.error(
      `[aiyo] Provider: acp  command: ${config.acpCommand} ${config.acpArgs.join(" ")}`,
    );
    return createAiyoAcp({
      defaultModel: config.model,
      defaultACPConfig: {
        command: config.acpCommand,
        args: config.acpArgs,
        env: config.acpEnv,
        session: { cwd: config.cwd, mcpServers: [] },
      },
      plugins,
    });
  }

  console.error(`[aiyo] Provider: openai  base: ${config.upstreamBaseURL}`);
  const openai = createOpenAI({ baseURL: config.upstreamBaseURL, apiKey: config.upstreamApiKey });
  return createAiyo({
    defaultModel: config.model,
    runtimeFactory: ({ modelId }) => ({
      model: openai.chat(modelId || config.model),
      modelName: modelId || config.model,
    }),
    plugins,
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startProxyServer(config: LaunchConfig): Promise<RunningProxyServer> {
  const adapter = buildAdapter(config);

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
          ptc: config.ptc,
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
          ptc: config.ptc,
        });
        return;
      }

      // Proxy to adapter
      const body = await readBody(req);
      const headers = new Headers(
        Object.entries(req.headers).flatMap(([k, v]) =>
          typeof v === "string"
            ? [[k, v] as [string, string]]
            : Array.isArray(v)
              ? [[k, v.join(", ")] as [string, string]]
              : [],
        ),
      );

      const response = await adapter.handleRequest(
        new Request(`http://${config.host}:${config.port}${req.url}`, {
          method: req.method,
          headers,
          body,
        }),
      );

      await pipeResponse(res, response);
    } catch (err) {
      if (res.headersSent) {
        res.destroy(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : String(err) });
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
