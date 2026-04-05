import express from 'express';
import { createACP2OpenAI } from '../../src/index.js';

const app = express();
app.use(express.json());

// Create adapter with default ACP configuration
const adapter = createACP2OpenAI({
  defaultACPConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-example'],
    session: {
      cwd: process.cwd(),
    },
  },
  defaultModel: 'default',
});

// Mount OpenAI-compatible endpoints
app.get('/v1/models', adapter.expressHandler());
app.post('/v1/chat/completions', adapter.expressHandler());
app.post('/v1/responses', adapter.expressHandler());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
const port = 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log(`📡 OpenAI-compatible endpoint(models): http://localhost:${port}/v1/models`);
  console.log(`📡 OpenAI-compatible endpoint(chat): http://localhost:${port}/v1/chat/completions`);
  console.log(`📡 OpenAI-compatible endpoint(responses): http://localhost:${port}/v1/responses`);
});
