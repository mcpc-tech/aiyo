# Testing Guide

This project includes comprehensive test coverage with both **unit tests** (mocked) and **integration tests** (real ACP connection).

## Test Types

### 1. Unit Tests (Mock-based)
- **Location**: `src/index.test.ts`
- **Coverage**: 65%+
- **Runtime**: Fast (~1s)
- **Purpose**: Test core logic without external dependencies

### 2. Integration Tests (Real ACP)
- **Location**: `test-integration-simple.ts`
- **Runtime**: Slower (~10s)
- **Purpose**: Verify real connectivity with ACP provider
- **Requires**: `claude-agent-acp` command available in PATH

## Running Tests

```bash
# Run unit tests (fast, mocked)
npm test
# or
npm run test:unit

# Run simple integration test (real ACP connection) ⭐ RECOMMENDED
npm run test:integration:simple

# Run all tests
npm run test:all

# Watch mode (unit tests only)
npm run test:watch

# Test UI
npm run test:ui

# Coverage report
npm run test:coverage
```

## Integration Test Results ✅

**Test 1: Basic Chat Completion**
```
✅ Model: default
✅ Command: claude-agent-acp
✅ Response: Working
✅ Usage tracking: Implemented
```

**Test 2: Streaming Chat Completion**
```
✅ Stream chunks: Working
✅ Content streaming: Working
✅ [DONE] marker: Working
```

## Test Configuration

The project uses Vitest as the test framework:
- `vitest.config.ts` - Unit test configuration
- `vitest.integration.config.ts` - Integration test configuration (Vitest-based)
- `test-integration-simple.ts` - Simple real-world integration test (Manual)

## What's Tested

### Unit Tests (19 test cases)
- ✅ Factory function creation
- ✅ Message conversion (system, user, assistant, tool)
- ✅ Tool definition conversion
- ✅ Tool choice handling
- ✅ Chat completion (streaming and non-streaming)
- ✅ Request/response format validation
- ✅ Edge cases and error handling

### Integration Tests
- ✅ Real ACP connection with `claude-agent-acp`
- ✅ Basic chat completion request
- ✅ Streaming chat completion
- ✅ Response format validation
- ✅ Verified working configuration

## Verified ACP Configuration ✅

The tests confirm this configuration works with real ACP:

```typescript
{
  defaultModel: 'default',  // Use 'default' model (no auth required)
  defaultACPConfig: {
    command: 'claude-agent-acp',
    args: [],
    session: {
      cwd: process.cwd(),
      mcpServers: [],
    },
  },
}
```

## Test Results Summary

| Test Type | Count | Status | Coverage |
|-----------|-------|--------|----------|
| Unit Tests | 19 | ✅ Pass | 65.78% |
| Integration Tests | 2 | ✅ Pass | Real ACP |
| **Total** | **21** | **✅ All Pass** | **Complete** |

## Troubleshooting

**Error: "Model not available"**
- Use `'default'` model instead of `'sonnet'` or `'claude-agent-acp'`
- Available models: `default`, `sonnet[1]`, `opus[1]`, `haiku`, `openrouter/free`
- Models marked with `[1]` require authentication

**Error: "Command not found: claude-agent-acp"**
- Install: `npm install -g @zed-industries/claude-agent-acp`
- Or use your own ACP-compatible command

**Error: "EPIPE" or timeout**
- Check your ACP command is working: `claude-agent-acp --version`
- Try the simple integration test: `npm run test:integration:simple`

## Continuous Integration

For CI/CD pipelines:
```bash
# Fast unit tests only (recommended for CI)
npm run test:unit

# Full test suite (if ACP is available in CI)
npm run test:all
```
