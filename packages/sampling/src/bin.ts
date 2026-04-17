#!/usr/bin/env node

/**
 * MCP Sampling aiyo server — stdio transport
 *
 * Exposes an `ask_ai` tool via MCP Sampling.
 * The connected MCP client (e.g. VS Code) handles the actual model call.
 *
 * Model Preferences follow the MCP Sampling spec:
 * https://modelcontextprotocol.io/specification/draft/client/sampling#model-preferences
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMCPSamplingProvider } from "@mcpc-tech/mcp-sampling-ai-provider";
import { generateText } from "ai";

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.SAMPLING_MODEL || "gpt-5-mini";
const TOOL_ASK_AI = "ask_ai";

interface ModelPreferences {
  model_hint?: string;
  cost_priority?: number; // 0-1, higher = prefer cheaper
  speed_priority?: number; // 0-1, higher = prefer faster
  intelligence_priority?: number; // 0-1, higher = prefer smarter
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildModelPreferences(prefs: ModelPreferences | undefined): Record<string, unknown> {
  const hints: Array<{ name: string }> = [];
  if (prefs?.model_hint) {
    hints.push({ name: prefs.model_hint });
  }
  if (!hints.length) {
    hints.push({ name: DEFAULT_MODEL });
  }

  const result: Record<string, unknown> = { hints };
  if (prefs?.cost_priority != null) result.costPriority = prefs.cost_priority;
  if (prefs?.speed_priority != null) result.speedPriority = prefs.speed_priority;
  if (prefs?.intelligence_priority != null)
    result.intelligencePriority = prefs.intelligence_priority;

  return result;
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "mcp-sampling-aiyo-server", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
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
        DEFAULT_MODEL +
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
              DEFAULT_MODEL +
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
            description: "Intelligence preference: higher value prefers more capable models (0–1).",
          },
        },
        required: ["prompt"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
      content: [{ type: "text" as const, text: "Missing required argument: prompt" }],
      isError: true,
    };
  }

  const system = args?.system ? String(args.system) : undefined;

  const prefs: ModelPreferences = args ?? {};
  const modelPreferences = buildModelPreferences(prefs);

  const provider = createMCPSamplingProvider({ server });
  const result = await generateText({
    model: provider.languageModel({ modelPreferences }),
    system,
    prompt,
  });

  return {
    content: [{ type: "text" as const, text: result.text }],
  };
});

// ── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
