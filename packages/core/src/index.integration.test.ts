import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { AiyoAdapter, type OpenAIChatCompletionRequest } from "./index.js";

/**
 * Integration Tests - Real ACP Connection
 *
 * These tests use actual ACP provider (claude-agent-acp)
 * Make sure the command is available in your PATH
 */
describe("Integration Tests - Real ACP Connection", () => {
  const hasClaudeAgentACP =
    spawnSync("sh", ["-c", "command -v claude-agent-acp"], {
      stdio: "ignore",
    }).status === 0;

  const runIfACPAvailable = hasClaudeAgentACP ? it : it.skip;

  const adapter = new AiyoAdapter({
    defaultModel: "default", // Use a valid ACP model
    defaultACPConfig: {
      command: "claude-agent-acp",
      args: [],
      session: {
        cwd: process.cwd(),
        mcpServers: [],
      },
    },
  });

  runIfACPAvailable(
    "should return models list via /v1/models after initSession",
    async () => {
      const response = await adapter.handleRequest(
        new Request("http://localhost/v1/models", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("application/json");

      const data = await response.json();
      expect(data).toMatchObject({
        object: "list",
        data: expect.any(Array),
      });
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0]).toMatchObject({
        id: expect.any(String),
        object: "model",
        owned_by: "aiyo",
      });

      console.log("✓ Models list:", data.data.map((m: { id: string }) => m.id).join(", "));
    },
    30000,
  );

  runIfACPAvailable(
    "should handle real chat completion request",
    async () => {
      const request: OpenAIChatCompletionRequest = {
        model: "default",
        messages: [{ role: "user", content: 'Say "Hello, ACP!" and nothing else.' }],
        max_tokens: 50,
      };

      const response = await adapter.handleChatCompletion(request);

      console.log("Full response:", JSON.stringify(response, null, 2));

      // Verify basic structure
      expect(response.id).toMatch(/^chatcmpl-/);
      expect(response.object).toBe("chat.completion");
      expect(response.created).toBeTypeOf("number");
      expect(response.model).toBe("default");

      // Verify choices
      expect(response.choices).toBeDefined();
      expect(response.choices.length).toBeGreaterThan(0);
      expect(response.choices[0].message.role).toBe("assistant");
      expect(response.choices[0].message.content).toBeTruthy();
      expect(response.choices[0].message.content?.length).toBeGreaterThan(0);

      // Usage may be optional
      if (response.usage) {
        expect(response.usage.prompt_tokens).toBeTypeOf("number");
        expect(response.usage.completion_tokens).toBeTypeOf("number");
        expect(response.usage.total_tokens).toBeTypeOf("number");
      }

      console.log("✓ Real response:", response.choices[0].message.content);
    },
    30000,
  ); // 30s timeout for real API call

  runIfACPAvailable(
    "should handle real streaming chat completion",
    async () => {
      const request: OpenAIChatCompletionRequest = {
        model: "default",
        messages: [{ role: "user", content: "Count from 1 to 3, one number per line." }],
        stream: true,
        max_tokens: 100,
      };

      const chunks: string[] = [];
      let firstChunk: any = null;
      let lastChunk: any = null;

      for await (const chunk of adapter.handleChatCompletionStream(request)) {
        chunks.push(chunk);

        // Parse first and last non-DONE chunks
        if (!chunk.includes("[DONE]")) {
          const parsed = JSON.parse(chunk.replace("data: ", ""));
          if (!firstChunk) firstChunk = parsed;
          lastChunk = parsed;
        }
      }

      // Verify we got chunks
      expect(chunks.length).toBeGreaterThan(2);

      // Verify first chunk has role
      expect(firstChunk.choices[0].delta.role).toBe("assistant");

      // Verify last chunk has finish_reason
      expect(lastChunk.choices[0].finish_reason).toMatch(/stop|length/);

      // Verify [DONE] marker
      expect(chunks[chunks.length - 1]).toBe("data: [DONE]\n\n");

      // Collect all text content
      const textContent = chunks
        .filter((c) => !c.includes("[DONE]"))
        .map((c) => {
          const parsed = JSON.parse(c.replace("data: ", ""));
          return parsed.choices[0].delta.content || "";
        })
        .join("");

      expect(textContent.length).toBeGreaterThan(0);
      console.log("✓ Streamed content:", textContent);
    },
    30000,
  );

  it("should handle function calling with real ACP", async () => {
    const request: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "What is 15 + 27? Use the calculator tool." }],
      tools: [
        {
          type: "function",
          function: {
            name: "calculator",
            description: "Perform basic arithmetic operations",
            parameters: {
              type: "object",
              properties: {
                operation: {
                  type: "string",
                  enum: ["add", "subtract", "multiply", "divide"],
                },
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["operation", "a", "b"],
            },
          },
        },
      ],
      tool_choice: "auto",
      max_tokens: 200,
    };

    const response = await adapter.handleChatCompletion(request);

    // Verify response structure
    expect(response).toMatchObject({
      id: expect.stringMatching(/^chatcmpl-/),
      object: "chat.completion",
      model: "default",
      choices: expect.any(Array),
      usage: expect.any(Object),
    });

    // Check if tool was called or text response was given
    const message = response.choices[0].message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      console.log("✓ Tool called:", JSON.stringify(message.tool_calls, null, 2));
      const firstCall = message.tool_calls[0];
      if (firstCall.type === "function") {
        expect(firstCall.function.name).toBe("calculator");
      } else {
        expect(firstCall.custom.name).toBeTruthy();
      }
    } else {
      // Some models might respond with text instead
      console.log("✓ Text response (no tool call):", message.content);
      expect(message.content).toBeTruthy();
    }
  }, 30000);

  it.skip("should handle multi-turn conversation", async () => {
    // First turn
    const request1: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [{ role: "user", content: "My name is Alice." }],
      max_tokens: 100,
    };

    const response1 = await adapter.handleChatCompletion(request1);
    expect(response1.choices[0].message.content).toBeTruthy();

    // Second turn - test conversation memory
    const request2: OpenAIChatCompletionRequest = {
      model: "default",
      messages: [
        { role: "user", content: "My name is Alice." },
        { role: "assistant", content: response1.choices[0].message.content || "" },
        { role: "user", content: "What is my name?" },
      ],
      max_tokens: 100,
    };

    const response2 = await adapter.handleChatCompletion(request2);
    const answer = response2.choices[0].message.content?.toLowerCase() || "";

    console.log("✓ Multi-turn response:", response2.choices[0].message.content);

    // Verify we got a response (content check depends on model behavior)
    expect(response2.choices[0].message.content).toBeTruthy();
    expect(answer.length).toBeGreaterThan(0);
  }, 30000);

  it.skip("should handle Web Request interface", async () => {
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "default",
        messages: [{ role: "user", content: 'Say "Web Request Test" and nothing else.' }],
        max_tokens: 50,
      }),
    });

    const response = await adapter.handleRequest(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = await response.json();
    expect(data.object).toBe("chat.completion");
    expect(data.choices[0].message.content).toBeTruthy();

    console.log("✓ Web Request response:", data.choices[0].message.content);
  }, 30000);

  it.skip("should handle streaming Web Request", async () => {
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "default",
        messages: [{ role: "user", content: 'Say "Stream Test".' }],
        stream: true,
        max_tokens: 50,
      }),
    });

    const response = await adapter.handleRequest(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toContain("data: [DONE]");

    console.log("✓ Streaming Web Request received", chunks.length, "chunks");
  }, 30000);
});
