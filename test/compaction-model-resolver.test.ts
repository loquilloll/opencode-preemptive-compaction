import { describe, expect, it } from "bun:test"

import { resolveCompactionModel } from "../src/internal/compaction-model-resolver"

describe("resolveCompactionModel", () => {
  it("returns the original model when no override is set", () => {
    expect(resolveCompactionModel(undefined, "anthropic", "claude-sonnet-4-6")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
    })
  })

  it("parses a provider/model override", () => {
    expect(resolveCompactionModel("opencode/glm-4.6", "anthropic", "claude-sonnet-4-6")).toEqual({
      providerID: "opencode",
      modelID: "glm-4.6",
    })
  })

  it("preserves slashes in model id", () => {
    expect(resolveCompactionModel("custom/foo/bar-baz", "anthropic", "x")).toEqual({
      providerID: "custom",
      modelID: "foo/bar-baz",
    })
  })

  it("falls back to original when override has no slash", () => {
    expect(resolveCompactionModel("noprovider", "anthropic", "claude-sonnet-4-6")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
    })
  })
})
