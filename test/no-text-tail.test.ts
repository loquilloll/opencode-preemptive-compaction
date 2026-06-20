import { describe, expect, it } from "bun:test"

import { isStepOnlyNoTextParts, resolveNoTextTailFromSession } from "../src/preemptive-compaction-no-text-tail"

describe("isStepOnlyNoTextParts", () => {
  it("returns true for step-only parts without text", () => {
    expect(isStepOnlyNoTextParts([{ type: "step-start" }, { type: "step-finish" }])).toBe(true)
  })

  it("returns false when a part carries non-empty text", () => {
    expect(isStepOnlyNoTextParts([{ type: "step-finish", text: "hello" }])).toBe(false)
  })

  it("returns false when a non-step part is present", () => {
    expect(isStepOnlyNoTextParts([{ type: "text", text: "hi" }])).toBe(false)
  })

  it("returns false for empty or non-array input", () => {
    expect(isStepOnlyNoTextParts([])).toBe(false)
    expect(isStepOnlyNoTextParts(undefined)).toBe(false)
  })
})

describe("resolveNoTextTailFromSession", () => {
  it("uses inline parts when provided without calling messages()", async () => {
    const messages = () => Promise.resolve({ data: [] })
    const result = await resolveNoTextTailFromSession({
      client: { session: { messages } },
      sessionID: "s",
      directory: "d",
      parts: [{ type: "step-start" }, { type: "step-finish" }],
    })
    expect(result).toBe(true)
  })

  it("returns false when the last assistant message has text", async () => {
    const messages = () =>
      Promise.resolve({
        data: [
          { info: { id: "m1", role: "assistant" }, parts: [{ type: "text", text: "x" }] },
        ],
      })
    const result = await resolveNoTextTailFromSession({
      client: { session: { messages } },
      sessionID: "s",
      directory: "d",
    })
    expect(result).toBe(false)
  })

  it("finds the message by id from history", async () => {
    const messages = () =>
      Promise.resolve({
        data: [
          { info: { id: "m1", role: "assistant" }, parts: [{ type: "text", text: "x" }] },
          { info: { id: "m2", role: "assistant" }, parts: [{ type: "step-start" }, { type: "step-finish" }] },
        ],
      })
    const result = await resolveNoTextTailFromSession({
      client: { session: { messages } },
      sessionID: "s",
      directory: "d",
      messageID: "m2",
    })
    expect(result).toBe(true)
  })
})
