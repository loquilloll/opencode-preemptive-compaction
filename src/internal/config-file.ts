import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { PreemptiveCompactionConfigFile } from "../config"
import { log } from "./logger"

const CONFIG_FILE_NAMES = ["preemptive-compaction.config.json", "preemptive-compaction.config.jsonc"] as const

// String-aware single-pass strip: keeps // and /* inside string literals.
// Adequate for hand-authored config; not a full JSONC parser.
export function stripJsoncComments(raw: string): string {
  return raw.replace(
    /("(?:\\.|[^"\\])*")|(\/\*[\s\S]*?\*\/|\/\/[^\n\r]*)/g,
    (whole: string, str: string | undefined, comment: string | undefined): string =>
      comment ? "" : str ?? whole,
  )
}

export function resolveConfigFilePath(baseUrl: string = import.meta.url): string | undefined {
  let here: string
  try {
    here = fileURLToPath(baseUrl)
  } catch {
    return undefined
  }
  const dir = dirname(here)
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export function readConfigFile(opts?: { baseUrl?: string }): PreemptiveCompactionConfigFile | undefined {
  const baseUrl = opts?.baseUrl ?? import.meta.url
  try {
    const filePath = resolveConfigFilePath(baseUrl)
    if (!filePath) return undefined
    const raw = readFileSync(filePath, "utf8")
    const stripped = filePath.endsWith(".jsonc") ? stripJsoncComments(raw) : raw
    const parsed = JSON.parse(stripped) as unknown
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      log("[preemptive-compaction] config file root is not an object; ignoring", { filePath })
      return undefined
    }
    return parsed as PreemptiveCompactionConfigFile
  } catch (err) {
    log("[preemptive-compaction] failed to read config file; continuing with env+defaults", {
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}
