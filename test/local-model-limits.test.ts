import { afterEach, describe, expect, it, mock } from "bun:test"

import {
  createLocalModelLimitResolver,
  extractLocalEndpoints,
  type LocalModelLimitsFetch,
} from "../src/internal/local-model-limits"
import { logMock } from "./helpers"

const LOCAL_ENDPOINT = "http://127.0.0.1:8888/v1"
const MODEL_ID = "unsloth/Qwen3.8-27B-GGUF"

function modelsBody(overrides?: Record<string, unknown>): unknown {
  return {
    object: "list",
    data: [
      {
        id: MODEL_ID,
        object: "model",
        created: 1788132509,
        owned_by: "unsloth-studio",
        quant: "UD-Q8_K_XL",
        context_length: 122_624,
        max_context_length: 122_624,
        native_context_length: 262_144,
        loaded: true,
        ...overrides,
      },
    ],
  }
}

function makeFetchStub(impl?: (url: string) => { body?: unknown; status?: number; error?: Error }) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fn: LocalModelLimitsFetch = mock(async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} })
    const result = impl ? impl(url) : { body: modelsBody() }
    if (result.error) throw result.error
    return {
      ok: (result.status ?? 200) < 400,
      status: result.status ?? 200,
      json: async () => result.body ?? modelsBody(),
    }
  })
  return { fn, calls }
}

function registerLocalEndpoint(resolver: ReturnType<typeof createLocalModelLimitResolver>): void {
  resolver.setEndpoints(new Map([["local", { baseURL: LOCAL_ENDPOINT }]]))
}

describe("extractLocalEndpoints", () => {
  const KEY_ENV = "TEST_LOCAL_LIMITS_API_KEY"
  const originalKey = process.env[KEY_ENV]

  afterEach(() => {
    if (originalKey === undefined) delete process.env[KEY_ENV]
    else process.env[KEY_ENV] = originalKey
  })

  it("collects providers with an http baseURL and normalizes trailing slashes", () => {
    const endpoints = extractLocalEndpoints({
      provider: {
        local: { options: { baseURL: "http://127.0.0.1:8888/v1/" } },
        remote: { options: { baseURL: "https://api.example.com/v1//" } },
        openai: {},
      },
    })
    expect(endpoints.get("local")?.baseURL).toBe("http://127.0.0.1:8888/v1")
    expect(endpoints.get("remote")?.baseURL).toBe("https://api.example.com/v1")
    expect(endpoints.has("openai")).toBe(false)
  })

  it("ignores non-http or missing baseURL values", () => {
    const endpoints = extractLocalEndpoints({
      provider: {
        ftp: { options: { baseURL: "ftp://127.0.0.1:8888/v1" } },
        blank: { options: { baseURL: "   " } },
        none: { options: {} },
      },
    })
    expect(endpoints.size).toBe(0)
  })

  it("resolves {env:VAR} apiKey templates and literal apiKeys", () => {
    process.env[KEY_ENV] = "secret-key"
    const endpoints = extractLocalEndpoints({
      provider: {
        local: { options: { baseURL: LOCAL_ENDPOINT, apiKey: `{env:${KEY_ENV}}` } },
        other: { options: { baseURL: "https://api.example.com/v1", apiKey: "literal-key" } },
        unset: { options: { baseURL: "https://api.example.com/v1", apiKey: "{env:UNSET_LOCAL_LIMITS_KEY_XYZ}" } },
      },
    })
    expect(endpoints.get("local")?.apiKey).toBe("secret-key")
    expect(endpoints.get("other")?.apiKey).toBe("literal-key")
    expect(endpoints.get("unset")?.apiKey).toBeUndefined()
  })

  it("returns an empty map for non-record configs", () => {
    expect(extractLocalEndpoints(null).size).toBe(0)
    expect(extractLocalEndpoints("nope").size).toBe(0)
    expect(extractLocalEndpoints({ provider: "nope" }).size).toBe(0)
  })
})

describe("createLocalModelLimitResolver", () => {
  afterEach(() => {
    logMock.mockClear()
  })

  it("returns the context_length reported by the endpoint for the given model", async () => {
    const { fn, calls } = makeFetchStub()
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)

    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBe(122_624)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${LOCAL_ENDPOINT}/models`)
  })

  it("falls back to max_context_length when context_length is missing", async () => {
    const { fn } = makeFetchStub(() => ({
      body: {
        object: "list",
        data: [{ id: MODEL_ID, max_context_length: 65_536 }],
      },
    }))
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)

    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBe(65_536)
  })

  it("returns null when the model is not listed by the endpoint", async () => {
    const { fn, calls } = makeFetchStub()
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)

    await expect(resolver.resolve("local", "other-model")).resolves.toBeNull()
    expect(calls).toHaveLength(1)
  })

  it("returns null without fetching for providers without a registered endpoint", async () => {
    const { fn, calls } = makeFetchStub()
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)

    await expect(resolver.resolve("anthropic", "claude-sonnet-4-6")).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it("caches results within the TTL and re-fetches after it expires", async () => {
    const { fn, calls } = makeFetchStub()
    let nowValue = 1_000_000
    const resolver = createLocalModelLimitResolver({
      ttlMs: 60_000,
      timeoutMs: 5_000,
      fetchImpl: fn,
      now: () => nowValue,
    })
    registerLocalEndpoint(resolver)

    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBe(122_624)
    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBe(122_624)
    expect(calls).toHaveLength(1)

    nowValue += 60_001
    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBe(122_624)
    expect(calls).toHaveLength(2)
  })

  it("dedupes concurrent resolves so one fetch serves several callers", async () => {
    let resolveBody: (body: unknown) => void = () => {}
    const pending = new Promise<unknown>((resolve) => {
      resolveBody = resolve
    })
    const calls: string[] = []
    const slowFetch: LocalModelLimitsFetch = mock(async (url) => {
      calls.push(url)
      const body = await pending
      return { ok: true, status: 200, json: async () => body }
    })
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: slowFetch })
    registerLocalEndpoint(resolver)

    const results = Promise.all([
      resolver.resolve("local", MODEL_ID),
      resolver.resolve("local", MODEL_ID),
      resolver.resolve("local", "other-model"),
    ])
    resolveBody(modelsBody())
    await expect(results).resolves.toEqual([122_624, 122_624, null])
    expect(calls).toEqual([`${LOCAL_ENDPOINT}/models`])
  })

  it("returns null and logs when the endpoint request fails", async () => {
    const { fn } = makeFetchStub(() => ({ error: new Error("ECONNREFUSED") }))
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)

    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBeNull()
    expect(logMock).toHaveBeenCalledWith(
      "[preemptive-compaction] Failed to query local model limits",
      { url: `${LOCAL_ENDPOINT}/models`, error: "ECONNREFUSED" },
    )
  })

  it("caches failed lookups so a flaky endpoint is not hammered within the TTL", async () => {
    const { fn, calls } = makeFetchStub(() => ({ error: new Error("ECONNREFUSED") }))
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)

    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBeNull()
    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBeNull()
    expect(calls).toHaveLength(1)
  })

  it("treats non-2xx responses as failures", async () => {
    const { fn } = makeFetchStub(() => ({ status: 500, body: {} }))
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)

    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBeNull()
    expect(logMock).toHaveBeenCalledWith(
      "[preemptive-compaction] Failed to query local model limits",
      { url: `${LOCAL_ENDPOINT}/models`, error: "HTTP 500" },
    )
  })

  it("sends the configured apiKey as a Bearer token", async () => {
    const { fn, calls } = makeFetchStub()
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    resolver.setEndpoints(new Map([["local", { baseURL: LOCAL_ENDPOINT, apiKey: "sk-test" }]]))

    await resolver.resolve("local", MODEL_ID)
    expect(calls[0].headers.authorization).toBe("Bearer sk-test")
  })

  it("does not send an Authorization header without an apiKey", async () => {
    const { fn, calls } = makeFetchStub()
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)

    await resolver.resolve("local", MODEL_ID)
    expect(calls[0].headers.authorization).toBeUndefined()
  })

  it("clears the registry and cache when setEndpoints is called again", async () => {
    const { fn, calls } = makeFetchStub()
    const resolver = createLocalModelLimitResolver({ ttlMs: 60_000, timeoutMs: 5_000, fetchImpl: fn })
    registerLocalEndpoint(resolver)
    await resolver.resolve("local", MODEL_ID)
    expect(calls).toHaveLength(1)

    resolver.setEndpoints(new Map())
    await expect(resolver.resolve("local", MODEL_ID)).resolves.toBeNull()
    expect(calls).toHaveLength(1)
  })
})
