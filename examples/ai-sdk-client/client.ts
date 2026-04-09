/**
 * AI SDK client that talks to the local acp2openai endpoint
 * using @ai-sdk/openai provider with a unique test tool.
 *
 * Usage:
 *   pnpm tsx examples/ai-sdk-client/client.ts
 */
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const openai = createOpenAI({
  baseURL: 'http://127.0.0.1:3456/v1',
  apiKey: 'dummy',
});

const TOOL_NAME = 'get_launch_count';

async function main() {
  console.log('=== AI SDK Client → acp2openai endpoint (stream) ===\n');

  const result = streamText({
    model: openai.chat('claude-sonnet-4.6'),
    messages: [
      {
        role: 'system',
        content: `You have a tool called ${TOOL_NAME}. Use it to answer the user.`,
      },
      {
        role: 'user',
        content: 'How many rockets launched this year?',
      },
    ],
    tools: {
      [TOOL_NAME]: tool({
        description: 'Returns the number of rocket launches this year.',
        inputSchema: z.object({
          year: z.number().describe('The year to query'),
        }),
        execute: async ({ year }) => {
          console.log(`  [tool] ${TOOL_NAME} called with year=${year}`);
          return { year, launches: 42 };
        },
      }),
    },
    toolChoice: 'required',
    stopWhen: stepCountIs(1),
  });

  for await (const chunk of result.fullStream) {
    switch (chunk.type) {
      case 'text-delta':
        process.stdout.write(chunk.text);
        break;
      case 'tool-call':
        console.log('\n[Tool Call]', chunk.toolName, chunk.input);
        break;
      case 'tool-result':
        console.log('[Tool Result]', chunk.toolName, JSON.stringify(chunk));
        break;
      case 'finish':
        console.log('\n[Finish]', chunk.finishReason);
        break;
      case 'error':
        console.error('[Error]', chunk.error);
        break;
      default:
        console.log('[Chunk]', chunk.type);
    }
  }
  console.log('\n--- Stream complete ---');
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
