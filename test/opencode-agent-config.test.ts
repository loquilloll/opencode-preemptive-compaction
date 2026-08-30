import { describe, expect, it } from "bun:test"

import { extractCompactionModelFromConfig } from "../src/internal/opencode-agent-config"

describe("extractCompactionModelFromConfig", () => {
  it("returns the model string when agent.compaction.model is a non-empty string", () => {
    expect(
      extractCompactionModelFromConfig({ agent: { compaction: { model: "opencode/glm-4.6" } } }),
    ).toBe("opencode/glm-4.6")
  })

  it("returns undefined for undefined input", () => {
    expect(extractCompactionModelFromConfig(undefined)).toBeUndefined()
  })

  it("returns undefined for null input", () => {
    expect(extractCompactionModelFromConfig(null)).toBeUndefined()
  })

  it("returns undefined for non-object primitives", () => {
    expect(extractCompactionModelFromConfig("agent")).toBeUndefined()
    expect(extractCompactionModelFromConfig(42)).toBeUndefined()
    expect(extractCompactionModelFromConfig(true)).toBeUndefined()
  })

  it("returns undefined when cfg is an array (agent undefined)", () => {
    expect(extractCompactionModelFromConfig([1, 2, 3])).toBeUndefined()
  })

  it("returns undefined when agent is missing", () => {
    expect(extractCompactionModelFromConfig({})).toBeUndefined()
  })

  it("returns undefined when agent is an array (compaction undefined)", () => {
    expect(extractCompactionModelFromConfig({ agent: [] })).toBeUndefined()
  })

  it("returns undefined when compaction is missing", () => {
    expect(extractCompactionModelFromConfig({ agent: {} })).toBeUndefined()
  })

  it("returns undefined when compaction is a non-object string", () => {
    expect(extractCompactionModelFromConfig({ agent: { compaction: "x" } })).toBeUndefined()
  })

  it("returns undefined when compaction is an array (model undefined)", () => {
    expect(extractCompactionModelFromConfig({ agent: { compaction: [] } })).toBeUndefined()
  })

  it("returns undefined when model is missing", () => {
    expect(extractCompactionModelFromConfig({ agent: { compaction: {} } })).toBeUndefined()
  })

  it("returns undefined for empty-string model", () => {
    expect(extractCompactionModelFromConfig({ agent: { compaction: { model: "" } } })).toBeUndefined()
  })

  it("returns undefined for non-string model (number)", () => {
    expect(extractCompactionModelFromConfig({ agent: { compaction: { model: 5 } } })).toBeUndefined()
  })

  it("returns undefined for non-string model (object)", () => {
    expect(extractCompactionModelFromConfig({ agent: { compaction: { model: {} } } })).toBeUndefined()
  })

  // Parity with the removed loadConfig check (which used `length > 0` with no trim):
  // whitespace-only model passes through the extractor; resolveCompactionModel then
  // treats it as "no slash" and falls back to the chat model. Documented, not trimmed.
  it("returns a whitespace-only model unchanged (faithful-port parity with old loadConfig)", () => {
    expect(extractCompactionModelFromConfig({ agent: { compaction: { model: "   " } } })).toBe("   ")
  })
})
