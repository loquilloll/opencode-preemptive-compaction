import process from "node:process"

import { isRecord } from "./record-type-guard"
import { log } from "./logger"

export interface LocalEndpoint {
  baseURL: string
  apiKey?: string
}

export interface LocalModelLimitResolver {
  setEndpoints: (endpoints: Map<string, LocalEndpoint>) => void
  resolve: (providerID: string, modelID: string) => Promise<number | null>
}

export type LocalModelLimitsFetch = (
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const HTTP_BASE_URL_RE = /^https?:\/\/\S+$/i
const ENV_API_KEY_RE = /^\{env:([^}]+)\}$/

interface LimitCacheEntry {
  limit: number | null
  fetchedAt: number
}

function normalizeBaseURL(raw: string): string | null {
  const trimmed = raw.trim()
  if (!HTTP_BASE_URL_RE.test(trimmed)) return null
  return trimmed.replace(/\/+$/, "")
}

function resolveApiKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const value = raw.trim()
  if (value.length === 0) return undefined
  const envMatch = ENV_API_KEY_RE.exec(value)
  if (envMatch) {
    const resolved = process.env[envMatch[1]]
    return resolved && resolved.length > 0 ? resolved : undefined
  }
  return value
}

export function extractLocalEndpoints(cfg: unknown): Map<string, LocalEndpoint> {
  const endpoints = new Map<string, LocalEndpoint>()
  if (!isRecord(cfg)) return endpoints
  const provider = cfg.provider
  if (!isRecord(provider)) return endpoints

  for (const [providerID, rawProvider] of Object.entries(provider)) {
    if (!isRecord(rawProvider)) continue
    const options = rawProvider.options
    if (!isRecord(options)) continue
    const baseURL = normalizeBaseURL(typeof options.baseURL === "string" ? options.baseURL : "")
    if (!baseURL) continue
    endpoints.set(providerID, { baseURL, apiKey: resolveApiKey(options.apiKey) })
  }

  return endpoints
}

function parseEnvNumber(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function positiveFiniteLimit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

function extractModelLimits(body: unknown): Map<string, number | null> {
  const limits = new Map<string, number | null>()
  if (!isRecord(body)) return limits
  const data = body.data
  if (!Array.isArray(data)) return limits
  for (const entry of data) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue
    limits.set(
      entry.id,
      positiveFiniteLimit(entry.context_length) ?? positiveFiniteLimit(entry.max_context_length),
    )
  }
  return limits
}

export function createLocalModelLimitResolver(options?: {
  ttlMs?: number
  timeoutMs?: number
  fetchImpl?: LocalModelLimitsFetch
  now?: () => number
}): LocalModelLimitResolver {
  const ttlMs = options?.ttlMs ?? parseEnvNumber("PREEMPTIVE_COMPACTION_LOCAL_TTL_MS", 60_000)
  const timeoutMs = options?.timeoutMs ?? parseEnvNumber("PREEMPTIVE_COMPACTION_LOCAL_TIMEOUT_MS", 5_000)
  const fetchImpl = options?.fetchImpl ?? ((url, init) => globalThis.fetch(url, init))
  const now = options?.now ?? Date.now

  let endpoints = new Map<string, LocalEndpoint>()
  const limitCache = new Map<string, LimitCacheEntry>()
  const inFlight = new Map<string, Promise<Map<string, number | null>>>()

  const fetchModelLimits = (endpoint: LocalEndpoint): Promise<Map<string, number | null>> => {
    const url = `${endpoint.baseURL}/models`
    const request = (async () => {
      const controller = new AbortController()
      const timeoutID = globalThis.setTimeout(() => controller.abort(), timeoutMs)
      try {
        const headers: Record<string, string> = { accept: "application/json" }
        if (endpoint.apiKey) headers.authorization = `Bearer ${endpoint.apiKey}`
        const response = await fetchImpl(url, { headers, signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return extractModelLimits(await response.json())
      } finally {
        globalThis.clearTimeout(timeoutID)
      }
    })()

    request.catch((error: unknown) => {
      log("[preemptive-compaction] Failed to query local model limits", {
        url,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    return request
  }

  const resolve = async (providerID: string, modelID: string): Promise<number | null> => {
    const endpoint = endpoints.get(providerID)
    if (!endpoint) return null

    const cacheKey = `${endpoint.baseURL}::${modelID}`
    const cached = limitCache.get(cacheKey)
    if (cached && now() - cached.fetchedAt < ttlMs) return cached.limit

    const existing = inFlight.get(endpoint.baseURL)
    const request = existing ?? fetchModelLimits(endpoint)
    if (!existing) inFlight.set(endpoint.baseURL, request)

    let limits: Map<string, number | null>
    try {
      limits = await request
    } catch {
      limits = new Map()
    } finally {
      if (inFlight.get(endpoint.baseURL) === request) inFlight.delete(endpoint.baseURL)
    }

    const limit = limits.get(modelID) ?? null
    limitCache.set(cacheKey, { limit, fetchedAt: now() })
    return limit
  }

  return {
    setEndpoints: (next: Map<string, LocalEndpoint>) => {
      endpoints = next
      limitCache.clear()
    },
    resolve,
  }
}
