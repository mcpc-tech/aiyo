import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createACP2OpenAI } from '../../src/index.js';

interface FileConfig {
  port?: number;
  defaultModel?: string;
  acp?: {
    command?: string;
    args?: string[];
    cwd?: string;
  };
}

function loadFileConfig(): FileConfig {
  const configPath = resolve(process.env.ACP2OPENAI_CONFIG || 'acp2openai.config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as FileConfig;
  } catch (e) {
    console.warn(`[acp2openai] Failed to parse config file ${configPath}:`, e);
    return {};
  }
}

function parseACPArgs(fallback?: string[]): string[] {
  const raw = process.env.ACP_ARGS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return raw.split(' ').map((s) => s.trim()).filter(Boolean);
    }
  }
  return fallback ?? [];
}

const file = loadFileConfig();

const port = Number(process.env.PORT || file.port || 3000);

const adapter = createACP2OpenAI({
  defaultModel: process.env.ACP_MODEL || file.defaultModel,
  defaultACPConfig: {
    command: process.env.ACP_COMMAND || file.acp?.command || 'claude-agent-acp',
    args: parseACPArgs(file.acp?.args),
    session: {
      cwd: process.env.ACP_CWD || file.acp?.cwd || process.cwd(),
      mcpServers: [],
    },
  },
});

const app = new Hono();

// Global request logging middleware
app.use('*', async (c, next) => {
  console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.url}`);
  await next();
});

app.get('/', (c) =>
  c.json({
    name: 'acp2openai-hono-example',
    endpoints: ['/v1/models', '/v1/chat/completions', '/v1/responses'],
    health: '/health',
  }),
);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/v1/models', adapter.honoHandler());
app.post('/v1/chat/completions', adapter.honoHandler());
app.post('/v1/responses', adapter.honoHandler());

app.onError((err, c) => {
  console.error('[hono-example] Unhandled error:', err);
  return c.json({ error: String(err) }, 500);
});

console.log(`🚀 Hono server running on http://localhost:${port}`);
console.log(`📡 OpenAI endpoint(models): http://localhost:${port}/v1/models`);
console.log(`📡 OpenAI endpoint(chat): http://localhost:${port}/v1/chat/completions`);
console.log(`📡 OpenAI endpoint(responses): http://localhost:${port}/v1/responses`);
console.log('💡 Try: curl http://localhost:' + port + '/health');

serve({
  fetch: app.fetch,
  port,
});
