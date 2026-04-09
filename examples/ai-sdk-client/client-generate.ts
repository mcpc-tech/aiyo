/**
 * AI SDK client using generateText (non-streaming) that talks to the local acp2openai endpoint
 * using @ai-sdk/openai provider with a unique test tool.
 *
 * Usage:
 *   pnpm tsx examples/ai-sdk-client/client-generate.ts
 */
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
import { z } from 'zod';

const openai = createOpenAI({
  baseURL: 'http://127.0.0.1:3456/v1',
  apiKey: 'dummy',
});

const TOOL_NAME = 'get_launch_count';

async function main() {
  console.log('=== AI SDK Client → acp2openai endpoint (generateText) ===\n');

  const result = await generateText({
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
  });

  console.log('Assistant:', result.text);
  console.log('\n--- Final result ---');
  console.log('Finish reason:', result.finishReason);
  console.log('Tool calls:', JSON.stringify(result.toolCalls, null, 2));
  console.log('Tool results:', JSON.stringify(result.toolResults, null, 2));
  const steps = result.steps;
  console.log('Steps:', steps.length);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`  Step ${i}: finish=${step.finishReason} toolCalls=${step.toolCalls?.length ?? 0} toolResults=${step.toolResults?.length ?? 0}`);
  }
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
