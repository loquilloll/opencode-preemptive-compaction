export function isCompactionAgent(agent: unknown): boolean {
  return typeof agent === "string" && agent.trim().toLowerCase() === "compaction"
}
