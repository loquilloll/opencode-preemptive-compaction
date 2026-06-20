import { createPreemptiveCompactionHook } from "./preemptive-compaction"
import { loadConfig, loadModelCacheState } from "./config"
import { attachLoggerClient } from "./internal/logger"
import type { OpenCodePluginContext, PluginHooks } from "./index"

const PreemptiveCompactionPlugin = async ({
  client,
  directory,
}: OpenCodePluginContext): Promise<PluginHooks | Record<string, never>> => {
  const config = loadConfig()

  if (!config.enabled) {
    return {}
  }

  attachLoggerClient(client)

  const modelCacheState = loadModelCacheState()

  return createPreemptiveCompactionHook({ client, directory }, config, modelCacheState)
}

export default PreemptiveCompactionPlugin
