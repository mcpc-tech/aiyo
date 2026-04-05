# Testing Guide

This repository has two layers of tests:

- unit tests that validate adapter behavior with mocks
- integration tests that exercise a real ACP runtime

## Test files

### Unit tests

- **File**: `src/index.test.ts`
- **Purpose**: validate request mapping, tool handling, streaming, `/v1/models`, and response-format behavior
- **Speed**: fast
- **Dependencies**: no external ACP runtime required

### Integration tests

- **File**: `src/index.integration.test.ts`
- **Purpose**: verify the adapter against a real `claude-agent-acp` command
- **Speed**: slower
- **Dependencies**: `claude-agent-acp` available in `PATH`

## Commands

```bash
# Unit tests
npm test
npm run test:unit

# Real ACP integration tests
npm run test:integration

# Full suite
npm run test:all

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## How integration tests behave

The integration suite checks whether `claude-agent-acp` is installed before running ACP-dependent tests.

If it is not available:

- ACP-dependent integration tests are skipped
- unit tests still run normally

## What is covered

### Unit coverage focus

- request-to-AI-SDK conversion
- OpenAI message conversion
- tool definition wrapping and tool-call unwrapping
- forced tool choice behavior
- streaming SSE output
- `/v1/models` behavior
- `response_format` handling
- error paths around missing ACP config

### Integration coverage focus

- real models discovery through `/v1/models`
- real chat completion
- real streaming chat completion
- real tool-calling behavior

## Troubleshooting

### `claude-agent-acp` not found

Install or expose a compatible ACP command in `PATH`, then rerun:

```bash
npm run test:integration
```

### Integration tests are slow or flaky

That usually points to the underlying ACP runtime, network, authentication, or model availability rather than the unit-test harness itself.

### Coverage differences

Coverage will move over time as tests and source change. Treat it as a current measurement from the test run, not a hardcoded repo guarantee.

## CI suggestion

For lightweight CI:

```bash
npm run test:unit
```

For environments that also provide a working ACP runtime:

```bash
npm run test:all
```
