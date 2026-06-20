import { createPreemptiveCompactionHook } from "./preemptive-compaction"
import { loadConfig, loadModelCacheState } from "./config"
import { attachLoggerClient } from "./internal/logger"
import type { PreemptiveCompactionClient } from "./preemptive-compaction-types"

export { createPreemptiveCompactionHook } from "./preemptive-compaction"
export { runPreemptiveCompactionIfNeeded } from "./preemptive-compaction-trigger"
export { resolveActualContextLimit } from "./internal/context-limit-resolver"
export {
  loadConfig,
  loadModelCacheState,
  DEFAULT_CONFIG,
  type PreemptiveCompactionConfig,
  type DegradationMonitorConfig,
} from "./config"
export type {
  PreemptiveCompactionContext,
  PreemptiveCompactionClient,
  TokenInfo,
  CachedCompactionState,
} from "./preemptive-compaction-types"

export interface OpenCodePluginContext {
  project?: unknown
  directory: string
  worktree?: string
  client: PreemptiveCompactionClient & {
    app?: {
      log?: (input: {
        body: { service: string; level: string; message: string; extra?: Record<string, unknown> }
      }) => Promise<unknown>
    }
  }
  $?: unknown
}

export type PluginHooks = ReturnType<typeof createPreemptiveCompactionHook>

export type Plugin = (ctx: OpenCodePluginContext) => Promise<PluginHooks | Record<string, never>>

export const PreemptiveCompactionPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig()

  if (!config.enabled) {
    return {}
  }

  attachLoggerClient(client)

  const modelCacheState = loadModelCacheState()

  return createPreemptiveCompactionHook({ client, directory }, config, modelCacheState)
}

export default PreemptiveCompactionPlugin
