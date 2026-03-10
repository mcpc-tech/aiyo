# @yaonyan/acp2openai-compatible

**OpenAI-compatible API adapter** for [ACP (Agent Client Protocol)](https://github.com/mcpc-tech/mcpc) providers using the [AI SDK](https://ai-sdk.dev/).

This library enables you to expose ACP-compatible agents through an OpenAI-compatible HTTP API, making it easy to integrate with existing OpenAI client libraries and tools.

## Features

- ✅ **OpenAI-compatible API** - Drop-in replacement for OpenAI's chat completions endpoint
- ✅ **Streaming support** - SSE-based streaming responses
- ✅ **Framework agnostic** - Built-in adapters for Hono, Express, and standard Request/Response
- ✅ **vLLM-style extra parameters** - Pass ACP-specific config via `extra_body`
- ✅ **Built with AI SDK** - Leverages Vercel's AI SDK internally for robust model interactions
- ✅ **TypeScript-first** - Full type safety with comprehensive type definitions

## Installation

```bash
npm install @yaonyan/acp2openai-compatible
```

## Quick Start

### Basic Usage (Hono)

```typescript
import { Hono } from 'hono';
import { createACP2OpenAI } from '@yaonyan/acp2openai-compatible';

const app = new Hono();

const adapter = createACP2OpenAI();

// Mount the OpenAI-compatible endpoint
app.post('/v1/chat/completions', adapter.honoHandler());

export default app;
```

### Basic Usage (Express)

```typescript
import express from 'express';
import { createACP2OpenAI } from '@yaonyan/acp2openai-compatible';

const app = express();
app.use(express.json());

const adapter = createACP2OpenAI();

// Mount the OpenAI-compatible endpoint
app.post('/v1/chat/completions', adapter.expressHandler());

app.listen(3000, () => {
  console.log('Server listening on http://localhost:3000');
});
```

### Using with OpenAI Client

Once your server is running, use any OpenAI-compatible client:

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'dummy', // Not validated by @yaonyan/acp2openai-compatible
});

const response = await client.chat.completions.create({
  model: 'default',
  messages: [
    { role: 'user', content: 'Hello!' }
  ],
  extra_body: {
    acpConfig: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-example'],
      session: {
        cwd: process.cwd(),
      }
    }
  }
});

console.log(response.choices[0].message.content);
```

## API Reference

### `createACP2OpenAI(config?)`

Creates a new ACP2OpenAI adapter instance.

**Parameters:**
- `config` (optional):
  - `defaultACPConfig?: ACPProviderSettings` - Default ACP provider configuration (command, session, etc.)
  - `defaultModel?: string` - Default model name to use

**Returns:** `ACP2OpenAI` instance

---

### `ACP2OpenAI` Class

#### Methods

##### `handleRequest(request: Request): Promise<Response>`

Framework-agnostic handler for standard Web `Request`/`Response`. Works with:
- Hono
- Cloudflare Workers
- Bun
- Deno
- Any platform supporting Web Standards

```typescript
const adapter = createACP2OpenAI({ defaultACPConfig: { /* ... */ } });

app.fetch = (request) => adapter.handleRequest(request);
```

##### `expressHandler()`

Returns Express/Node.js-style middleware.

```typescript
app.post('/v1/chat/completions', adapter.expressHandler());
```

##### `honoHandler()`

Returns Hono-style handler.

```typescript
app.post('/v1/chat/completions', adapter.honoHandler());
```

##### `handleChatCompletion(req): Promise<OpenAIChatCompletionResponse>`

Low-level non-streaming handler. Returns a complete OpenAI-compatible response object.

##### `handleChatCompletionStream(req): AsyncIterable<string>`

Low-level streaming handler. Returns an async iterable of SSE-formatted strings.

---

## Request Format

### Standard OpenAI Parameters

```typescript
{
  model: string;                    // Model name
  messages: Array<{                 // Chat messages
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  
  // Optional OpenAI parameters
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;                 // Enable streaming
}
```

### Extra Parameters (vLLM-style)

ACP-specific and AI SDK parameters can be passed via `extra_body`:

```typescript
{
  extra_body: {
    // ACP Provider Configuration (required if no defaultACPConfig)
    acpConfig: {
      command: string;              // Command to execute the ACP agent
      args?: string[];              // Arguments for the command
      env?: Record<string, string>; // Environment variables
      session: {                    // ACP session config
        cwd: string;
        mcpServers?: { /* ... */ };
        // ... other NewSessionRequest fields
      };
      initialize?: { /* ... */ };   // ACP initialize config
      authMethodId?: string;
      existingSessionId?: string;
      persistSession?: boolean;
      sessionDelayMs?: number;
    },
    
    // AI SDK-specific settings
    topK?: number;
    seed?: number;
  }
}
```

**Note:** Either `extra_body.acpConfig` or `defaultACPConfig` must be provided.

---

## Examples

### Example 1: Hono with Default Config

```typescript
import { Hono } from 'hono';
import { createACP2OpenAI } from '@yaonyan/acp2openai-compatible';

const app = new Hono();

const adapter = createACP2OpenAI({
  defaultACPConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-example'],
    session: {
      cwd: process.cwd(),
    },
  },
  defaultModel: 'gpt-4',
});

app.post('/v1/chat/completions', adapter.honoHandler());

export default app;
```

### Example 2: Express with Streaming

```typescript
import express from 'express';
import { createACP2OpenAI } from '@yaonyan/acp2openai-compatible';

const app = express();
app.use(express.json());

const adapter = createACP2OpenAI();

app.post('/v1/chat/completions', adapter.expressHandler());

app.listen(3000);
```

Client code:
```typescript
const stream = await client.chat.completions.create({
  model: 'default',
  messages: [{ role: 'user', content: 'Count to 10' }],
  stream: true,
  extra_body: {
    acpConfig: { /* ... */ }
  }
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### Example 3: Cloudflare Workers

```typescript
import { createACP2OpenAI } from '@yaonyan/acp2openai-compatible';

const adapter = createACP2OpenAI({
  defaultACPConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-example'],
    session: {
      cwd: '/tmp',
    },
  },
});

export default {
  async fetch(request: Request) {
    return adapter.handleRequest(request);
  },
};
```

---

## Advanced Usage

### Custom Model Routing

```typescript
import { ACP2OpenAI } from '@yaonyan/acp2openai-compatible';

class CustomAdapter extends ACP2OpenAI {
  async handleChatCompletion(req) {
    // Inject custom logic based on model
    if (req.model === 'my-special-model') {
      req.extra_body = {
        acpConfig: {
          command: 'custom-agent',
          session: { /* ... */ }
        }
      };
    }
    return super.handleChatCompletion(req);
  }
}

const adapter = new CustomAdapter();
```

### Error Handling

```typescript
app.post('/v1/chat/completions', async (req, res) => {
  try {
    return adapter.expressHandler()(req, res);
  } catch (error) {
    console.error('ACP error:', error);
    res.status(500).json({
      error: {
        message: error.message,
        type: 'acp_error',
      }
    });
  }
});
```

---

## How It Works

1. **Request arrives** in OpenAI format (`/v1/chat/completions`)
2. **ACP config** is extracted from `extra_body.acpConfig` or `defaultACPConfig`
3. **ACP provider** is initialized via `@mcpc-tech/acp-ai-provider`
4. **AI SDK** (`generateText` / `streamText`) executes the request
5. **Response** is converted back to OpenAI format and returned

---

## Testing

This project includes a comprehensive test suite with **65%+ coverage**.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

### Test Coverage

The test suite covers:
- Message conversion (system, user, assistant, tool)
- Tool definition and tool choice handling
- Chat completion (streaming and non-streaming)
- Request/response format validation
- Edge cases and error handling

For more details, see [TEST.md](./TEST.md).

---

## License

MIT

---

## Related Projects

- [ACP (Agent Client Protocol)](https://github.com/mcpc-tech/mcpc)
- [AI SDK by Vercel](https://ai-sdk.dev/)
- [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/)

---

## Contributing

Contributions are welcome! Please open an issue or PR on GitHub.
