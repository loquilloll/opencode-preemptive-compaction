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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PreemptiveCompactionConfig {
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

export function loadModelCacheState(env: NodeJS.ProcessEnv = process.env): {
  anthropicContext1MEnabled: boolean
  modelContextLimitsCache: Map<string, number>
} {
  return {
    anthropicContext1MEnabled: parseBoolean(env.ANTHROPIC_1M_CONTEXT, false),
    modelContextLimitsCache: parseModelLimitsJson(env.PREEMPTIVE_COMPACTION_MODEL_LIMITS_JSON),
  }
}
