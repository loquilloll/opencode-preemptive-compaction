import { isRecord } from "./record-type-guard"

export function extractCompactionModelFromConfig(cfg: unknown): string | undefined {
  if (!isRecord(cfg)) return undefined
  const agent = cfg.agent
  if (!isRecord(agent)) return undefined
  const compaction = agent.compaction
  if (!isRecord(compaction)) return undefined
  const model = compaction.model
  return typeof model === "string" && model.length > 0 ? model : undefined
}
