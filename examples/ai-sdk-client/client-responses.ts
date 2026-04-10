/**
 * AI SDK client for the /v1/responses endpoint.
 * Uses @ai-sdk/openai with openai.responses() + streamText.
 * openai.responses() automatically routes to /v1/responses.
 *
 * Usage:
 *   pnpm tsx examples/ai-sdk-client/client-responses.ts
 */
import { createOpenAI } from "@ai-sdk/openai";
import { jsonSchema, streamText, stepCountIs, tool } from "ai";
import { z } from "zod";

// baseURL must end at the root (no /v1) so that openai.responses()
// correctly appends /v1/responses internally.
const openai = createOpenAI({
  baseURL: "http://127.0.0.1:3456/v1",
  apiKey: "dummy",
});

const tools = {
  get_order_status: tool({
    description: "Look up the fulfilment status of an order by ID.",
    inputSchema: z.object({
      order_id: z.string().describe("Order identifier"),
    }),
    outputSchema: jsonSchema({
      type: "object",
      properties: {
        order_id: { type: "string" },
        status: { type: "string" },
        carrier: { type: "string" },
        estimated_delivery: { type: "string" },
      },
      required: ["order_id", "status", "carrier", "estimated_delivery"],
    } as any),
    execute: async ({ order_id }) => {
      console.log(`  [tool] get_order_status(${order_id})`);
      return {
        order_id,
        status: "shipped",
        carrier: "DHL",
        estimated_delivery: "2026-04-15",
      };
    },
  }),

  get_weather: tool({
    description: "Get current weather for a city.",
    inputSchema: z.object({
      city: z.string(),
    }),
    outputSchema: jsonSchema({
      type: "object",
      properties: {
        city: { type: "string" },
        temperature: { type: "number" },
        condition: { type: "string" },
      },
      required: ["city", "temperature", "condition"],
    } as any),
    execute: async ({ city }) => {
      console.log(`  [tool] get_weather(${city})`);
      return { city, temperature: 18, condition: "partly cloudy" };
    },
  }),
};

async function main() {
  console.log("=== AI SDK Client → /v1/responses (streamText) ===\n");
  console.log("Tools:", Object.keys(tools).join(", "), "\n");

  // openai.responses() sends to /v1/responses (OpenAI Responses API)
  // "auto" is resolved by the server to its defaultModel
  const result = streamText({
    model: openai.responses("auto"),
    messages: [
      {
        role: "user",
        content:
          "What is the status of order ORD-2026-0007 and what's the weather in Tokyo?",
      },
    ],
    tools,
    toolChoice: "auto",
    stopWhen: stepCountIs(6),
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
        console.log(
          "[Tool Result]",
          chunk.toolName,
          JSON.stringify(chunk.output),
        );
        break;
      case "finish":
        console.log("\n[Finish]", chunk.finishReason);
        break;
      case "error":
        console.error("[Error]", chunk.error);
        break;
    }
  }

  console.log("\n--- Done ---");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
