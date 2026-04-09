/**
 * AI SDK client that talks to the local acp2openai endpoint
 * with multiple test tools.
 *
 * Usage:
 *   pnpm tsx examples/ai-sdk-client/client.ts
 */
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";

const openai = createOpenAI({
  baseURL: "http://127.0.0.1:3456/v1",
  apiKey: "dummy",
});

const tools = {
  get_launch_count: tool({
    description: "Returns the number of rocket launches for a given year.",
    inputSchema: z.object({
      year: z.number().describe("The year to query"),
    }),
    execute: async ({ year }) => {
      console.log(`  [tool] get_launch_count called with year=${year}`);
      // Mock data: more launches in recent years
      const launches =
        year === 2026 ? 42 : year === 2025 ? 38 : year === 2024 ? 35 : 30;
      return { year, launches };
    },
  }),

  get_weather: tool({
    description: "Get current weather for a location.",
    inputSchema: z.object({
      city: z.string().describe("City name"),
      country: z.string().optional().describe("Country code (optional)"),
    }),
    execute: async ({ city, country }) => {
      console.log(
        `  [tool] get_weather called for ${city}${country ? `, ${country}` : ""}`,
      );
      // Mock weather data
      const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"];
      const condition =
        conditions[Math.floor(Math.random() * conditions.length)];
      const temperature = 15 + Math.floor(Math.random() * 20);
      return { city, country, temperature, condition, unit: "celsius" };
    },
  }),

  calculate: tool({
    description: "Perform a mathematical calculation.",
    inputSchema: z.object({
      expression: z
        .string()
        .describe(
          'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)")',
        ),
    }),
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
        .describe(
          'Timezone (e.g., "UTC", "America/New_York"). Defaults to local time.',
        ),
    }),
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
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results (default: 5)"),
    }),
    execute: async ({ query, limit = 5 }) => {
      console.log(
        `  [tool] search_knowledge called with query: "${query}" (limit: ${limit})`,
      );
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
    model: openai.chat("claude-sonnet-4.6"),
    messages: [
      {
        role: "system",
        content: `You have access to these tools: ${Object.keys(tools).join(", ")}. Use them to answer the user.`,
      },
      {
        role: "user",
        content:
          "How many rockets launched this year and what's the weather like in Paris?",
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
