import { createPreemptiveCompactionHook } from "./preemptive-compaction"
import { loadConfig, loadModelCacheState } from "./config"
import { attachLoggerClient, log } from "./internal/logger"
import { readConfigFile } from "./internal/config-file"
import type { OpenCodePluginContext, PluginHooks } from "./index"

const PreemptiveCompactionPlugin = async ({
  client,
  directory,
}: OpenCodePluginContext): Promise<PluginHooks | Record<string, never>> => {
  attachLoggerClient(client)

  const file = readConfigFile()
  const config = loadConfig(process.env, file)
  log("[preemptive-compaction] plugin loaded", {
    enabled: config.enabled,
    threshold: config.threshold,
  })

  if (process.env.PREEMPTIVE_COMPACTION_MODEL) {
    log("[preemptive-compaction] PREEMPTIVE_COMPACTION_MODEL is no longer read; set agent.compaction.model in opencode.json instead", {
      value: process.env.PREEMPTIVE_COMPACTION_MODEL,
    })
  }
  if ((file as { compactionModel?: unknown } | undefined)?.compactionModel) {
    log("[preemptive-compaction] preemptive-compaction.config.json \"compactionModel\" is no longer read; set agent.compaction.model in opencode.json instead")
  }

  if (!config.enabled) {
    return {}
  }

  const modelCacheState = loadModelCacheState(process.env, file)

  return createPreemptiveCompactionHook({ client, directory }, config, modelCacheState)
}

// Dual-format default export so the built plugin loads under both plugin APIs:
//   - opencode 1.x reads {id, server} and calls server(input) — the v1 path above.
//   - opencode 2.x reads {id, setup} and calls setup(ctx). v2 ships native
//     auto-compaction (on by default) that covers this plugin's preemptive threshold
//     logic, so setup deliberately no-ops rather than stacking a second compactor.
export const v2Setup = async () => {
  log("[preemptive-compaction] opencode 2.x: deferring to native auto-compaction; v1 threshold hooks inactive")
}

export default { id: "preemptive-compaction", server: PreemptiveCompactionPlugin, setup: v2Setup }
