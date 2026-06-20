export function resolveCompactionModel(
  compactionModelOverride: string | undefined,
  originalProviderID: string,
  originalModelID: string,
): { providerID: string; modelID: string } {
  if (!compactionModelOverride) {
    return { providerID: originalProviderID, modelID: originalModelID }
  }

  const modelParts = compactionModelOverride.split("/")
  if (modelParts.length < 2) {
    return { providerID: originalProviderID, modelID: originalModelID }
  }

  return {
    providerID: modelParts[0],
    modelID: modelParts.slice(1).join("/"),
  }
}
