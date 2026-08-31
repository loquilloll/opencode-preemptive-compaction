import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import { buildTokenMessage, createMockCtx, defaultTestConfig, logMock } from "./helpers"

const { createPreemptiveCompactionHook } = await import("../src/preemptive-compaction")

const LOCAL_PROVIDER_ID = "local"
const LOCAL_MODEL_ID = "unsloth/Qwen3.8-27B-GGUF"
const LOCAL_ENDPOINT = "http://127.0.0.1:8888/v1"
const ENDPOINT_LIMIT = 122_624
const STATIC_PIN = 137_216

const originalFetch = globalThis.fetch
let fetchCalls: Array<{ url: string; headers: Record<string, string> }> = []
let fetchBody: unknown = {
  object: "list",
  data: [
    {
      id: LOCAL_MODEL_ID,
      object: "model",
      context_length: ENDPOINT_LIMIT,
      max_context_length: ENDPOINT_LIMIT,
      native_context_length: 262_144,
      loaded: true,
    },
  ],
}
let fetchError: Error | null = null

function installFetchStub(): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    if (fetchError) throw fetchError
    return new Response(JSON.stringify(fetchBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

async function configureLocalEndpoint(
  hook: ReturnType<typeof createPreemptiveCompactionHook>,
): Promise<void> {
  await hook.config({
    provider: {
      [LOCAL_PROVIDER_ID]: {
        options: { baseURL: LOCAL_ENDPOINT },
      },
    },
  })
}

function summarizeCall(
  ctx: ReturnType<typeof createMockCtx>,
  index: number,
): { providerID?: string; modelID?: string } | undefined {
  const call = (ctx.client.session.summarize as ReturnType<typeof mock>).mock.calls[index]?.[0] as {
    body?: { providerID?: string; modelID?: string }
  } | undefined
  return call?.body
}

describe("preemptive-compaction local endpoint limits", () => {
  beforeEach(() => {
    logMock.mockClear()
    fetchCalls = []
    fetchBody = {
      object: "list",
      data: [
        {
          id: LOCAL_MODEL_ID,
          object: "model",
          context_length: ENDPOINT_LIMIT,
          max_context_length: ENDPOINT_LIMIT,
          native_context_length: 262_144,
          loaded: true,
        },
      ],
    }
    fetchError = null
    installFetchStub()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("triggers compaction using the endpoint-reported limit for local provider models", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    await configureLocalEndpoint(hook)
    const sessionID = "ses_local_trigger"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: LOCAL_PROVIDER_ID,
        modelID: LOCAL_MODEL_ID,
        input: 100_000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    // 100000 / 122624 = 81.6% >= 78%
    expect(fetchCalls.map((c) => c.url)).toEqual([`${LOCAL_ENDPOINT}/models`])
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
    expect(summarizeCall(ctx, 0)?.providerID).toBe(LOCAL_PROVIDER_ID)
    expect(summarizeCall(ctx, 0)?.modelID).toBe(LOCAL_MODEL_ID)
  })

  it("stays silent below the endpoint-reported threshold", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    await configureLocalEndpoint(hook)
    const sessionID = "ses_local_below"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: LOCAL_PROVIDER_ID,
        modelID: LOCAL_MODEL_ID,
        input: 80_000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    // 80000 / 122624 = 65.2% < 78%
    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("prefers the endpoint-reported limit over a static model-limits pin", async () => {
    const ctx = createMockCtx()
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set(`${LOCAL_PROVIDER_ID}/${LOCAL_MODEL_ID}`, STATIC_PIN)

    const hook = createPreemptiveCompactionHook(
      ctx,
      defaultTestConfig(),
      { anthropicContext1MEnabled: false, modelContextLimitsCache },
    )
    await configureLocalEndpoint(hook)
    const sessionID = "ses_local_endpoint_authoritative"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: LOCAL_PROVIDER_ID,
        modelID: LOCAL_MODEL_ID,
        input: 105_000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    // 105000 / 122624 = 85.6% >= 78% (endpoint limit) but
    // 105000 / 137216 = 76.5% < 78% (static pin) -> endpoint value must win.
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })

  it("falls back to the static limit when the endpoint is unreachable", async () => {
    fetchError = new Error("ECONNREFUSED")
    const ctx = createMockCtx()
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set(`${LOCAL_PROVIDER_ID}/${LOCAL_MODEL_ID}`, STATIC_PIN)

    const hook = createPreemptiveCompactionHook(
      ctx,
      defaultTestConfig(),
      { anthropicContext1MEnabled: false, modelContextLimitsCache },
    )
    await configureLocalEndpoint(hook)
    const sessionID = "ses_local_fallback"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: LOCAL_PROVIDER_ID,
        modelID: LOCAL_MODEL_ID,
        input: 110_000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    // 110000 / 137216 = 80.2% >= 78% using the static pin
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
    expect(logMock).toHaveBeenCalledWith(
      "[preemptive-compaction] Failed to query local model limits",
      { url: `${LOCAL_ENDPOINT}/models`, error: "ECONNREFUSED" },
    )
  })

  it("skips compaction when the endpoint is unreachable and no static limit is known", async () => {
    fetchError = new Error("ECONNREFUSED")
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    await configureLocalEndpoint(hook)
    const sessionID = "ses_local_unknown"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: LOCAL_PROVIDER_ID,
        modelID: LOCAL_MODEL_ID,
        input: 1_000_000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalledWith(
      "[preemptive-compaction] Skipping preemptive compaction: unknown context limit for model",
      { providerID: LOCAL_PROVIDER_ID, modelID: LOCAL_MODEL_ID },
    )
  })

  it("does not query the endpoint for providers without a registered baseURL", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    await configureLocalEndpoint(hook)
    const sessionID = "ses_nonlocal"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: "anthropic",
        modelID: "claude-sonnet-4-6",
        input: 800_000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(fetchCalls).toHaveLength(0)
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(1)
  })

  it("clears the endpoint registry when the config hook is re-broadcast without providers", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    await configureLocalEndpoint(hook)
    await hook.config({})
    const sessionID = "ses_local_registry_cleared"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: LOCAL_PROVIDER_ID,
        modelID: LOCAL_MODEL_ID,
        input: 100_000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    expect(fetchCalls).toHaveLength(0)
    expect(ctx.client.session.summarize).not.toHaveBeenCalled()
  })

  it("reuses the endpoint lookup within the TTL across tool calls", async () => {
    const ctx = createMockCtx()
    const hook = createPreemptiveCompactionHook(ctx, defaultTestConfig())
    await configureLocalEndpoint(hook)
    const sessionID = "ses_local_ttl"

    await hook.event(
      buildTokenMessage({
        sessionID,
        providerID: LOCAL_PROVIDER_ID,
        modelID: LOCAL_MODEL_ID,
        input: 100_000,
      }),
    )

    await hook["tool.execute.after"](
      { tool: "bash", sessionID, callID: "call_1" },
      { title: "", output: "test", metadata: null },
    )

    const originalNow = Date.now
    Date.now = () => originalNow() + 61_000
    try {
      await hook.event(
        buildTokenMessage({
          sessionID,
          providerID: LOCAL_PROVIDER_ID,
          modelID: LOCAL_MODEL_ID,
          input: 100_000,
        }),
      )

      await hook["tool.execute.after"](
        { tool: "bash", sessionID, callID: "call_2" },
        { title: "", output: "test", metadata: null },
      )
    } finally {
      Date.now = originalNow
    }

    // The token-bearing message re-arms the session, so after the 60s cooldown
    // the second compaction runs too. The limit lookup itself must be
    // cache-backed: exactly one /models fetch across both tool calls.
    expect(fetchCalls.map((c) => c.url)).toEqual([`${LOCAL_ENDPOINT}/models`])
    expect(ctx.client.session.summarize).toHaveBeenCalledTimes(2)
  })
})

afterAll(() => {
  globalThis.fetch = originalFetch
  import("bun:test").then(({ mock }) => mock.restore())
})
