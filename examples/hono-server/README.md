# Hono Example: Minimal Start

This example exposes an ACP command as an OpenAI-compatible HTTP server.

## Requirements

- Node.js `>= 18`
- `codebuddy --acp` available in `PATH`
- If you use a different ACP command, update the repo root `acp2openai.config.json`

Default local config:

```json
{ "port": 3456, "acp": { "command": "codebuddy", "args": ["--acp"] } }
```

## Start

Run from the repo root:

```bash
npm install
npm run example:hono
```

Server endpoints:

- `http://localhost:3456/health`
- `http://localhost:3456/v1/models`
- `http://localhost:3456/v1/chat/completions`
- `http://localhost:3456/v1/responses`

## Verify

```bash
curl http://localhost:3456/health
```

Expected:

```json
{ "status": "ok" }
```

Minimal chat request:

```bash
curl http://localhost:3456/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "default",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

## Note

This example reads `acp2openai.config.json` from the **current working directory**, so the simplest way is to start it from the repo root.
