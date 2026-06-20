import { afterAll, describe, it, expect, beforeEach, afterEach } from "bun:test"

import {
  logMock,
  createMockCtx,
  defaultTestConfig,
  setupImmediateTimeouts,
  buildTokenMessage,
} from "./helpers"

const ANTHROPIC_CONTEXT_ENV_KEY = "ANTHROPIC_1M_CONTEXT"
const VERTEX_CONTEXT_ENV_KEY = "VERTEX_ANTHROPIC_1M_CONTEXT"

const originalAnthropicContextEnv = process.env[ANTHROPIC_CONTEXT_ENV_KEY]
const originalVertexContextEnv = process.env[VERTEX_CONTEXT_ENV_KEY]

function resetContextLimitEnv(): void {
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
}

const { createPreemptiveCompactionHook } = await import("../src/preemptive-compaction")

describe("preemptive-compaction", () => {
  beforeEach(() => {
    logMock.mockClear()
    delete process.env[ANTHROPIC_CONTEXT_ENV_KEY]
    delete process.env[VERTEX_CONTEXT_ENV_KEY]
  })

  afterEach(() => {
    resetContextLimitEnv()
  })

  it("should use cached token info instead of fetching session.messages()", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_test1"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 50000,
        cacheRead: 5000,
      }),
    )

    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"]({ tool: "bash", sessionID, callID: "call_1" }, output)

    expect(ctx.client.session.messages).not.toHaveBeenCalled()
  })

  it("should skip gracefully when no cached token info exists", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())

    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"]({ tool: "bash", sessionID: "ses_none", callID: "call_1" }, output)

    expect(ctx.client.session.messages).not.toHaveBeenCalled()
  })

  it("should trigger compaction when usage exceeds threshold", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_high"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    const output = { title: "", output: "test", metadata: null }
    await hook["tool.execute.after"]({ tool: "bash", sessionID, callID: "call_1" }, output)

    expect(ctx.client.session.messages).not.toHaveBeenCalled()
    expect(ctx.client.session.summarize).toHaveBeenCalled()
  })

  it("should trigger compaction for google-vertex-anthropic provider", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_vertex_anthropic_high"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "google-vertex-anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalled()
  })

  it("should trigger compaction for aws-bedrock-anthropic provider", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_aws_bedrock_anthropic_high"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "aws-bedrock-anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_aws_bedrock_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })

  it("should clean up cache on session.deleted", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_del"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 180000,
        cacheRead: 10000,
      }),
    )

    await hook.event({
      event: {
        type: "session.deleted",
        properties: { info: { id: sessionID } },
      },
    })

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("should log summarize errors instead of swallowing them", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_log_error"
    const summarizeError = new Error("summarize failed")
    ctx.client.session.summarize.mockRejectedValueOnce(summarizeError)

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_log" },
      { title: "", output: "test", metadata: null },
    )

    expect(logMock).toHaveBeenCalledWith("[preemptive-compaction] Compaction failed", {
      sessionID,
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      error: String(summarizeError),
    })
  })

  it("should show a warning toast when preemptive compaction fails", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_toast_on_failure"
    ctx.client.session.summarize.mockRejectedValueOnce(new Error("upstream rate limited"))

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_toast" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.tui.showToast).toHaveBeenCalledTimes(1)
    const toastCall = (ctx.client.tui.showToast as ReturnType<typeof import("bun:test")["mock"]>).mock.calls[0]?.[0]
    expect(toastCall?.body?.title).toBe("Preemptive compaction failed")
    expect(toastCall?.body?.variant).toBe("warning")
    expect(String(toastCall?.body?.message)).toContain("upstream rate limited")
  })

  it("should enforce cooldown even after failed compaction to prevent rapid retry loops", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_fail_cooldown"
    ctx.client.session.summarize.mockRejectedValueOnce(new Error("rate limited"))

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_fail" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_fail_2" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })

  it("should use 1M limit when model cache flag is enabled", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig(), {
      anthropicContext1MEnabled: true,
    })
    const sessionID = "ses_1m_flag"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 300000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("should keep env var fallback when model cache flag is disabled", async () => {
    process.env[ANTHROPIC_CONTEXT_ENV_KEY] = "true"
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig(), {
      anthropicContext1MEnabled: false,
    })
    const sessionID = "ses_env_fallback"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 300000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("should clear in-progress lock when summarize times out", async () => {
    const restoreTimeouts = setupImmediateTimeouts()
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_timeout"

    ctx.client.session.summarize
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({})

    try {
      await hook.event(
        buildTokenMessage({
          sessionID,
          providerID: "anthropic",
          modelID: "claude-sonnet-4-6",
          input: 800000,
          cacheRead: 10000,
        }),
      )

      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call_timeout_1" },
        { title: "", output: "test", metadata: null },
      )

      expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
      expect(logMock).toHaveBeenCalledWith("[preemptive-compaction] Compaction failed", {
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        error: expect.stringContaining("Compaction summarize timed out"),
      })

      const originalNow = Date.now
      Date.now = () => originalNow() + 61_000
      try {
        await hook.event(
          buildTokenMessage({
            sessionID,
            providerID: "anthropic",
            modelID: "claude-sonnet-4-6",
            input: 800000,
            cacheRead: 10000,
          }),
        )

        await hook["tool.execute.after"](
          { tool: "bash", sessionID, callID: "call_timeout_2" },
          { title: "", output: "test", metadata: null },
        )

        expect(ctx.client.session.summarize).toHaveBeenCalledTimes(2)
      } finally {
        Date.now = originalNow
      }
    } finally {
      restoreTimeouts()
    }
  })

  it("should allow re-compaction when context grows after successful compaction", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_recompact"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)

    const originalNow = Date.now
    Date.now = () => originalNow() + 61_000
    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_2" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(2)
    Date.now = originalNow
  })

  it("should ignore compaction-agent message updates after successful compaction", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    const sessionID = "ses_compaction_agent_update"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)

    const originalNow = Date.now
    try {
      Date.now = () => originalNow() + 61_000

      await hook.event(
        buildTokenMessage({
          sessionID,
          providerID: "anthropic",
          modelID: "claude-sonnet-4-6",
          input: 170000,
          cacheRead: 10000,
          agent: "compaction",
        }),
      )

      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call_2" },
        { title: "", output: "test", metadata: null },
      )

      expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
    } finally {
      Date.now = originalNow
    }
  })

  it("should use model-specific context limit from modelContextLimitsCache", async () => {
    const ctx = createMockCtx()
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("opencode/kimi-k2.5-free", 262144)

    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig(), {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })
    const sessionID = "ses_kimi_limit"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "opencode",
        modelID: "kimi-k2.5-free",
        input: 170000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("should trigger compaction at model-specific threshold", async () => {
    const ctx = createMockCtx()
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("opencode/kimi-k2.5-free", 262144)

    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig(), {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })
    const sessionID = "ses_kimi_trigger"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "opencode",
        modelID: "kimi-k2.5-free",
        input: 200000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalled()
  })

  it("should ignore stale cached Anthropic limits for older models", async () => {
    const ctx = createMockCtx()
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("anthropic/claude-sonnet-4-5", 500000)

    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig(), {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })
    const sessionID = "ses_old_anthropic_limit"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
        input: 170000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalled()
  })

  it("should respect a custom threshold from config", async () => {
    const ctx = createMockCtx()
    const config = defaultTestConfig()
    config.threshold = 0.4
    const hook = createPreemptiveCompactionHook(ctx, config)
    const sessionID = "ses_custom_threshold"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 450000,
        cacheRead: 0,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).toHaveBeenCalled()
  })

  it("should not trigger below a custom threshold from config", async () => {
    const ctx = createMockCtx()
    const config = defaultTestConfig()
    config.threshold = 0.9
    const hook = createPreemptiveCompactionHook(ctx, config)
    const sessionID = "ses_custom_threshold_below"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("should route compaction to the configured compactionModel override", async () => {
    const ctx = createMockCtx()
    const config = defaultTestConfig()
    config.compactionModel = "opencode/glm-4.6"
    const hook = createPreemptiveCompactionHook(ctx, config)
    const sessionID = "ses_model_override"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800000,
        cacheRead: 10000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    const call = (ctx.client.session.summarize as ReturnType<typeof import("bun:test")["mock"]>).mock.calls[0]?.[0]
    expect(call?.body?.providerID).toBe("opencode")
    expect(call?.body?.modelID).toBe("glm-4.6")
  })
})

afterAll(() => {
  import("bun:test").then(({ mock }) => mock.restore())
})
