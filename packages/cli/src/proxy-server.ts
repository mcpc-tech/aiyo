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

export interface RunningProxyServer {
  baseURL: string;
  close(): Promise<void>;
}

function jsonResponse(res: ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(payload);
}

async function readRequestBody(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks).toString("utf-8");
}

async function handleNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), res);
}

function buildPtcPlugins(config: LaunchConfig) {
  if (!config.ptc) return [];
  return [
    createJavaScriptCodeExecutionPlugin({
      name: "ptc",
      toolNames: config.ptcToolNames ?? ["*"],
      mapExecutionResult: async (result: JavaScriptProgrammaticExecutionResult) => {
        console.error("[aiyo-cli] PTC code:\n" + result.source);
        console.error(
          "[aiyo-cli] PTC tools:",
          result.toolHistory.map(
            (tc: JavaScriptProgrammaticToolCallRecord) =>
              `${tc.toolName}(${JSON.stringify(tc.args)})`,
          ),
        );
        return result.value;
      },
    }),
  ];
}

export async function startProxyServer(config: LaunchConfig): Promise<RunningProxyServer> {
  const defaultModel = config.model;
  const plugins = buildPtcPlugins(config);

  let adapter: ReturnType<typeof createAiyo>;

  if (config.provider === "acp") {
    const acpCommand = config.acpCommand || process.env.ACP_COMMAND || "opencode";
    const acpArgs = config.acpArgs || ["acp"];
    console.error(`[aiyo-cli] Provider: acp (${acpCommand} ${acpArgs.join(" ")})`);

    adapter = createAiyoAcp({
      defaultModel,
      defaultACPConfig: {
        command: acpCommand,
        args: acpArgs,
        env: config.acpEnv,
        session: { cwd: config.cwd, mcpServers: [] },
      },
      plugins,
    });
  } else {
    const upstreamBaseURL = config.upstreamBaseURL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const upstreamApiKey = config.upstreamApiKey || process.env.OPENAI_API_KEY || "dummy";
    console.error(`[aiyo-cli] Provider: openai (${upstreamBaseURL})`);

    const openai = createOpenAI({ baseURL: upstreamBaseURL, apiKey: upstreamApiKey });
    adapter = createAiyo({
      defaultModel,
      runtimeFactory: ({ modelId }) => ({
        model: openai.chat(modelId || defaultModel),
        modelName: modelId || defaultModel,
      }),
      plugins,
    });
  }

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        jsonResponse(res, 400, { error: "Invalid request" });
        return;
      }

      if (req.method === "GET" && req.url === "/") {
        jsonResponse(res, 200, {
          name: "aiyo-cli-proxy",
          model: defaultModel,
          provider: upstreamBaseURL,
          ptc: config.ptc ?? false,
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

      if (req.method === "GET" && req.url === "/health") {
        jsonResponse(res, 200, { status: "ok", model: defaultModel, ptc: config.ptc ?? false });
        return;
      }

      const body = await readRequestBody(req);
      const headers = new Headers();

      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") {
          headers.set(key, value);
          continue;
        }
        if (Array.isArray(value)) {
          headers.set(key, value.join(", "));
        }
      }

      const request = new Request(`http://${config.host}:${config.port}${req.url}`, {
        method: req.method,
        headers,
        body,
      });

      const response = await adapter.handleRequest(request);
      await handleNodeResponse(res, response);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      jsonResponse(res, 500, {
        error: error instanceof Error ? error.message : String(error),
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
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      }),
  };
}

