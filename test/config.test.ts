import { describe, expect, it, beforeEach, afterEach } from "bun:test"

import { loadConfig, loadModelCacheState, parseModelLimitsJson, type PreemptiveCompactionConfigFile } from "../src/config"

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

  it("loadModelCacheState includes built-in model limits", () => {
    const state = loadModelCacheState({})
    expect(state.modelContextLimitsCache.get("openai/gpt-5.4")).toBe(1_000_000)
    expect(state.modelContextLimitsCache.get("github-copilot/claude-haiku-4.5")).toBe(200_000)
  })

  it("loadModelCacheState reads ANTHROPIC_1M_CONTEXT and lets env model limits override built-ins", () => {
    const state = loadModelCacheState({
      ANTHROPIC_1M_CONTEXT: "true",
      PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON: '{"opencode/kimi-k2.5-free":200000,"openai/gpt-5.4":400000}',
    })
    expect(state.anthropicContext1MEnabled).toBe(true)
    expect(state.modelContextLimitsCache.get("opencode/kimi-k2.5-free")).toBe(200_000)
    expect(state.modelContextLimitsCache.get("openai/gpt-5.4")).toBe(400_000)
  })

  describe("file-based config merge", () => {
    it("file threshold wins over env, then clamps through clampThreshold", () => {
      const env = { PREEMPTIVE_COMPACTION_THRESHOLD: "0.6" }
      expect(loadConfig(env, { threshold: 0.9 }).threshold).toBe(0.9)
      expect(loadConfig(env, { threshold: 1.5 }).threshold).toBe(0.95)
      expect(loadConfig(env, { threshold: 0.1 }).threshold).toBe(0.5)
    })

    it("mistyped file fields are ignored (fall back to env/default)", () => {
      const badThreshold = { threshold: "high" } as unknown as PreemptiveCompactionConfigFile
      expect(loadConfig({ PREEMPTIVE_COMPACTION_THRESHOLD: "0.6" }, badThreshold).threshold).toBe(0.6)
      expect(loadConfig({}, badThreshold).enabled).toBe(true)

      const badNumerics = {
        cooldownMs: "soon",
        timeoutMs: null,
      } as unknown as PreemptiveCompactionConfigFile
      const cfg = loadConfig(
        { PREEMPTIVE_COMPACTION_COOLDOWN_MS: "30000", PREEMPTIVE_COMPACTION_TIMEOUT_MS: "45000" },
        badNumerics,
      )
      expect(cfg.cooldownMs).toBe(30_000)
      expect(cfg.timeoutMs).toBe(45_000)

      const badModel = { compactionModel: 123 } as unknown as PreemptiveCompactionConfigFile
      expect(loadConfig({ PREEMPTIVE_COMPACTION_MODEL: "env/model" }, badModel).compactionModel).toBe("env/model")

      const badDm = {
        degradationMonitor: { recoverySuppressionMs: "long", monitorCount: "x" },
      } as unknown as PreemptiveCompactionConfigFile
      const dmCfg = loadConfig(
        { PREEMPTIVE_COMPACTION_MONITOR_SUPPRESSION_MS: "7000", PREEMPTIVE_COMPACTION_MONITOR_COUNT: "8" },
        badDm,
      )
      expect(dmCfg.degradationMonitor.recoverySuppressionMs).toBe(7_000)
      expect(dmCfg.degradationMonitor.monitorCount).toBe(8)
    })

    it("partial file only overrides listed fields", () => {
      const cfg = loadConfig({ PREEMPTIVE_COMPACTION_COOLDOWN_MS: "30000" }, { threshold: 0.9 })
      expect(cfg.threshold).toBe(0.9)
      expect(cfg.cooldownMs).toBe(30_000)
      expect(cfg.timeoutMs).toBe(60_000)
      expect(cfg.compactionModel).toBeUndefined()
    })

    it("boolean enabled from file wins; mistyped enabled ignored", () => {
      expect(loadConfig({}, { enabled: false }).enabled).toBe(false)
      const badEnabled = { enabled: "false" } as unknown as PreemptiveCompactionConfigFile
      expect(loadConfig({}, badEnabled).enabled).toBe(true)
    })

    it("empty-string compactionModel from file is treated as unset", () => {
      expect(
        loadConfig({ PREEMPTIVE_COMPACTION_MODEL: "env/model" }, { compactionModel: "" }).compactionModel,
      ).toBe("env/model")
      expect(loadConfig({}, { compactionModel: "file/model" }).compactionModel).toBe("file/model")
    })

    it("degradationMonitor merges per-field across all six sub-fields", () => {
      const cfg = loadConfig(
        {
          PREEMPTIVE_COMPACTION_MONITOR_NO_TEXT_THRESHOLD: "9",
          PREEMPTIVE_COMPACTION_MONITOR_SUPPRESSION_MS: "7000",
          PREEMPTIVE_COMPACTION_MONITOR_MAX_RECOVERY: "4",
        },
        {
          degradationMonitor: {
            enabled: false,
            monitorCount: 7,
            timeoutMs: 99_000,
          },
        },
      )
      // file overrides
      expect(cfg.degradationMonitor.enabled).toBe(false)
      expect(cfg.degradationMonitor.monitorCount).toBe(7)
      expect(cfg.degradationMonitor.timeoutMs).toBe(99_000)
      // env fallback
      expect(cfg.degradationMonitor.noTextThreshold).toBe(9)
      expect(cfg.degradationMonitor.recoverySuppressionMs).toBe(7_000)
      expect(cfg.degradationMonitor.maxRecoveryAttempts).toBe(4)
    })

    it("null file behaves like undefined (env+default)", () => {
      expect(loadConfig({ PREEMPTIVE_COMPACTION_THRESHOLD: "0.6" }, null).threshold).toBe(0.6)
      expect(loadConfig(process.env, null).threshold).toBe(0.78)
    })

    it("loadModelCacheState merges modelLimits (file wins on collision, non-numeric skipped)", () => {
      const env = { PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON: '{"ozore/auto":50000,"ozore/auto1":99999}' }
      const file = {
        modelLimits: { "ozore/auto": 100000, bad: "x" as unknown as number },
      }
      const state = loadModelCacheState(env, file)
      expect(state.modelContextLimitsCache.get("ozore/auto")).toBe(100_000)
      expect(state.modelContextLimitsCache.get("ozore/auto1")).toBe(99_999)
      expect(state.modelContextLimitsCache.has("bad")).toBe(false)
    })

    it("loadModelCacheState ignores null or array modelLimits without crashing or polluting", () => {
      const env = { PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON: '{"ozore/auto":50000}' }
      const nullFile = { modelLimits: null } as unknown as PreemptiveCompactionConfigFile
      const arrFile = { modelLimits: [100000, 200000] } as unknown as PreemptiveCompactionConfigFile
      const baselineSize = loadModelCacheState(env).modelContextLimitsCache.size
      for (const file of [nullFile, arrFile]) {
        const state = loadModelCacheState(env, file)
        expect(state.modelContextLimitsCache.get("ozore/auto")).toBe(50_000)
        expect(state.modelContextLimitsCache.has("0")).toBe(false)
        expect(state.modelContextLimitsCache.size).toBe(baselineSize)
      }
    })

    it("loadModelCacheState anthropicContext1M from file overrides env both directions", () => {
      expect(
        loadModelCacheState({ ANTHROPIC_1M_CONTEXT: "false" }, { anthropicContext1M: true }).anthropicContext1MEnabled,
      ).toBe(true)
      expect(
        loadModelCacheState({ ANTHROPIC_1M_CONTEXT: "true" }, { anthropicContext1M: false }).anthropicContext1MEnabled,
      ).toBe(false)
      expect(loadModelCacheState({ ANTHROPIC_1M_CONTEXT: "true" }).anthropicContext1MEnabled).toBe(true)
    })
  })
})
