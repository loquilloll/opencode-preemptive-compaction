export interface DegradationMonitorConfig {
  enabled: boolean
  monitorCount: number
  noTextThreshold: number
  recoverySuppressionMs: number
  maxRecoveryAttempts: number
  timeoutMs: number
}

export interface PreemptiveCompactionConfig {
  enabled: boolean
  threshold: number
  cooldownMs: number
  timeoutMs: number
  compactionModel: string | undefined
  degradationMonitor: DegradationMonitorConfig
}

export const DEFAULT_CONFIG: PreemptiveCompactionConfig = {
  enabled: true,
  threshold: 0.78,
  cooldownMs: 60_000,
  timeoutMs: 60_000,
  compactionModel: undefined,
  degradationMonitor: {
    enabled: true,
    monitorCount: 5,
    noTextThreshold: 3,
    recoverySuppressionMs: 5_000,
    maxRecoveryAttempts: 3,
    timeoutMs: 120_000,
  },
}

const BUILT_IN_MODEL_CONTEXT_LIMITS = {
  "openai/gpt-5": 400_000,
  "openai/gpt-5.2": 400_000,
  "openai/gpt-5.3-codex": 400_000,
  "openai/gpt-5.3-codex-spark": 128_000,
  "openai/gpt-5.4": 1_000_000,
  "openai/gpt-5.4-fast": 1_050_000,
  "openai/gpt-5.4-mini": 400_000,
  "openai/gpt-5.4-mini-fast": 400_000,
  "openai/gpt-5.5": 400_000,
  "openai/gpt-5.5-fast": 400_000,
  "openai/gpt-5.5-pro": 400_000,
  "copilot/claude-haiku-4.5": 200_000,
  "copilot/claude-opus-4.5": 200_000,
  "copilot/claude-opus-4.6": 200_000,
  "copilot/claude-opus-4.7": 200_000,
  "copilot/claude-sonnet-4.5": 200_000,
  "copilot/claude-sonnet-4.6": 200_000,
  "copilot/gpt-4.1": 128_000,
  "copilot/gpt-5-mini": 264_000,
  "copilot/gpt-5.2": 400_000,
  "copilot/gpt-5.2-codex": 400_000,
  "copilot/gpt-5.3-codex": 400_000,
  "copilot/gpt-5.4": 400_000,
  "copilot/gpt-5.4-mini": 400_000,
  "copilot/gpt-5.5": 400_000,
  "github-copilot/claude-haiku-4.5": 200_000,
  "github-copilot/claude-opus-4.5": 200_000,
  "github-copilot/claude-opus-4.6": 200_000,
  "github-copilot/claude-opus-4.7": 200_000,
  "github-copilot/claude-sonnet-4.5": 200_000,
  "github-copilot/claude-sonnet-4.6": 200_000,
  "github-copilot/gpt-4.1": 128_000,
  "github-copilot/gpt-5-mini": 264_000,
  "github-copilot/gpt-5.2": 400_000,
  "github-copilot/gpt-5.2-codex": 400_000,
  "github-copilot/gpt-5.3-codex": 400_000,
  "github-copilot/gpt-5.4": 400_000,
  "github-copilot/gpt-5.4-mini": 400_000,
  "github-copilot/gpt-5.5": 400_000,
} satisfies Record<string, number>

type Env = Record<string, string | undefined>

function getDefaultEnv(): Env {
  return ((globalThis as typeof globalThis & { process?: { env?: Env } }).process?.env ?? {}) as Env
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  return raw === "true" || raw === "1" || raw.toLowerCase() === "yes"
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampThreshold(value: number): number {
  return Math.min(0.95, Math.max(0.5, value))
}

export function loadConfig(env: Env = getDefaultEnv()): PreemptiveCompactionConfig {
  const degradationMonitor: DegradationMonitorConfig = {
    enabled: parseBoolean(env.PREEMPTIVE_COMPACTION_MONITOR_ENABLED, DEFAULT_CONFIG.degradationMonitor.enabled),
    monitorCount: parseNumber(env.PREEMPTIVE_COMPACTION_MONITOR_COUNT, DEFAULT_CONFIG.degradationMonitor.monitorCount),
    noTextThreshold: parseNumber(env.PREEMPTIVE_COMPACTION_MONITOR_NO_TEXT_THRESHOLD, DEFAULT_CONFIG.degradationMonitor.noTextThreshold),
    recoverySuppressionMs: parseNumber(env.PREEMPTIVE_COMPACTION_MONITOR_SUPPRESSION_MS, DEFAULT_CONFIG.degradationMonitor.recoverySuppressionMs),
    maxRecoveryAttempts: parseNumber(env.PREEMPTIVE_COMPACTION_MONITOR_MAX_RECOVERY, DEFAULT_CONFIG.degradationMonitor.maxRecoveryAttempts),
    timeoutMs: parseNumber(env.PREEMPTIVE_COMPACTION_MONITOR_TIMEOUT_MS, DEFAULT_CONFIG.degradationMonitor.timeoutMs),
  }

  return {
    enabled: parseBoolean(env.PREEMPTIVE_COMPACTION_ENABLED, DEFAULT_CONFIG.enabled),
    threshold: clampThreshold(parseNumber(env.PREEMPTIVE_COMPACTION_THRESHOLD, DEFAULT_CONFIG.threshold)),
    cooldownMs: parseNumber(env.PREEMPTIVE_COMPACTION_COOLDOWN_MS, DEFAULT_CONFIG.cooldownMs),
    timeoutMs: parseNumber(env.PREEMPTIVE_COMPACTION_TIMEOUT_MS, DEFAULT_CONFIG.timeoutMs),
    compactionModel: env.PREEMPTIVE_COMPACTION_MODEL || undefined,
    degradationMonitor,
  }
}

const MODEL_LIMITS_JSON_RE = /\s/g

export function parseModelLimitsJson(raw: string | undefined): Map<string, number> {
  const cache = new Map<string, number>()
  if (!raw || raw.replace(MODEL_LIMITS_JSON_RE, "").length === 0) return cache

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          cache.set(key, Math.floor(value))
        }
      }
    }
  } catch {
  }

  return cache
}

function loadBuiltInModelLimits(): Map<string, number> {
  return new Map<string, number>(Object.entries(BUILT_IN_MODEL_CONTEXT_LIMITS))
}

export function loadModelCacheState(env: Env = getDefaultEnv()): {
  anthropicContext1MEnabled: boolean
  modelContextLimitsCache: Map<string, number>
} {
  const modelContextLimitsCache = loadBuiltInModelLimits()
  for (const [model, limit] of parseModelLimitsJson(env.PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON)) {
    modelContextLimitsCache.set(model, limit)
  }

  return {
    anthropicContext1MEnabled: parseBoolean(env.ANTHROPIC_1M_CONTEXT, false),
    modelContextLimitsCache,
  }
}
