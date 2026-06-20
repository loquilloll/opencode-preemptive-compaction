import { describe, expect, it, beforeEach, afterEach } from "bun:test"

import { resolveActualContextLimit } from "../src/internal/context-limit-resolver"

const ANTHROPIC_CONTEXT_ENV_KEY = "ANTHROPIC_1M_CONTEXT"
const VERTEX_CONTEXT_ENV_KEY = "VERTEX_ANTHROPIC_1M_CONTEXT"

const originalAnthropicContextEnv = process.env[ANTHROPIC_CONTEXT_ENV_KEY]
const originalVertexContextEnv = process.env[VERTEX_CONTEXT_ENV_KEY]

describe("resolveActualContextLimit", () => {
  beforeEach(() => {
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
  })

  afterEach(() => {
    if (originalAnthropicContextEnv === undefined) {
      delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    } else {
      process.env[ANTHROPIC_CONTEXT_ENV_KEY] = originalAnthropicContextEnv
    }
    if (originalVertexContextEnv === undefined) {
      delete process.env[VERTEX_CONTEXT_ENV_KEY]
    } else {
      process.env[VERTEX_CONTEXT_ENV_KEY] = originalVertexContextEnv
    }
  })

  it("returns 200k default for anthropic models without GA 1M", () => {
    expect(resolveActualContextLimit("anthropic", "claude-sonnet-3-5")).toBe(200_000)
  })

  it("returns 1M for GA 1M claude-4.6+ models", () => {
    expect(resolveActualContextLimit("anthropic", "claude-sonnet-4-6")).toBe(1_000_000)
    expect(resolveActualContextLimit("anthropic", "claude-opus-4.7")).toBe(1_000_000)
    expect(resolveActualContextLimit("anthropic", "claude-sonnet-4-8-high")).toBe(1_000_000)
  })

  it("returns 1M for google-vertex-anthropic and aws-bedrock-anthropic GA models", () => {
    expect(resolveActualContextLimit("google-vertex-anthropic", "claude-sonnet-4-6")).toBe(1_000_000)
    expect(resolveActualContextLimit("aws-bedrock-anthropic", "claude-opus-4-6")).toBe(1_000_000)
  })

  it("treats google provider with claude-* model as anthropic", () => {
    expect(resolveActualContextLimit("google", "claude-sonnet-4-6")).toBe(1_000_000)
  })

  it("returns 1M when anthropicContext1MEnabled flag is set", () => {
    expect(
      resolveActualContextLimit("anthropic", "claude-sonnet-3-5", { anthropicContext1MEnabled: true }),
    ).toBe(1_000_000)
  })

  it("returns 1M when ANTHROPIC_1M_CONTEXT env is true", () => {
    process.env[ANTHROPIC_CONTEXT_ENV_KEY] = "true"
    expect(resolveActualContextLimit("anthropic", "claude-sonnet-3-5")).toBe(1_000_000)
  })

  it("returns 1M when VERTEX_ANTHROPIC_1M_CONTEXT env is true", () => {
    process.env[VERTEX_CONTEXT_ENV_KEY] = "true"
    expect(resolveActualContextLimit("google-vertex-anthropic", "claude-sonnet-3-5")).toBe(1_000_000)
  })

  it("prefers the cached limit for GA models when provided", () => {
    const cache = new Map<string, number>([["anthropic/claude-sonnet-4-6", 500_000]])
    expect(
      resolveActualContextLimit("anthropic", "claude-sonnet-4-6", {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: cache,
      }),
    ).toBe(500_000)
  })

  it("ignores stale cached limits for non-GA anthropic models", () => {
    const cache = new Map<string, number>([["anthropic/claude-sonnet-4-5", 500_000]])
    expect(
      resolveActualContextLimit("anthropic", "claude-sonnet-4-5", {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: cache,
      }),
    ).toBe(200_000)
  })

  it("returns cached limit for non-anthropic providers", () => {
    const cache = new Map<string, number>([["opencode/kimi-k2.5-free", 262_144]])
    expect(
      resolveActualContextLimit("opencode", "kimi-k2.5-free", {
        anthropicContext1MEnabled: false,
        modelContextLimitsCache: cache,
      }),
    ).toBe(262_144)
  })

  it("returns null for unknown non-anthropic models without a cache entry", () => {
    expect(resolveActualContextLimit("opencode", "some-model")).toBeNull()
  })
})
