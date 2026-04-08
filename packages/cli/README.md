# ACP2OpenAI CLI

Minimal launcher for local agent integrations backed by the `@yaonyan/acp2openai-compatible` proxy.

## Supported integrations

- `opencode`
- `claude` / `claude-code`

## Usage

From the repo root:

```bash
pnpm install
pnpm run launch opencode
pnpm run launch claude
```

Optional flags:

```bash
pnpm run launch opencode --model default --port 3456 --cwd /path/to/workspace
```

ACP defaults follow the same local config/env convention as the Hono example:

- config file: `acp2openai.config.json`
- env: `ACP2OPENAI_CONFIG`, `ACP_COMMAND`, `ACP_ARGS`, `ACP_CWD`, `ACP_MODEL`, `PORT`, `HOST`
