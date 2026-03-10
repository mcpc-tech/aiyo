import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createACP2OpenAI } from '../../src/index.js';

function parseACPArgs(): string[] {
  const raw = process.env.ACP_ARGS;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(' ').map((s) => s.trim()).filter(Boolean);
  }
}

const port = Number(process.env.PORT || 3000);

const adapter = createACP2OpenAI({
  defaultModel: process.env.ACP_MODEL || 'default',
  defaultACPConfig: {
    command: process.env.ACP_COMMAND || 'claude-agent-acp',
    args: parseACPArgs(),
    session: {
      cwd: process.env.ACP_CWD || process.cwd(),
      mcpServers: [],
    },
  },
});

const app = new Hono();

app.get('/', (c) =>
  c.json({
    name: 'acp2openai-hono-example',
    endpoint: '/v1/chat/completions',
    health: '/health',
  }),
);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/v1/chat/completions', adapter.honoHandler());

app.onError((err, c) => {
  console.error('[hono-example] Unhandled error:', err);
  return c.json({ error: String(err) }, 500);
});

console.log(`🚀 Hono server running on http://localhost:${port}`);
console.log(`📡 OpenAI endpoint: http://localhost:${port}/v1/chat/completions`);
console.log('💡 Try: curl http://localhost:' + port + '/health');

serve({
  fetch: app.fetch,
  port,
});
