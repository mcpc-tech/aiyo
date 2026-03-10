import express from 'express';
import { createACP2OpenAI } from '../../dist/index.mjs';

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

// Mount OpenAI-compatible endpoint
app.post('/v1/chat/completions', adapter.expressHandler());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
const port = 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log(`📡 OpenAI-compatible endpoint: http://localhost:${port}/v1/chat/completions`);
});
