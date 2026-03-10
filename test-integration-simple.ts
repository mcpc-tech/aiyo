#!/usr/bin/env tsx

import { ACP2OpenAI, type OpenAIChatCompletionRequest } from './src/index.js';

async function main() {
  console.log('🧪 Testing ACP2OpenAI Integration...\n');

  const adapter = new ACP2OpenAI({
    defaultModel: 'default',
    defaultACPConfig: {
      command: 'claude-agent-acp',
      args: [],
      session: {
        cwd: process.cwd(),
        mcpServers: [],
      },
    },
  });

  // Test 1: Basic chat completion
  console.log('Test 1: Basic Chat Completion');
  try {
    const request: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [
        { role: 'user', content: 'Say "Hello, ACP!" and nothing else.' },
      ],
      max_tokens: 50,
    };

    const response = await adapter.handleChatCompletion(request);
    console.log('✅ Response received:', response.choices[0].message.content);
    console.log('   Model:', response.model);
    console.log('   ID:', response.id);
    console.log('   Usage:', response.usage);
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
    process.exit(1);
  }

  // Test 2: Streaming
  console.log('\nTest 2: Streaming Chat Completion');
  try {
    const request: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [
        { role: 'user', content: 'Count from 1 to 3.' },
      ],
      stream: true,
      max_tokens: 50,
    };

    const chunks: string[] = [];
    for await (const chunk of adapter.handleChatCompletionStream(request)) {
      chunks.push(chunk);
      process.stdout.write('.');
    }
    
    console.log(`\n✅ Received ${chunks.length} chunks`);
    
    // Extract content
    const content = chunks
      .filter(c => !c.includes('[DONE]'))
      .map(c => {
        try {
          const parsed = JSON.parse(c.replace('data: ', ''));
          return parsed.choices[0].delta.content || '';
        } catch {
          return '';
        }
      })
      .join('');
    
    console.log('   Content:', content);
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
    process.exit(1);
  }

  // Test 3: Function calling
  console.log('\nTest 3: Function Calling');
  try {
    const request: OpenAIChatCompletionRequest = {
      model: 'default',
      messages: [
        { role: 'user', content: 'What is 15 + 27? Use the calculator tool.' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'calculator',
            description: 'Perform basic arithmetic operations',
            parameters: {
              type: 'object',
              properties: {
                operation: {
                  type: 'string',
                  enum: ['add', 'subtract', 'multiply', 'divide'],
                },
                a: { type: 'number' },
                b: { type: 'number' },
              },
              required: ['operation', 'a', 'b'],
            },
          },
        },
      ],
      tool_choice: 'auto',
      max_tokens: 120,
    };

    const response = await adapter.handleChatCompletion(request);
    const message = response.choices[0].message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const firstCall = message.tool_calls[0];
      if (firstCall.type === 'function') {
        console.log('✅ Tool call detected:', firstCall.function.name);
      } else {
        console.log('✅ Custom tool call detected:', firstCall.custom.name);
      }
    } else {
      console.log('✅ No tool call, text fallback:', message.content);
    }
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
    process.exit(1);
  }

  console.log('\n🎉 All tests passed!');
}

main().catch(console.error);
