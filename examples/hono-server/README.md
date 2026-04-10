# Hono Examples

This directory now keeps only **two maintained Hono servers**:

- `basic-server.ts`: ACP-backed OpenAI-compatible server
- `ptc-server.ts`: direct OpenAI-compatible provider + Programmatic Tool Calling (PTC)

## Start from repo root

### Basic server

```bash
pnpm install
pnpm run example:hono
```

or explicitly:

```bash
pnpm run example:hono:basic
```

The basic server reads `examples/hono-server/acp2openai.config.json` through the root script.

### PTC server

```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
OPENAI_API_KEY=sk-xxx \
OPENAI_MODEL=anthropic/claude-sonnet-4 \
pnpm run example:hono:ptc
```

`ptc-server.ts` also loads `.env` from either this directory or the repo root when present.

## Endpoints

Both servers expose:

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`

## Notes

- `example:hono` defaults to the **basic** ACP-backed server.
- The old `server.ts`, `programmatic-tools-server.ts`, and test helper scripts were removed to keep this folder focused.
