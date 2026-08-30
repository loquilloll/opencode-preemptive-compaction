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

export default PreemptiveCompactionPlugin
