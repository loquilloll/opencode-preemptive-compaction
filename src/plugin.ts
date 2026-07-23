import { createPreemptiveCompactionHook } from "./preemptive-compaction"
import { loadConfig, loadModelCacheState } from "./config"
import { attachLoggerClient } from "./internal/logger"
import { readConfigFile } from "./internal/config-file"
import type { OpenCodePluginContext, PluginHooks } from "./index"

const PreemptiveCompactionPlugin = async ({
  client,
  directory,
}: OpenCodePluginContext): Promise<PluginHooks | Record<string, never>> => {
  attachLoggerClient(client)

  const file = readConfigFile()
  const config = loadConfig(process.env, file)

  if (!config.enabled) {
    return {}
  }

  const modelCacheState = loadModelCacheState(process.env, file)

  return createPreemptiveCompactionHook({ client, directory }, config, modelCacheState)
}

export default PreemptiveCompactionPlugin
