/**
 * AI SDK client that talks to the local acp2openai endpoint
 * with multiple test tools.
 *
 * Usage:
 *   pnpm tsx examples/ai-sdk-client/client.ts
 */
import { createOpenAI } from "@ai-sdk/openai";
import { jsonSchema, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";

const openai = createOpenAI({
  baseURL: "http://127.0.0.1:3456/v1",
  apiKey: "dummy",
});

const toolOutputSchemas = {
  get_launch_count: {
    type: "object",
    additionalProperties: false,
    properties: {
      year: {
        type: "number",
        description: "The year that was queried.",
      },
      launches: {
        type: "number",
        description: "The number of launches recorded for that year.",
      },
    },
    required: ["year", "launches"],
  },
  get_weather: {
    type: "object",
    additionalProperties: false,
    properties: {
      city: { type: "string", description: "City name." },
      country: {
        type: "string",
        description: "Country name or code when available.",
      },
      temperature: {
        type: "number",
        description: "Current temperature in Celsius.",
      },
      condition: {
        type: "string",
        description: "Human-readable weather condition.",
      },
      unit: {
        type: "string",
        description: "Temperature unit.",
        enum: ["celsius"],
      },
    },
    required: ["city", "temperature", "condition", "unit"],
  },
  calculate: {
    type: "object",
    additionalProperties: false,
    properties: {
      expression: {
        type: "string",
        description: "The original expression that was evaluated.",
      },
      result: {
        type: "number",
        description: "The numeric result when evaluation succeeds.",
      },
      error: {
        type: "string",
        description: "Error string when evaluation fails.",
      },
      success: {
        type: "boolean",
        description: "Whether the calculation succeeded.",
      },
    },
    required: ["expression", "success"],
  },
  get_current_time: {
    type: "object",
    additionalProperties: false,
    properties: {
      iso: {
        type: "string",
        description: "Current timestamp in ISO-8601 format.",
      },
      local: {
        type: "string",
        description: "Human-readable local datetime string.",
      },
      timezone: {
        type: "string",
        description: "Timezone label used for the response.",
      },
      unix_timestamp: {
        type: "number",
        description: "Unix timestamp in seconds.",
      },
    },
    required: ["iso", "local", "timezone", "unix_timestamp"],
  },
  search_knowledge: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Original search query." },
      results: {
        type: "array",
        description: "Ranked search results.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            snippet: { type: "string" },
            relevance: { type: "number" },
          },
          required: ["title", "snippet", "relevance"],
        },
      },
      total: {
        type: "number",
        description: "Total number of results returned before truncation.",
      },
    },
    required: ["query", "results", "total"],
  },
} as const;

function buildToolOutputSchemaPrompt() {
  return [
    "<tool_output_schemas>",
    ...Object.entries(toolOutputSchemas).map(
      ([toolName, schema]) =>
        `<tool name="${toolName}">\n${JSON.stringify(schema, null, 2)}\n</tool>`,
    ),
    "</tool_output_schemas>",
    "When reading tool results, trust the declared output schema fields exactly and do not guess alternate field names.",
  ].join("\n\n");
}

const tools = {
  get_launch_count: tool({
    description: "Returns the number of rocket launches for a given year.",
    inputSchema: z.object({
      year: z.number().describe("The year to query"),
    }),
    outputSchema: jsonSchema(toolOutputSchemas.get_launch_count as any),
    execute: async ({ year }) => {
      console.log(`  [tool] get_launch_count called with year=${year}`);
      // Mock data: more launches in recent years
      const launches = year === 2026 ? 42 : year === 2025 ? 38 : year === 2024 ? 35 : 30;
      return { year, launches };
    },
  }),

  get_weather: tool({
    description: "Get current weather for a location.",
    inputSchema: z.object({
      city: z.string().describe("City name"),
      country: z.string().optional().describe("Country code (optional)"),
    }),
    outputSchema: jsonSchema(toolOutputSchemas.get_weather as any),
    execute: async ({ city, country }) => {
      console.log(`  [tool] get_weather called for ${city}${country ? `, ${country}` : ""}`);
      // Mock weather data
      const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"];
      const condition = conditions[Math.floor(Math.random() * conditions.length)];
      const temperature = 15 + Math.floor(Math.random() * 20);
      return { city, country, temperature, condition, unit: "celsius" };
    },
  }),

  calculate: tool({
    description: "Perform a mathematical calculation.",
    inputSchema: z.object({
      expression: z
        .string()
        .describe('Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)")'),
    }),
    outputSchema: jsonSchema(toolOutputSchemas.calculate as any),
    execute: async ({ expression }) => {
      console.log(`  [tool] calculate called with: ${expression}`);
      try {
        // Simple safe evaluation for demo purposes
        const result = Function(`"use strict"; return (${expression})`)();
        return { expression, result, success: true };
      } catch (e) {
        return { expression, error: String(e), success: false };
      }
    },
  }),

  get_current_time: tool({
    description: "Get the current date and time.",
    inputSchema: z.object({
      timezone: z
        .string()
        .optional()
        .describe('Timezone (e.g., "UTC", "America/New_York"). Defaults to local time.'),
    }),
    outputSchema: jsonSchema(toolOutputSchemas.get_current_time as any),
    execute: async ({ timezone }) => {
      console.log(
        `  [tool] get_current_time called${timezone ? ` for timezone: ${timezone}` : ""}`,
      );
      const now = new Date();
      return {
        iso: now.toISOString(),
        local: now.toLocaleString(),
        timezone: timezone || "local",
        unix_timestamp: Math.floor(now.getTime() / 1000),
      };
    },
  }),

  search_knowledge: tool({
    description: "Search a knowledge base for information.",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Maximum number of results (default: 5)"),
    }),
    outputSchema: jsonSchema(toolOutputSchemas.search_knowledge as any),
    execute: async ({ query, limit = 5 }) => {
      console.log(`  [tool] search_knowledge called with query: "${query}" (limit: ${limit})`);
      // Mock search results
      return {
        query,
        results: [
          {
            title: `Result for "${query}" #1`,
            snippet: "This is a mock search result...",
            relevance: 0.95,
          },
          {
            title: `Result for "${query}" #2`,
            snippet: "Another relevant result...",
            relevance: 0.87,
          },
          {
            title: `Result for "${query}" #3`,
            snippet: "Somewhat related information...",
            relevance: 0.72,
          },
        ].slice(0, limit),
        total: 3,
      };
    },
  }),
};

async function main() {
  console.log("=== AI SDK Client → acp2openai endpoint (stream) ===\n");
  console.log("Available tools:", Object.keys(tools).join(", "));
  console.log();

  const result = streamText({
    model: openai.chat("auto"),
    messages: [
      {
        role: "system",
        content: `You have access to these tools: ${Object.keys(tools).join(", ")}. Use them to answer the user.\n\n${buildToolOutputSchemaPrompt()}`,
      },
      {
        role: "user",
        content: "How many rockets launched this year and what's the weather like in Paris?",
      },
    ],
    tools,
    toolChoice: "auto",
    stopWhen: stepCountIs(10),
  });

  for await (const chunk of result.fullStream) {
    switch (chunk.type) {
      case "text-delta":
        process.stdout.write(chunk.text);
        break;
      case "tool-call":
        console.log("\n[Tool Call]", chunk.toolName, chunk.input);
        break;
      case "tool-result":
        console.log("[Tool Result]", chunk.toolName, JSON.stringify(chunk));
        break;
      case "finish":
        console.log("\n[Finish]", chunk.finishReason);
        break;
      case "error":
        console.error("[Error]", chunk.error);
        break;
      default:
        console.log("[Chunk]", chunk.type);
    }
  }
  console.log("\n--- Stream complete ---");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
