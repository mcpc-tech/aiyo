# Express Example: Minimal Start

This example exposes an ACP runtime as an OpenAI-compatible HTTP server.

## Requirements

- Node.js `>= 18`
- Internet access for `npx -y @modelcontextprotocol/server-example`

## Start

Run from the repo root:

```bash
npm install
npm run example:express
```

Server endpoints:

- `http://localhost:3000/health`
- `http://localhost:3000/v1/models`
- `http://localhost:3000/v1/chat/completions`
- `http://localhost:3000/v1/responses`

## Verify

```bash
curl http://localhost:3000/health
```

Expected:

```json
{ "status": "ok" }
```

Minimal chat request:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "default",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

## Note

This example starts the ACP runtime with:

```bash
npx -y @modelcontextprotocol/server-example
```
