import { describe, expect, it, beforeEach, afterEach } from "bun:test"

import { loadConfig, loadModelCacheState, parseModelLimitsJson } from "../src/config"

describe("config loader", () => {
  const envBackup: Partial<Record<string, string | undefined>> = {}
  const keys = [
    "PREEMPTIVE_COMPACTION_ENABLED",
    "PREEMPTIVE_COMPACTION_THRESHOLD",
    "PREEMPTIVE_COMPACTION_COOLDOWN_MS",
    "PREEMPTIVE_COMPACTION_TIMEOUT_MS",
    "PREEMPTIVE_COMPACTION_MODEL",
    "ANTHROPIC_1M_CONTEXT",
    "PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON",
  ]

  beforeEach(() => {
    for (const key of keys) {
      envBackup[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of keys) {
      if (envBackup[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = envBackup[key]
      }
    }
  })

  it("returns sensible defaults when no env is set", () => {
    const config = loadConfig()
    expect(config.enabled).toBe(true)
    expect(config.threshold).toBe(0.78)
    expect(config.cooldownMs).toBe(60_000)
    expect(config.timeoutMs).toBe(60_000)
    expect(config.compactionModel).toBeUndefined()
  })

  it("clamps threshold into the 0.5–0.95 range", () => {
    expect(loadConfig({ ...process.env, PREEMPTIVE_COMPACTION_THRESHOLD: "0.1" }).threshold).toBe(0.5)
    expect(loadConfig({ ...process.env, PREEMPTIVE_COMPACTION_THRESHOLD: "1.5" }).threshold).toBe(0.95)
    expect(loadConfig({ ...process.env, PREEMPTIVE_COMPACTION_THRESHOLD: "0.6" }).threshold).toBe(0.6)
  })

  it("parses enable flag and numbers", () => {
    const config = loadConfig({
      PREEMPTIVE_COMPACTION_ENABLED: "false",
      PREEMPTIVE_COMPACTION_COOLDOWN_MS: "30000",
      PREEMPTIVE_COMPACTION_TIMEOUT_MS: "45000",
    })
    expect(config.enabled).toBe(false)
    expect(config.cooldownMs).toBe(30_000)
    expect(config.timeoutMs).toBe(45_000)
  })

  it("loads compactionModel override", () => {
    expect(loadConfig({ PREEMPTIVE_COMPACTION_MODEL: "opencode/glm-4.6" }).compactionModel).toBe(
      "opencode/glm-4.6",
    )
  })

  it("parses model limits json into a map", () => {
    const cache = parseModelLimitsJson('{"opencode/kimi-k2.5-free":262144,"anthropic/x":100000}')
    expect(cache.get("opencode/kimi-k2.5-free")).toBe(262_144)
    expect(cache.get("anthropic/x")).toBe(100_000)
  })

  it("returns an empty map for invalid json", () => {
    expect(parseModelLimitsJson("not-json").size).toBe(0)
    expect(parseModelLimitsJson(undefined).size).toBe(0)
  })

  it("loadModelCacheState reads ANTHROPIC_1M_CONTEXT and model limits json", () => {
    const state = loadModelCacheState({
      ANTHROPIC_1M_CONTEXT: "true",
      PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON: '{"opencode/kimi-k2.5-free":200000}',
    })
    expect(state.anthropicContext1MEnabled).toBe(true)
    expect(state.modelContextLimitsCache.get("opencode/kimi-k2.5-free")).toBe(200_000)
  })
})
