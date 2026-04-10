import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createACP2OpenAI } from "@yaonyan/acp2openai-acp";
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

async function readRequestBody(
  req: IncomingMessage,
): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks).toString("utf-8");
}

async function handleNodeResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    res,
  );
}

export async function startProxyServer(
  config: LaunchConfig,
): Promise<RunningProxyServer> {
  const adapter = createACP2OpenAI({
    defaultModel: config.model,
    defaultACPConfig: {
      command: config.acpCommand,
      args: config.acpArgs,
      env: config.acpEnv,
      session: {
        cwd: config.cwd,
        mcpServers: [],
      },
    },
  });

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        jsonResponse(res, 400, { error: "Invalid request" });
        return;
      }

      if (req.method === "GET" && req.url === "/") {
        jsonResponse(res, 200, {
          name: "acp2openai-cli-proxy",
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
        jsonResponse(res, 200, { status: "ok" });
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

      const request = new Request(
        `http://${config.host}:${config.port}${req.url}`,
        {
          method: req.method,
          headers,
          body,
        },
      );

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
